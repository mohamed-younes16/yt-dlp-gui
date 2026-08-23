use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use super::hide_window;

#[derive(Default)]
pub struct DownloadState {
    pub child: Mutex<Option<Child>>,
    pub busy: Mutex<bool>,
    pub cancelled: Mutex<bool>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub status: String, // starting | downloading | done | cancelled | error
    pub phase: String,  // video | audio
    pub percent: f64,
    pub speed: Option<String>,
    pub eta: Option<String>,
    pub file: Option<String>,
}

fn default_folder() -> String {
    #[cfg(windows)]
    {
        if let Ok(home) = std::env::var("USERPROFILE") {
            let p = std::path::Path::new(&home).join("Downloads");
            if p.exists() {
                return p.to_string_lossy().into_owned();
            }
            return home;
        }
    }
    #[cfg(not(windows))]
    {
        if let Ok(home) = std::env::var("HOME") {
            let p = std::path::Path::new(&home).join("Downloads");
            if p.exists() {
                return p.to_string_lossy().into_owned();
            }
        }
    }
    ".".to_string()
}

fn video_quality_args(quality: u32, container: &str) -> Vec<String> {
    let mut args = vec![
        "-f".to_string(),
        format!("bv*[height<={q}]+ba/b[height<={q}]", q = quality),
    ];
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
    args
}

fn emit(app: &AppHandle, progress: DownloadProgress) {
    let _ = app.emit("download-progress", progress);
}

fn read_progress(
    app: &AppHandle,
    stdout: Option<std::process::ChildStdout>,
    phase: &str,
) -> Option<String> {
    let stdout = stdout?;
    let reader = BufReader::new(stdout);
    let mut last_file: Option<String> = None;
    let mut error: Option<String> = None;

    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => break,
        };

        if let Some(rest) = line.strip_prefix("[download] Destination:") {
            last_file = Some(rest.trim().trim_matches('"').to_string());
        }

        if line.starts_with("[download]") {
            if let Some(p) = parse_progress_line(&line, phase, last_file.clone()) {
                emit(app, p);
            }
        } else if line.starts_with("ERROR:") || line.starts_with("yt-dlp: error") {
            error = Some(line.trim().to_string());
        }
    }
    error
}

fn parse_progress_line(
    line: &str,
    phase: &str,
    file: Option<String>,
) -> Option<DownloadProgress> {
    // Expected shape:
    // [download]  42.3% of   10.00MiB at    2.00MiB/s ETA 00:05
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
        status: "downloading".into(),
        phase: phase.into(),
        percent: percent?,
        speed,
        eta,
        file,
    })
}

fn run_pass(
    app: &AppHandle,
    state: &DownloadState,
    url: &str,
    mut args: Vec<String>,
    folder: &str,
    phase: &str,
) -> Result<(), String> {
    args.splice(
        0..0,
        vec![
            url.to_string(),
            "--newline".to_string(),
            "--no-playlist".to_string(),
            
            "-P".to_string(),
            folder.to_string(),
        ],
    );

    *state.cancelled.lock().unwrap() = false;

    let mut cmd = Command::new("yt-dlp");
    cmd.args(&args).stdout(Stdio::piped()).stderr(Stdio::piped());
    hide_window(&mut cmd);

    emit(
        app,
        DownloadProgress {
            status: "starting".into(),
            phase: phase.into(),
            percent: 0.0,
            speed: None,
            eta: None,
            file: None,
        },
    );

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Could not start yt-dlp: {e}. Is it on PATH?"))?;

    let stdout = child.stdout.take();
    *state.child.lock().unwrap() = Some(child);

    let error = read_progress(app, stdout, phase);

    let exit_ok = {
        let mut guard = state.child.lock().unwrap();
        match guard.take() {
            Some(mut c) => c.wait().map(|s| s.success()).unwrap_or(false),
            None => false, // already taken by cancel
        }
    };

    if state.cancelled.lock().unwrap().clone() {
        return Err("__cancelled__".into());
    }

    if let Some(err) = error {
        return Err(err);
    }

    if !exit_ok {
        return Err("yt-dlp exited with an error".into());
    }

    Ok(())
}

