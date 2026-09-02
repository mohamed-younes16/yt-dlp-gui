use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use super::{
    cookies_args, detect_js_runtime, extract_error, fix_cookie_browser_name, hide_window,
    hint_for_error, kill_tree, truncate, validate_media_url,
};

const MAX_CONCURRENT: usize = 3;
const STALL_SECS: u64 = 180;
const STDERR_CAP: usize = 400;

pub struct Flags {
    pub cancelled: AtomicBool,
    pub timed_out: AtomicBool,
}

struct JobHandle {
    child: Option<Child>,
    flags: Arc<Flags>,
}

#[derive(Default)]
pub struct DownloadState {
    jobs: Mutex<HashMap<String, JobHandle>>,
}

impl DownloadState {
    fn begin(&self, id: &str) -> Result<Arc<Flags>, String> {
        let mut jobs = self.jobs.lock().unwrap();
        jobs.retain(|_, job| job.child.is_some() || !job.flags.cancelled.load(Ordering::Relaxed));
        if jobs.contains_key(id) {
            return Err("A download with this id is already registered".into());
        }
        if jobs.len() >= MAX_CONCURRENT {
            return Err(format!("Too many concurrent downloads (max {MAX_CONCURRENT})"));
        }
        let flags = Arc::new(Flags {
            cancelled: AtomicBool::new(false),
            timed_out: AtomicBool::new(false),
        });
        jobs.insert(
            id.to_string(),
            JobHandle {
                child: None,
                flags: flags.clone(),
            },
        );
        Ok(flags)
    }

    /// Store the spawned child. Returns false if the job was cancelled or
    /// removed while we were attaching — the child is killed in that case.
    fn attach(&self, id: &str, mut child: Child) -> bool {
        let mut jobs = self.jobs.lock().unwrap();
        match jobs.get_mut(id) {
            Some(job) => {
                job.child = Some(child);
                if job.flags.cancelled.load(Ordering::Relaxed) {
                    if let Some(mut c) = job.child.take() {
                        kill_tree(&mut c);
                    }
                    false
                } else {
                    true
                }
            }
            None => {
                kill_tree(&mut child);
                false
            }
        }
    }

    fn take_and_wait(&self, id: &str) -> Option<bool> {
        let mut jobs = self.jobs.lock().unwrap();
        jobs.get_mut(id)
            .and_then(|job| job.child.take())
            .map(|mut child| child.wait().map(|s| s.success()).unwrap_or(false))
    }

    fn finish(&self, id: &str) {
        self.jobs.lock().unwrap().remove(id);
    }

    fn cancel(&self, id: &str) -> bool {
        let mut jobs = self.jobs.lock().unwrap();
        match jobs.get_mut(id) {
            Some(job) => {
                job.flags.cancelled.store(true, Ordering::Relaxed);
                if let Some(mut child) = job.child.take() {
                    kill_tree(&mut child);
                }
                true
            }
            None => false,
        }
    }

    fn mark_timeout(&self, id: &str) {
        let mut jobs = self.jobs.lock().unwrap();
        if let Some(job) = jobs.get_mut(id) {
            job.flags.timed_out.store(true, Ordering::Relaxed);
            if let Some(mut child) = job.child.take() {
                kill_tree(&mut child);
            }
        }
    }

