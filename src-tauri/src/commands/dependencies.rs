use std::time::Duration;

use serde::Serialize;

use crate::commands::{
    extract_error, fix_cookie_browser_name, hint_for_error, is_valid_browser, run_with_timeout,
    truncate,
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DependencyStatus {
    pub has_ytdlp: bool,
    pub has_ffmpeg: bool,
    pub ytdlp_version: Option<String>,
    pub ffmpeg_version: Option<String>,
}

/// On Windows, a process inherits the PATH captured at launch — so a fresh
/// `winget install` is invisible to "Recheck" unless we merge the registry
/// PATH into our own environment first.
#[cfg(windows)]
fn refresh_path() {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;

    let mut current: Vec<String> = std::env::var("PATH")
        .unwrap_or_default()
        .split(';')
        .filter(|p| !p.trim().is_empty())
        .map(String::from)
        .collect();
    let mut merge = |val: String| {
        for p in val.split(';') {
            let t = p.trim();
            if !t.is_empty() && !current.iter().any(|c| c.eq_ignore_ascii_case(t)) {
                current.push(t.to_string());
            }
        }
    };
    let hk = RegKey::predef(HKEY_LOCAL_MACHINE);
    if let Ok(env) = hk.open_subkey(r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment") {
        if let Ok(v) = env.get_value::<String, _>("Path") {
            merge(v);
        }
    }
    let cu = RegKey::predef(HKEY_CURRENT_USER);
    if let Ok(env) = cu.open_subkey("Environment") {
        if let Ok(v) = env.get_value::<String, _>("Path") {
            merge(v);
        }
    }
    std::env::set_var("PATH", current.join(";"));
}

#[cfg(not(windows))]
fn refresh_path() {}

fn check_bin(bin: &str, arg: &str) -> (bool, Option<String>) {
    let mut cmd = std::process::Command::new(bin);
    cmd.arg(arg);
    match run_with_timeout(cmd, Duration::from_secs(10)) {
        Ok(out) if out.success && !out.stdout.iter().all(|b| b.is_ascii_whitespace()) => {
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
pub async fn check_dependencies() -> DependencyStatus {
    tauri::async_runtime::spawn_blocking(|| {
        refresh_path();
        let (has_ytdlp, ytdlp_version) = check_bin("yt-dlp", "--version");
        let (has_ffmpeg, ffmpeg_version) = check_bin("ffmpeg", "-version");
        DependencyStatus {
            has_ytdlp,
            has_ffmpeg,
            ytdlp_version,
            ffmpeg_version,
        }
    })
    .await
    .unwrap_or(DependencyStatus {
        has_ytdlp: false,
        has_ffmpeg: false,
        ytdlp_version: None,
        ffmpeg_version: None,
    })
}

/// Ask yt-dlp to actually load the browser's cookie DB once and report the
/// truth — DPAPI/app-bound encryption failures show up here in ~1s, before
/// the user wastes a fetch on them.
#[tauri::command]
pub async fn check_browser_cookies(browser: String) -> Result<String, String> {
    if !is_valid_browser(&browser) {
        return Err(format!("Unsupported browser for cookies: {browser}"));
    }
    tauri::async_runtime::spawn_blocking(move || {
        refresh_path();
        let mut cmd = std::process::Command::new("yt-dlp");
        cmd.args([
            "--cookies-from-browser",
            &browser,
            "-v",
            "--simulate",
            "--skip-download",
            "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
        ]);
        let out = run_with_timeout(cmd, Duration::from_secs(25))?;
        let lower = out.stderr.to_lowercase();
        if lower.contains("cookies from the") || (lower.contains("extracted") && lower.contains("cookies"))
        {
            return Ok(format!("Cookies from {} loaded ✔", browser));
        }
        if let Some(err) = extract_error(out.stderr.lines().map(String::from)) {
            return Err(hint_for_error(&fix_cookie_browser_name(&err, &browser)));
        }
        if out.success {
            Ok(format!("Cookies from {} loaded ✔", browser))
        } else {
            Err(hint_for_error(&format!(
                "yt-dlp could not load cookies from {browser}"
            )))
        }
    })
    .await
    .map_err(|e| format!("internal error: {e}"))?
}

/// Runs `yt-dlp --update` (the exe's built-in updater; winget-managed installs
/// usually refuse it, and the real error is surfaced verbatim).
#[tauri::command]
pub async fn update_ytdlp() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| {
        refresh_path();
        let mut cmd = std::process::Command::new("yt-dlp");
        cmd.arg("--update");
        let out = run_with_timeout(cmd, Duration::from_secs(300))?;
        if out.timed_out {
            return Err("yt-dlp --update timed out after 300s".into());
        }
        let tail = if out.success {
            String::from_utf8_lossy(&out.stdout)
                .lines()
                .last()
                .unwrap_or("yt-dlp updated")
                .to_string()
        } else {
            return Err(truncate(
                &extract_error(out.stderr.lines().map(String::from))
                    .unwrap_or_else(|| "yt-dlp --update failed".into()),
                240,
            ));
        };
        Ok(tail)
    })
    .await
    .map_err(|e| format!("internal error: {e}"))?
}
