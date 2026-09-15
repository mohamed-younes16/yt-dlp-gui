use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use super::{
    apply_py_utf8, cookies_args, detect_js_runtime, extract_error, fix_cookie_browser_name,
    hide_window, hint_for_error, kill_tree, truncate, validate_media_url,
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

/// Rigid filename sanitization that keeps the title's shape: every character
/// that is illegal in a file name (Windows set — the strictest mainstream OS)
/// becomes its fullwidth lookalike instead of being stripped, so
/// `A | B` stays readable as `A ｜ B`. Also neutralizes `%` so a title can
/// never act as an output-template placeholder, and drops control chars.
pub fn sanitize_filename_stem(title: &str) -> String {
    let mut s: String = title
        .chars()
        .map(|c| match c {
            '<' => '＜',
            '>' => '＞',
            ':' => '：',
            '"' => '＂',
            '/' => '／',
            '\\' => '＼',
            '|' => '｜',
            '?' => '？',
            '*' => '＊',
            '%' => '％',
            c if c.is_control() => '_',
            c => c,
        })
        .collect();
    // Windows forbids trailing dots/spaces (it silently strips them, which
    // would desync our expected file name from the real one) — swap them for
    // lookalikes instead of dropping them.
    fix_trailing_dots_spaces(&mut s);
    if s.trim().is_empty() {
        return "video".to_string();
    }
    // Reserved DOS device names (CON, PRN, AUX, NUL, COM1-9, LPT1-9).
    const RESERVED: [&str; 22] = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6",
        "COM7", "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6",
        "LPT7", "LPT8", "LPT9",
    ];
    if RESERVED.contains(&s.to_ascii_uppercase().as_str()) {
        s.push('_');
    }
    // Cap the stem so folder + ` [id].ext` can never approach MAX_PATH.
    const MAX_STEM_CHARS: usize = 120;
    if s.chars().count() > MAX_STEM_CHARS {
        s = s.chars().take(MAX_STEM_CHARS).collect();
        fix_trailing_dots_spaces(&mut s);
    }
    s
}

/// Trailing `.` → `․` (one-dot leader) and ` ` → `　` (ideographic space):
/// visually identical, but legal on Windows and never silently stripped.
fn fix_trailing_dots_spaces(s: &mut String) {
    let mut chars: Vec<char> = s.chars().collect();
    let mut changed = false;
    // Walk the ORIGINAL trailing run backwards — matching on our own
    // replacements (․/　) would stop the loop after one step.
    for c in chars.iter_mut().rev() {
        match c {
            '.' => {
                *c = '․';
                changed = true;
            }
            ' ' => {
                *c = '　';
                changed = true;
            }
            _ => break,
        }
    }
    if changed {
        *s = chars.into_iter().collect();
    }
}

/// Output template built from OUR sanitized title — never from yt-dlp's raw
/// `%(title)s`. The `[%(id)s]` suffix keeps every entry unique (playlists
/// included) since ids are `[A-Za-z0-9_-]` by construction.
pub fn output_template(title: &str) -> String {
    format!("{} [%(id)s].%(ext)s", sanitize_filename_stem(title))
}

/// True when a yt-dlp failure message means "couldn't create the output file"
/// (Windows `Errno 22`/`Errno 2`, filename rejected, folder missing…). Those
/// are worth one retry under a guaranteed-ASCII name before surfacing.
pub fn is_file_open_error(msg: &str) -> bool {
    let l = msg.to_lowercase();
    l.contains("unable to open for writing")
        || l.contains("errno 22")
        || (l.contains("errno 2") && l.contains("invalid argument"))
        || l.contains("invalid filename")
}

/// Last-resort stem: pure ASCII so no filesystem, sync client, or legacy
/// codepage can reject it. Keeps letters/digits plus `_-.,()[] `, collapses
/// everything else to `_` (no consecutive runs), trims edge junk, caps at 80
/// chars. Never empty, never a reserved DOS name.
pub fn ascii_safe_stem(title: &str) -> String {
    let mut s = String::with_capacity(title.len());
    let mut last_underscore = false;
    for c in title.chars() {
        let keep = c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ',' | '(' | ')' | '[' | ']' | ' ');
        if keep {
            s.push(c);
            last_underscore = false;
        } else if !last_underscore {
            s.push('_');
            last_underscore = true;
        }
    }
    let mut s = s.trim().trim_matches('.').trim().to_string();
    // Collapse any accidental double spaces from replacement seams.
    while s.contains("  ") {
        s = s.replace("  ", " ");
    }
    if s.trim().is_empty() {
        return "video".to_string();
    }
    const RESERVED: [&str; 22] = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6",
        "COM7", "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6",
        "LPT7", "LPT8", "LPT9",
    ];
    if RESERVED.contains(&s.to_ascii_uppercase().as_str()) {
        s.push('_');
    }
    const MAX_ASCII_CHARS: usize = 80;
    if s.chars().count() > MAX_ASCII_CHARS {
        s = s.chars().take(MAX_ASCII_CHARS).collect();
        s = s.trim().trim_matches('.').trim().to_string();
        if s.is_empty() {
            return "video".to_string();
        }
    }
    s
}