    /// Kill every live child — called when the app exits.
    pub fn kill_all(&self) {
        let mut jobs = self.jobs.lock().unwrap();
        for job in jobs.values_mut() {
            job.flags.cancelled.store(true, Ordering::Relaxed);
            if let Some(mut child) = job.child.take() {
                kill_tree(&mut child);
            }
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub id: String,
    pub status: String, // starting | downloading | done | cancelled | error
    pub phase: String,  // video | audio | thumbnail
    pub percent: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speed: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub eta: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

fn emit(
    app: &AppHandle,
    id: &str,
    status: &str,
    phase: &str,
    percent: f64,
    speed: Option<String>,
    eta: Option<String>,
    file: Option<String>,
    message: Option<String>,
) {
    let _ = app.emit(
        "download-progress",
        DownloadProgress {
            id: id.to_string(),
            status: status.to_string(),
            phase: phase.to_string(),
            percent,
            speed,
            eta,
            file,
            message,
        },
    );
}

fn default_folder() -> String {
    if let Some(p) = dirs::download_dir() {
        return p.to_string_lossy().into_owned();
    }
    if let Some(p) = dirs::home_dir() {
        return p.to_string_lossy().into_owned();
    }
    std::env::current_dir()
        .map(|p| p.display().to_string())
        .unwrap_or_else(|_| ".".to_string())
}

fn video_quality_args(quality: u32, container: &str) -> Vec<String> {
    // For MP4 prefer universally-supported codecs (H.264 + AAC) so Windows
    // Media Player / QuickTime etc. can play it. VLC plays anything, but
    // YouTube's default best is often VP9/AV1 + Opus which is rare in MP4.
    let format_selector = match container {
        "mp4" => format!(
            "bv*[ext=mp4][vcodec^=avc1][height<={q}]+ba[ext=m4a][acodec^=mp4a]/b[ext=mp4][height<={q}]/bv*[height<={q}]+ba/b[height<={q}]",
            q = quality
        ),
        _ => format!("bv*[height<={q}]+ba/b[height<={q}]", q = quality),
    };
    let mut args = vec!["-f".to_string(), format_selector];
    match container {
        "mkv" | "webm" => {
            args.push("--merge-output-format".into());
            args.push(container.to_string());
        }
        _ => {
            args.push("--merge-output-format".into());
            args.push("mp4".into());
        }
    }
    args
}

fn audio_quality_args(bitrate: u32, format: &str) -> Vec<String> {
    let fmt = match format {
        "m4a" | "opus" | "wav" => format,
        _ => "mp3",
    };
    let mut args = vec!["-x".to_string(), "--audio-format".to_string(), fmt.to_string()];
    if fmt != "wav" {
        args.push("--audio-quality".to_string());
        args.push(format!("{}K", bitrate));
    }
    args
}

fn extras_args(
    save_thumbnail: bool,
    embed_thumbnail: bool,
    embed_metadata: bool,
    subtitles: bool,
) -> Vec<String> {
    let mut args = vec![];
    if save_thumbnail {
        args.extend([
            "--write-thumbnail".to_string(),
            "--convert-thumbnails".to_string(),
            "jpg".to_string(),
        ]);
    }
    if embed_thumbnail {
        args.push("--embed-thumbnail".to_string());
    }
    if embed_metadata {
        args.push("--embed-metadata".to_string());
    }
    if subtitles {
        args.extend([
            "--write-subs".to_string(),
            "--write-auto-subs".to_string(),
            "--sub-langs".to_string(),
            "en.*".to_string(),
            "--convert-subs".to_string(),
            "srt".to_string(),
        ]);
    }
    args
}

#[derive(Debug, PartialEq)]
enum PassOutcome {
    Ok,
    Cancelled,
    TimedOut,
    OptionUnsupported,
    Failed(String),
}

fn parse_progress_line(
    line: &str,
    phase: &str,
    file: Option<String>,
) -> Option<DownloadProgress> {
    let tokens: Vec<&str> = line.split_whitespace().collect();
    let mut percent = None;
    let mut speed = None;
    let mut eta = None;

    for (i, tok) in tokens.iter().enumerate() {
        if percent.is_none() && tok.ends_with('%') && i == 1 {
            percent = tok.trim_end_matches('%').parse::<f64>().ok();
        }
        if *tok == "at" && speed.is_none() {
            speed = tokens.get(i + 1).map(|s| s.to_string());
        }
        if *tok == "ETA" && eta.is_none() {
            eta = tokens.get(i + 1).map(|s| s.to_string());
        }
    }

    Some(DownloadProgress {
        id: String::new(),
        status: "downloading".into(),
        phase: phase.into(),
        percent: percent?.clamp(0.0, 100.0),
        speed,
        eta,
        file,
        message: None,
    })
}

fn read_pass(
    app: &AppHandle,
    state: &DownloadState,
    id: &str,
    args: Vec<String>,
    url: &str,
    folder: &str,
    phase: &str,
    playlist: bool,
    flags: &Arc<Flags>,
    last_file: &Arc<Mutex<Option<String>>>,
) -> PassOutcome {
    let mut full = vec![
        url.to_string(),
        "--newline".to_string(),
        "-P".to_string(),
        folder.to_string(),
    ];
    if !playlist {
        full.push("--no-playlist".to_string());
    }
    full.extend(args);

    emit(app, id, "starting", phase, 0.0, None, None, None, None);

    let mut cmd = Command::new("yt-dlp");
    cmd.args(&full).stdout(Stdio::piped()).stderr(Stdio::piped());
    hide_window(&mut cmd);

    let child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            return PassOutcome::Failed(format!(
                "Could not start yt-dlp: {e}. Is it installed and on PATH?"
            ));
        }
    };

    // Register *before* reading so cancel() can always find the child — the
    // window between spawn and registration is where cancels used to vanish.
    if !state.attach(id, child) {
        return PassOutcome::Cancelled;
    }
    // `attach` moved it into the map; we don't touch it locally anymore.
    let stdout = match state.stdout_of(id) {
        Some(s) => s,
        None => return PassOutcome::Cancelled,
    };
    let stderr_handle = match state.stderr_of(id) {
        Some(s) => s,
        None => return PassOutcome::Cancelled,
    };

    let stderr_lines: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    // Output on *either* pipe counts as liveness — a long ffmpeg merge is
    // silent on stdout for minutes but chatty on stderr.
    let tick = Arc::new(AtomicU64::new(0));
    let stderr_join = {
        let sink = stderr_lines.clone();
        let tick2 = tick.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr_handle);
            for line in reader.lines().map_while(Result::ok) {
                tick2.fetch_add(1, Ordering::Relaxed);
                let mut v = sink.lock().unwrap();
                if v.len() < STDERR_CAP {
                    v.push(line);
                }
            }
        })
    };

    // Stall watchdog: yt-dlp stuck on a hung connection gets tree-killed.
    let stop = Arc::new(AtomicBool::new(false));
    {
        let app2 = app.clone();
        let id2 = id.to_string();
        let tick2 = tick.clone();
        let stop2 = stop.clone();
        std::thread::spawn(move || {
            let mut last_seen = 0u64;
            let mut idle_ticks = 0u64;
            while !stop2.load(Ordering::Relaxed) {
                std::thread::sleep(Duration::from_secs(5));
                if stop2.load(Ordering::Relaxed) {
                    break;
                }
                let now = tick2.load(Ordering::Relaxed);
                if now == last_seen {
                    idle_ticks += 5;
                } else {
                    idle_ticks = 0;
                    last_seen = now;
                }
                if idle_ticks >= STALL_SECS {
                    let state = app2.state::<DownloadState>();
                    state.mark_timeout(&id2);
                    break;
                }
            }
        });
    }

    let mut stdout_error: Option<String> = None;
    {
        let reader = BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            tick.fetch_add(1, Ordering::Relaxed);
            if let Some(rest) = line.strip_prefix("[download] Destination:") {
                *last_file.lock().unwrap() =
                    Some(rest.trim().trim_matches('"').to_string());
            }
            if line.starts_with("[download]") {
                if let Some(mut p) = parse_progress_line(&line, phase, last_file.lock().unwrap().clone()) {
                    p.id = id.to_string();
                    let _ = app.emit("download-progress", p);
                }
            } else if line.starts_with("ERROR:") || line.starts_with("yt-dlp: error") {
                stdout_error = Some(truncate(line.trim(), 300));
            }
        }
    }
    stop.store(true, Ordering::Relaxed);

    let exit_ok = state.take_and_wait(id).unwrap_or(false);
    // Make sure the final stderr lines land before we inspect them.
    let _ = stderr_join.join();

    if flags.cancelled.load(Ordering::Relaxed) {
        return PassOutcome::Cancelled;
    }
    if flags.timed_out.load(Ordering::Relaxed) {
        return PassOutcome::TimedOut;
    }

    let stderr_snapshot = stderr_lines.lock().unwrap().clone();
    let unsupported_js = stderr_snapshot
        .iter()
        .any(|l| l.contains("no such option") && l.contains("js-runtimes"));

    if exit_ok {
        return PassOutcome::Ok;
    }
    if unsupported_js {
        return PassOutcome::OptionUnsupported;
    }
    if let Some(err) = stdout_error {
        return PassOutcome::Failed(err);
    }
    match extract_error(stderr_snapshot) {
        Some(msg) => PassOutcome::Failed(msg),
        None => PassOutcome::Failed(format!(
            "yt-dlp exited with an error (code {})",
            if exit_ok { 0 } else { 1 }
        )),
    }
}

