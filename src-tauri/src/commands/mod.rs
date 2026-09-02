pub mod dependencies;
pub mod download;
pub mod history;
pub mod metadata;

use std::io::Read;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

#[cfg(windows)]
pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[cfg(windows)]
pub fn hide_window(cmd: &mut std::process::Command) {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
pub fn hide_window(_cmd: &mut std::process::Command) {}

/// Kill a child and, on Windows, its whole process tree (yt-dlp spawns ffmpeg
/// as a grandchild; `child.kill()` alone leaves it writing files).
pub fn kill_tree(child: &mut Child) {
    #[cfg(windows)]
    {
        let mut cmd = Command::new("taskkill");
        cmd.args(["/PID", &child.id().to_string(), "/T", "/F"]);
        hide_window(&mut cmd);
        let _ = cmd.output();
    }
    #[cfg(not(windows))]
    {
        let _ = child.kill();
    }
    let _ = child.wait();
}

/// Whitelisted browsers for yt-dlp's `--cookies-from-browser`.
pub fn is_valid_browser(name: &str) -> bool {
    matches!(
        name,
        "brave" | "chrome" | "chromium" | "edge" | "firefox" | "opera" | "safari" | "vivaldi"
    )
}

/// None / empty / "none" mean "don't send any cookie flag". "file" uses an
/// exported cookies.txt (the bulletproof fallback when Chrome/Edge app-bound
/// encryption blocks browser reads — yt-dlp #10927).
pub fn cookies_args(
    browser: &Option<String>,
    file: &Option<String>,
) -> Result<Vec<String>, String> {
    match browser.as_deref().filter(|b| !b.trim().is_empty() && *b != "none") {
        Some("file") => match file.as_deref().map(str::trim).filter(|f| !f.is_empty()) {
            Some(path) if path.starts_with('-') => {
                Err("cookies.txt path must not start with '-'".into())
            }
            Some(path) if std::path::Path::new(path).is_file() => {
                Ok(vec!["--cookies".to_string(), path.to_string()])
            }
            Some(path) => Err(format!("cookies.txt not found: {path}")),
            None => Err("Pick a cookies.txt file under Settings → Sign-in cookies.".into()),
        },
        Some(b) if is_valid_browser(b) => Ok(vec![
            "--cookies-from-browser".to_string(),
            b.to_string(),
        ]),
        Some(b) => Err(format!("Unsupported browser for cookies: {b}")),
        None => Ok(vec![]),
    }
}

/// yt-dlp needs a JS runtime for SABR player data on newer releases.
pub fn detect_js_runtime() -> Option<&'static str> {
    for name in ["bun", "deno", "node"] {
        let mut cmd = Command::new(name);
        cmd.arg("--version");
        cmd.stdout(Stdio::null()).stderr(Stdio::null());
        hide_window(&mut cmd);
        if let Ok(out) = cmd.output() {
            if out.status.success() {
                return Some(name);
            }
        }
    }
    None
}

pub struct TimedOutput {
    pub success: bool,
    pub stdout: Vec<u8>,
    pub stderr: String,
    pub timed_out: bool,
}

/// Spawn with piped stdout/stderr drained on helper threads (so the 4 KB pipe
/// buffer can never deadlock us) and a hard wall-clock timeout that tree-kills
/// the child if it hangs. The pipe handles are taken out of the child *before*
/// the readers start, so the timeout loop never contends with `read_to_end`.
pub fn run_with_timeout(mut cmd: Command, timeout: Duration) -> Result<TimedOutput, String> {
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    hide_window(&mut cmd);
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Could not run `{}`: {e}. Is it installed and on PATH?", get_program(&cmd)))?;
    let stdout_handle = child.stdout.take();
    let stderr_handle = child.stderr.take();
    let child = Arc::new(Mutex::new(child));

    let stdout = std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(mut h) = stdout_handle {
            let _ = h.read_to_end(&mut buf);
        }
        buf
    });
    let stderr = std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(mut h) = stderr_handle {
            let _ = h.read_to_end(&mut buf);
        }
        String::from_utf8_lossy(&buf).to_string()
    });

    let start = Instant::now();
    let mut timed_out = false;
    let success = loop {
        let mut ch = child.lock().unwrap();
        match ch.try_wait() {
            Ok(Some(status)) => break status.success(),
            Ok(None) => {
                if start.elapsed() > timeout {
                    kill_tree(&mut ch);
                    timed_out = true;
                    break false;
                }
                drop(ch);
                std::thread::sleep(Duration::from_millis(80));
            }
            Err(_) => break false,
        }
    };

    let stdout = stdout.join().unwrap_or_default();
    let stderr = stderr.join().unwrap_or_default();
    Ok(TimedOutput {
        success,
        stdout,
        stderr,
        timed_out,
    })
}