fn finish(app: &AppHandle, state: &DownloadState, result: Result<(), String>) -> Result<(), String> {
    *state.busy.lock().unwrap() = false;
    match &result {
        Err(e) if e == "__cancelled__" => {
            emit(
                app,
                DownloadProgress {
                    status: "cancelled".into(),
                    phase: "video".into(),
                    percent: 0.0,
                    speed: None,
                    eta: None,
                    file: None,
                },
            );
            Ok(())
        }
        Err(_) => {
            emit(
                app,
                DownloadProgress {
                    status: "error".into(),
                    phase: "video".into(),
                    percent: 0.0,
                    speed: None,
                    eta: None,
                    file: None,
                },
            );
            result
        }
        Ok(()) => {
            emit(
                app,
                DownloadProgress {
                    status: "done".into(),
                    phase: "video".into(),
                    percent: 100.0,
                    speed: None,
                    eta: None,
                    file: None,
                },
            );
            Ok(())
        }
    }
}

#[tauri::command]
pub fn start_download(
    app: AppHandle,
    url: String,
    mode: String,            // "video" | "audio" | "both" | "thumbnail"
    quality: u32,            // video height cap (e.g. 1080)
    container: String,       // video container: mp4 | mkv | webm
    audio_bitrate: u32,      // audio bitrate kbps (e.g. 320)
    audio_format: String,    // audio format: mp3 | m4a | opus | wav
    save_thumbnail: bool,
    embed_thumbnail: bool,
    embed_metadata: bool,
    folder: Option<String>, // empty/None -> user's Downloads
    trim_start: Option<f64>,
    trim_end: Option<f64>,
) -> Result<(), String> {
    let state = app.state::<DownloadState>();

    {
        let mut busy = state.busy.lock().unwrap();
        if *busy {
            return Err("A download is already running".into());
        }
        *busy = true;
    }

    let folder = folder
        .filter(|f| !f.trim().is_empty())
        .unwrap_or_else(default_folder);

    let mut extras = extras_args(save_thumbnail, embed_thumbnail, embed_metadata);

    // trim via yt-dlp download-sections (requires ffmpeg)
    let mut trim_args: Vec<String> = Vec::new();
    if let (Some(s), Some(e)) = (trim_start, trim_end) {
        if e > s && s >= 0.0 {
            trim_args.push("--download-sections".to_string());
            // yt-dlp accepts seconds or HH:MM:SS; use integer seconds
            trim_args.push(format!("*{}-{}", s as u64, e as u64));
        }
    }

    let passes: Vec<(String, Vec<String>)> = match mode.as_str() {
        "video" => {
            let mut args = video_quality_args(quality, &container);
            args.append(&mut extras);
            args.extend(trim_args.clone());
            vec![("video".to_string(), args)]
        }
        "audio" => {
            let mut args = audio_quality_args(audio_bitrate, &audio_format);
            args.append(&mut extras);
            args.extend(trim_args.clone());
            vec![("audio".to_string(), args)]
        }
        "both" => {
            let mut video_args = video_quality_args(quality, &container);
            let extra_video = extras.clone();
            video_args.extend(extra_video);
            video_args.extend(trim_args.clone());
            let mut audio_args = audio_quality_args(audio_bitrate, &audio_format);
            audio_args.append(&mut extras);
            audio_args.extend(trim_args.clone());
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
            vec![("video".to_string(), t_args)]
        }
        other => {
            *state.busy.lock().unwrap() = false;
            return Err(format!("Unknown mode: {other}"));
        }
    };

    let result = (|| {
        for (phase, args) in passes {
            if let Err(e) = run_pass(&app, &state, &url, args, &folder, &phase) {
                return finish(&app, &state, Err(e));
            }
        }
        finish(&app, &state, Ok(()))
    })();

    result
}

#[tauri::command]
pub fn cancel_download(state: State<'_, DownloadState>) -> Result<bool, String> {
    *state.cancelled.lock().unwrap() = true;
    let mut guard = state.child.lock().unwrap();
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
        let _ = child.wait();
        Ok(true)
    } else {
        Ok(false)
    }
}