fn build_passes(
    mode: &str,
    quality: u32,
    container: &str,
    audio_bitrate: u32,
    audio_format: &str,
    extras: Vec<String>,
    trim_args: Vec<String>,
) -> Result<Vec<(String, Vec<String>)>, String> {
    let passes: Vec<(String, Vec<String>)> = match mode {
        "video" => {
            let mut args = video_quality_args(quality, container);
            args.extend(extras);
            args.extend(trim_args);
            vec![("video".to_string(), args)]
        }
        "audio" => {
            let mut args = audio_quality_args(audio_bitrate, audio_format);
            args.extend(extras);
            args.extend(trim_args);
            vec![("audio".to_string(), args)]
        }
        "both" => {
            let mut video_args = video_quality_args(quality, container);
            video_args.extend(extras.clone());
            video_args.extend(trim_args.clone());
            let mut audio_args = audio_quality_args(audio_bitrate, audio_format);
            audio_args.extend(extras);
            audio_args.extend(trim_args);
            vec![
                ("video".to_string(), video_args),
                ("audio".to_string(), audio_args),
            ]
        }
        "thumbnail" => {
            let t_args = vec![
                "--write-thumbnail".to_string(),
                "--convert-thumbnails".to_string(),
                "jpg".to_string(),
                "--skip-download".to_string(),
            ];
            vec![("thumbnail".to_string(), t_args)]
        }
        other => return Err(format!("Unknown mode: {other}")),
    };
    Ok(passes)
}