fn get_program(cmd: &Command) -> String {
    cmd.get_program().to_string_lossy().to_string()
}

/// Reject anything that isn't a real URL (or an explicit yt-dlp search prefix)
/// so a pasted string can never be parsed by yt-dlp as an *option*
/// (e.g. `--config-locations`, `--exec`).
pub fn validate_media_url(url: &str) -> Result<(), String> {
    let ok = url.starts_with("http://") || url.starts_with("https://");
    if ok {
        Ok(())
    } else {
        Err("Not a valid URL — paste a link starting with http(s)://".into())
    }
}

/// True for yt-dlp search pseudo-URLs: `ytsearch:`, `ytsearch15:`, `ytsearchall:`.
/// The qualifier between `ytsearch` and `:` must be empty, all digits, or "all" —
/// anything else (e.g. `ytsearchfoo:`) is rejected so it can't smuggle an option.
fn is_ytsearch_target(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    let rest = match lower.strip_prefix("ytsearch") {
        Some(r) => r,
        None => return false,
    };
    let qualifier_len = rest
        .chars()
        .take_while(|c| c.is_ascii_alphanumeric())
        .count();
    let qualifier = &rest[..qualifier_len];
    let after = &rest[qualifier_len..];
    after.len() > 1
        && after.starts_with(':')
        && (qualifier.is_empty()
            || qualifier.chars().all(|c| c.is_ascii_digit())
            || qualifier == "all")
}

pub fn validate_fetch_target(url: &str) -> Result<(), String> {
    if is_ytsearch_target(url) {
        return Ok(());
    }
    validate_media_url(url)
}

/// yt-dlp's Chromium-family cookie loader (Edge/Brave/Opera/Vivaldi…) always
/// blames "Chrome" in its messages — say the browser the user actually picked.
pub fn fix_cookie_browser_name(msg: &str, browser: &str) -> String {
    let cap = match browser {
        "edge" => "Edge",
        "brave" => "Brave",
        "chromium" => "Chromium",
        "opera" => "Opera",
        "vivaldi" => "Vivaldi",
        "safari" => "Safari",
        _ => return msg.to_string(),
    };
    msg.replace("Chrome cookie database", &format!("{cap} cookie database"))
}

/// Map notorious yt-dlp failure modes to actionable hints.
pub fn hint_for_error(msg: &str) -> String {
    let l = msg.to_lowercase();
    let hint = if l.contains("dpapi") || (l.contains("cookie") && l.contains("decrypt")) {
        " — Chrome and Edge encrypt their cookies with app-bound encryption (yt-dlp issue \
         #10927), which third-party apps often can't unlock. Most reliable fix: export a \
         cookies.txt (e.g. with the \"Get cookies.txt LOCALLY\" extension) and pick \
         \"cookies.txt file\" under Settings → Sign-in cookies. Or use Firefox."
    } else if l.contains("not a bot")
        || l.contains("sign in to confirm")
        || l.contains("captcha")
    {
        " — YouTube is blocking anonymous access. Pick a browser under \
         Settings → Sign-in cookies (Firefox works directly; Edge/Chrome need \
         the browser fully closed, or run ytdl-gui as admin once)."
    } else if l.contains("could not copy") && l.contains("cookie") {
        " — the browser keeps its cookie file locked while it runs. Close it fully \
         (Edge/Chrome: also disable startup boost + background apps in its settings) \
         or pick Firefox, which stores cookies in a plain file."
    } else if l.contains("login required")
        || l.contains("log in")
        || l.contains("private video")
        || (l.contains("age") && l.contains("confirm"))
    {
        " — this content needs a signed-in account: Settings → Sign-in cookies → your browser."
    } else if l.contains("unsupported url") {
        " — yt-dlp has no extractor for this link."
    } else {
        ""
    };
    format!("{msg}{hint}")
}

