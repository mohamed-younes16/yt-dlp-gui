use serde::Serialize;

use crate::commands::hide_window;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DependencyStatus {
    pub has_ytdlp: bool,
    pub has_ffmpeg: bool,
    pub ytdlp_version: Option<String>,
    pub ffmpeg_version: Option<String>,
}

fn check_bin(bin: &str, arg: &str) -> (bool, Option<String>) {
    let mut cmd = std::process::Command::new(bin);
    cmd.arg(arg);
    hide_window(&mut cmd);
    match cmd.output() {
        Ok(out) if out.status.success() => {
            let v = String::from_utf8_lossy(&out.stdout)
                .lines()
                .next()
                .unwrap_or("")
                .trim()
                .to_string();
            let ver = if v.is_empty() { None } else { Some(v) };
            (true, ver)
        }
        _ => (false, None),
    }
}

#[tauri::command]
pub fn check_dependencies() -> DependencyStatus {
    let (has_ytdlp, ytdlp_version) = check_bin("yt-dlp", "--version");
    let (has_ffmpeg, ffmpeg_version) = check_bin("ffmpeg", "-version");
    DependencyStatus {
        has_ytdlp,
        has_ffmpeg,
        ytdlp_version,
        ffmpeg_version,
    }
}