fn run_job(
    app: AppHandle,
    id: String,
    url: String,
    folder: String,
    passes: Vec<(String, Vec<String>)>,
    cookies: Vec<String>,
    browser: String,
    playlist: bool,
    flags: Arc<Flags>,
) {
    let state = app.state::<DownloadState>();
    let last_file = Arc::new(Mutex::new(None::<String>));
    let mut js_runtime = detect_js_runtime();
    let mut current_phase = passes
        .first()
        .map(|p| p.0.clone())
        .unwrap_or_else(|| "video".into());
    let outcome = loop {
        let mut outcome = PassOutcome::Ok;
        for (phase, base_args) in &passes {
            current_phase = phase.clone();
            if flags.cancelled.load(Ordering::Relaxed) {
                outcome = PassOutcome::Cancelled;
                break;
            }
            let mut args = base_args.clone();
            args.extend(cookies.clone());
            if let Some(runtime) = js_runtime {
                args.extend(["--js-runtimes".to_string(), runtime.to_string()]);
            }
            outcome = read_pass(
                &app,
                &state,
                &id,
                args,
                &url,
                &folder,
                phase,
                playlist,
                &flags,
                &last_file,
            );
            if outcome != PassOutcome::Ok {
                break;
            }
        }
        // Older yt-dlp doesn't know --js-runtimes → retry once without it.
        if outcome == PassOutcome::OptionUnsupported && js_runtime.is_some() {
            js_runtime = None;
            continue;
        }
        break outcome;
    };

    let file = last_file.lock().unwrap().clone();
    match outcome {
        PassOutcome::Ok => {
            emit(&app, &id, "done", &current_phase, 100.0, None, None, file, None);
        }
        PassOutcome::Cancelled => {
            emit(&app, &id, "cancelled", &current_phase, 0.0, None, None, None, None);
        }
        PassOutcome::TimedOut => {
            emit(
                &app,
                &id,
                "error",
                &current_phase,
                0.0,
                None,
                None,
                None,
                Some(format!(
                    "yt-dlp stopped responding (no output for {STALL_SECS}s) — killed."
                )),
            );
        }
        PassOutcome::OptionUnsupported | PassOutcome::Failed(_) => {
            let msg = match outcome {
                PassOutcome::Failed(m) => {
                    hint_for_error(&fix_cookie_browser_name(&m, &browser))
                }
                _ => "yt-dlp does not support the --js-runtimes flag — update yt-dlp.".into(),
            };
            emit(&app, &id, "error", &current_phase, 0.0, None, None, None, Some(msg));
        }
    }
    state.finish(&id);
}