/// First meaningful yt-dlp error line from mixed stdout/stderr text.
pub fn extract_error(lines: impl IntoIterator<Item = String>) -> Option<String> {
    let mut fallback: Option<String> = None;
    for line in lines {
        let t = line.trim();
        if t.is_empty() {
            continue;
        }
        if t.starts_with("ERROR:") || t.starts_with("yt-dlp: error") {
            return Some(truncate(t, 300));
        }
        fallback = Some(truncate(t, 300));
    }
    fallback
}

pub fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        let mut cut = max;
        while !s.is_char_boundary(cut) {
            cut -= 1;
        }
        format!("{}…", &s[..cut])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn url_validation_blocks_option_injection() {
        assert!(validate_media_url("https://youtu.be/x").is_ok());
        assert!(validate_media_url("http://a.b/c").is_ok());
        assert!(validate_media_url("--config-locations=/tmp/evil").is_err());
        assert!(validate_media_url("/etc/passwd").is_err());
        assert!(validate_media_url("").is_err());
        assert!(validate_fetch_target("ytsearch5:cats").is_ok());
        assert!(validate_fetch_target("--exec=payload").is_err());
    }

    #[test]
    fn cookies_args_respects_whitelist_and_file_mode() {
        assert!(cookies_args(&None, &None).unwrap().is_empty());
        assert!(cookies_args(&Some("none".into()), &None).unwrap().is_empty());
        assert!(cookies_args(&Some("   ".into()), &None).unwrap().is_empty());
        assert_eq!(
            cookies_args(&Some("firefox".into()), &None).unwrap(),
            vec!["--cookies-from-browser", "firefox"]
        );
        // Arbitrary strings can never become arguments.
        assert!(cookies_args(&Some("--exec=rm -rf /".into()), &None).is_err());
        // File mode: real file passes, flag-like or missing paths rejected.
        let path = std::env::temp_dir().join("ytdl_gui_test_cookies.txt");
        std::fs::write(&path, "# Netscape HTTP Cookie File").unwrap();
        let args = cookies_args(
            &Some("file".into()),
            &Some(path.to_string_lossy().into_owned()),
        )
        .unwrap();
        assert_eq!(args[0], "--cookies");
        assert!(cookies_args(&Some("file".into()), &Some("--evil".into())).is_err());
        assert!(cookies_args(&Some("file".into()), &None).is_err());
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn hints_and_error_extraction() {
        assert!(hint_for_error("failed to decrypt cookie db: DpApi error").contains("#10927"));
        assert!(hint_for_error("ERROR: Sign in to confirm you're not a bot")
            .contains("Sign-in cookies"));
        assert_eq!(
            extract_error(vec![
                "[info] noise".into(),
                "ERROR: HTTP Error 403".into(),
                "more noise".into(),
            ])
            .unwrap(),
            "ERROR: HTTP Error 403"
        );
        assert!(fix_cookie_browser_name(
            "Could not copy Chrome cookie database to temp file",
            "edge"
        )
        .contains("Edge cookie database"));
    }

    #[test]
    fn truncate_is_utf8_safe() {
        let s = "é".repeat(10); // 20 bytes; a 5-byte cut splits a char
        assert!(truncate(&s, 5).ends_with('…'));
        assert_eq!(truncate("short", 100), "short");
    }
}