/// Fallback template: same `[id].ext` uniqueness, ASCII-only stem. Used for
/// exactly one retry when the pretty fullwidth name is rejected.
pub fn fallback_template(title: &str) -> String {
    format!("{} [%(id)s].%(ext)s", ascii_safe_stem(title))
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
    output_template: &str,
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
        // Our own sanitized name (never yt-dlp's raw %(title)s).
        "-o".to_string(),
        output_template.to_string(),
    ];
    // Second layer: force Win32-legal names for anything else yt-dlp writes.
    if cfg!(windows) {
        full.push("--windows-filenames".to_string());
    }
    if !playlist {
        full.push("--no-playlist".to_string());
    }
    full.extend(args);
    // Dev-terminal log AFTER assembly: the exact invocation, replayable
    // verbatim in a shell. No secrets here — only paths, flags, and the URL.
    eprintln!("[ytdl-gui] pass '{phase}' argv: yt-dlp {}", full.join(" "));

    emit(app, id, "starting", phase, 0.0, None, None, None, None);

    let mut cmd = Command::new("yt-dlp");
    apply_py_utf8(&mut cmd);
    // Prove in the dev log that the child really carries the UTF-8 env —
    // settles "is the running binary stale?" without guessing.
    let pyenv: Vec<String> = cmd
        .get_envs()
        .filter_map(|(k, v)| {
            let k = k.to_str()?;
            (k == "PYTHONUTF8" || k == "PYTHONIOENCODING")
                .then(|| format!("{k}={}", v.and_then(|x| x.to_str()).unwrap_or("?")))
        })
        .collect();
    eprintln!("[ytdl-gui] pyenv: {}", pyenv.join(" "));
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
            // filter_map, NOT map_while: a single non-UTF8 line (ffmpeg
            // banners, locale-specific progress) must be skipped, never
            // truncate the whole stream and hide the real error tail.
            for line in reader.lines().filter_map(|r| r.ok()) {
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
    // Last `[Section]` header seen on stdout — tells the user-facing error
    // exactly which stage died (download vs ExtractAudio vs EmbedThumbnail…).
    let mut last_step: Option<String> = None;
    {
        let reader = BufReader::new(stdout);
        // filter_map, NOT map_while: one undecodable line must not swallow
        // every later line (progress, Destination, ERROR).
        for line in reader.lines().filter_map(|r| r.ok()) {
            tick.fetch_add(1, Ordering::Relaxed);
            if line.starts_with('[') {
                if let Some(end) = line.find(']') {
                    last_step = Some(line[1..end].to_string());
                }
            }
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
        return fail_with_log(&stderr_snapshot, err, &last_step, phase);
    }
    match extract_error(stderr_snapshot.iter().cloned()) {
        Some(msg) => fail_with_log(&stderr_snapshot, msg, &last_step, phase),
        None => fail_with_log(
            &stderr_snapshot,
            format!(
                "yt-dlp exited with an error (code {})",
                if exit_ok { 0 } else { 1 }
            ),
            &last_step,
            phase,
        ),
    }
}

/// Failure path: tag the message with the stage that died, and dump the full
/// stderr snapshot to the dev terminal so the exact yt-dlp failure is visible
/// without re-running anything.
fn fail_with_log(
    stderr: &[String],
    msg: String,
    last_step: &Option<String>,
    phase: &str,
) -> PassOutcome {
    eprintln!(
        "[ytdl-gui] pass '{phase}' failed during step '{}'\n--- yt-dlp stderr ---\n{}\n--- end stderr ---",
        last_step.as_deref().unwrap_or("?"),
        stderr.join("\n")
    );
    PassOutcome::Failed(with_step(msg, last_step))
}

/// Append `(during <Step>)` so the UI error names the failing stage.
fn with_step(msg: String, last_step: &Option<String>) -> String {
    match last_step {
        Some(s) => format!("{msg} (during {s})"),
        None => msg,
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
    output_template: String,
    fallback_output_template: String,
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
    let mut template_in_use = output_template.clone();
    let mut tried_fallback = false;
    // Name shown in the final error so the user (and the dev log) can see
    // which of the two names yt-dlp actually choked on.
    let mut failed_template_note = String::new();
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
                &template_in_use,
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
        // Filename rejected (Errno 22 et al.) → one retry under a pure-ASCII
        // name. Stale partials keep their own names; reset the tracked file
        // so a fallback success never reports the dead pretty path.
        if let PassOutcome::Failed(ref msg) = outcome {
            if !tried_fallback && is_file_open_error(msg) && template_in_use != fallback_output_template {
                eprintln!(
                    "[ytdl-gui] pass template rejected ({msg:?}); retrying once as {fallback_output_template:?}"
                );
                failed_template_note = format!(" (first name failed: {template_in_use:?})");
                template_in_use = fallback_output_template.clone();
                tried_fallback = true;
                *last_file.lock().unwrap() = None;
                continue;
            }
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
            let mut msg = match outcome {
                PassOutcome::Failed(m) => {
                    hint_for_error(&fix_cookie_browser_name(&m, &browser))
                }
                _ => "yt-dlp does not support the --js-runtimes flag — update yt-dlp.".into(),
            };
            if !failed_template_note.is_empty() {
                msg.push_str(&failed_template_note);
            }
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
    title: String,
    mode: String,    quality: u32,
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

    // The file name comes from OUR sanitized title — rigid, shape-preserving,
    // and immune to whatever yt-dlp would otherwise derive from raw metadata.
    // A pure-ASCII fallback rides along for one retry if the OS rejects the
    // pretty name (Errno 22 on exotic/legacy targets).
    let template = output_template(&title);
    let fallback = fallback_template(&title);
    eprintln!("[ytdl-gui] download {id} mode={mode} template={template:?} fallback={fallback:?}");
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
        run_job(app2, id, url, folder, template, fallback, passes, cookies, browser, playlist, flags);
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
    use super::{
        ascii_safe_stem, fallback_template, is_file_open_error, output_template,
        parse_progress_line, sanitize_filename_stem, with_step,
    };

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

    #[test]
    fn sanitizer_keeps_shape_with_lookalikes() {
        assert_eq!(sanitize_filename_stem("a | b"), "a ｜ b");
        assert_eq!(
            sanitize_filename_stem("<>:\"/\\|?*"),
            "＜＞：＂／＼｜？＊"
        );
        // The exact title that failed with Errno 22 on Windows.
        // (trailing `.` becomes ｡-like U+2024 so Windows can't strip it.)
        assert_eq!(
            sanitize_filename_stem("♪ Kaiser e Isagi (Blue Lock) | Prodígios | AniRap ft. Lucas A.R.T."),
            "♪ Kaiser e Isagi (Blue Lock) ｜ Prodígios ｜ AniRap ft. Lucas A.R.T․"
        );
    }

    #[test]
    fn sanitizer_is_rigid() {
        // % must never survive — it would act as an output-template placeholder.
        assert_eq!(sanitize_filename_stem("100% %(id)s"), "100％ ％(id)s");
        // Control characters, trailing dots/spaces (lookalikes, not stripped),
        // empties, reserved names.
        assert_eq!(sanitize_filename_stem("a\x00b"), "a_b");
        assert_eq!(
            sanitize_filename_stem("Video...   "),
            "Video․․․\u{3000}\u{3000}\u{3000}"
        );
        assert_eq!(sanitize_filename_stem("   "), "video");
        assert_eq!(sanitize_filename_stem("CON"), "CON_");
        // Absurd titles get capped without splitting a character.
        let long = "é".repeat(200);
        let cut = sanitize_filename_stem(&long);
        assert_eq!(cut.chars().count(), 120);
        // Clean titles pass through byte-identical.
        assert_eq!(sanitize_filename_stem("HIGURUMA meme template"), "HIGURUMA meme template");
    }

    #[test]
    fn template_pins_id_for_uniqueness() {
        assert_eq!(
            output_template("a | b"),
            "a ｜ b [%(id)s].%(ext)s"
        );
    }

    #[test]
    fn step_suffix_names_the_stage() {
        assert_eq!(
            with_step("boom".into(), &Some("EmbedThumbnail".into())),
            "boom (during EmbedThumbnail)"
        );
        assert_eq!(with_step("boom".into(), &None), "boom");
    }

    #[test]
    fn file_open_errors_are_detected() {
        assert!(is_file_open_error(
            "ERROR: unable to open for writing: [Errno 22] Invalid argument"
        ));
        assert!(is_file_open_error("ERROR: Unable to Open for Writing: errno 2 stuff"));
        assert!(!is_file_open_error("ERROR: HTTP Error 403"));
        assert!(!is_file_open_error("yt-dlp exited with an error"));
    }

    #[test]
    fn ascii_fallback_is_pure_ascii_and_stable() {
        let s = ascii_safe_stem("♪ Bastard X PXG ( Blue Lock ) | Liga Neo Egoísta PT 4 | AniRap");
        assert!(s.is_ascii(), "fallback must be ASCII, got {s:?}");
        assert!(!s.contains('|') && !s.contains("  "));
        assert_eq!(
            s,
            "_ Bastard X PXG ( Blue Lock ) _ Liga Neo Ego_sta PT 4 _ AniRap"
        );
        assert_eq!(ascii_safe_stem("   "), "video");
        assert_eq!(ascii_safe_stem("CON"), "CON_");
        assert_eq!(ascii_safe_stem("100% %(id)s"), "100_ _(id)s");
        let long = "é".repeat(200);
        assert!(ascii_safe_stem(&long).chars().count() <= 80);
        assert_eq!(
            fallback_template("a | b"),
            "a _ b [%(id)s].%(ext)s"
        );
    }
}