#[tauri::command]
pub async fn start_download(
    app: AppHandle,
    state: State<'_, DownloadState>,
    id: String,
    url: String,
    mode: String,
    quality: u32,
    container: String,
    audio_bitrate: u32,
    audio_format: String,
    save_thumbnail: bool,
    embed_thumbnail: bool,
    embed_metadata: bool,
    subtitles: bool,
    playlist: bool,
    cookies_browser: Option<String>,
    cookies_file: Option<String>,
    folder: Option<String>,
    trim_start: Option<f64>,
    trim_end: Option<f64>,
) -> Result<(), String> {
    if id.trim().is_empty() {
        return Err("Missing download id".into());
    }
    validate_media_url(&url)?;
    let cookies = cookies_args(&cookies_browser, &cookies_file)?;
    if !matches!(mode.as_str(), "video" | "audio" | "both" | "thumbnail") {
        return Err(format!("Unknown mode: {mode}"));
    }

    let folder = folder
        .filter(|f| !f.trim().is_empty())
        .unwrap_or_else(default_folder);
    std::fs::create_dir_all(&folder).map_err(|e| format!("Cannot create folder {folder}: {e}"))?;

    let extras = extras_args(save_thumbnail, embed_thumbnail, embed_metadata, subtitles);

    let mut trim_args: Vec<String> = Vec::new();
    if let (Some(s), Some(e)) = (trim_start, trim_end) {
        if e > s && s >= 0.0 {
            trim_args.push("--download-sections".to_string());
            trim_args.push(format!("*{}-{}", s.floor() as u64, e.ceil() as u64));
        }
    }

    // Build passes first — a validation failure must not touch job state.
    let passes = build_passes(
        &mode,
        quality,
        &container,
        audio_bitrate,
        &audio_format,
        extras,
        trim_args,
    )?;

    let flags = state.begin(&id)?;
    let app2 = app.clone();
    let browser = cookies_browser
        .filter(|b| b != "none")
        .unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || {
        run_job(app2, id, url, folder, passes, cookies, browser, playlist, flags);
    });
    Ok(())
}

#[tauri::command]
pub fn cancel_download(state: State<'_, DownloadState>, id: String) -> bool {
    state.cancel(&id)
}

impl DownloadState {
    fn stdout_of(&self, id: &str) -> Option<std::process::ChildStdout> {
        let mut jobs = self.jobs.lock().unwrap();
        jobs.get_mut(id)?.child.as_mut()?.stdout.take()
    }

    fn stderr_of(&self, id: &str) -> Option<std::process::ChildStderr> {
        let mut jobs = self.jobs.lock().unwrap();
        jobs.get_mut(id)?.child.as_mut()?.stderr.take()
    }
}

#[cfg(test)]
mod progress_tests {
    use super::parse_progress_line;

    #[test]
    fn parses_a_real_ytdlp_line() {
        let p = parse_progress_line(
            "[download]  42.3% of  12.34MiB at    5.67MiB/s ETA 00:02",
            "video",
            None,
        )
        .expect("should parse");
        assert!((p.percent - 42.3).abs() < 0.01);
        assert_eq!(p.speed.as_deref(), Some("5.67MiB/s"));
        assert_eq!(p.eta.as_deref(), Some("00:02"));
        assert_eq!(p.phase, "video");
    }

    #[test]
    fn non_progress_lines_are_none() {
        assert!(parse_progress_line("[info] downloading metadata", "video", None).is_none());
        assert!(parse_progress_line("", "video", None).is_none());
    }

    #[test]
    fn percent_is_clamped_to_100() {
        let p = parse_progress_line("[download] 150% of 1MiB", "audio", None).unwrap();
        assert_eq!(p.percent, 100.0);
    }
}
