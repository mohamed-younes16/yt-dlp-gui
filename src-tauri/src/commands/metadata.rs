use std::time::Duration;

use serde::Serialize;

use crate::commands::{
    cookies_args, detect_js_runtime, extract_error, fix_cookie_browser_name, hint_for_error,
    run_with_timeout, validate_fetch_target,
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormatEntry {
    pub format_id: String,
    pub ext: String,
    pub height: Option<u32>,
    pub width: Option<u32>,
    pub filesize: Option<u64>,
    pub filesize_approx: Option<u64>,
    pub vcodec: Option<String>,
    pub acodec: Option<String>,
    pub fps: Option<f64>,
    pub tbr: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoInfo {
    pub id: String,
    /// The real page URL from yt-dlp (`webpage_url`). Downloads and history
    /// must use this — never a fabricated youtube.com/watch?v= link.
    pub url: String,
    pub title: String,
    pub uploader: Option<String>,
    pub duration: Option<f64>,
    pub view_count: Option<u64>,
    pub like_count: Option<u64>,
    pub upload_date: Option<String>,
    pub thumbnail: Option<String>,
    pub entry_count: Option<u32>,
    pub formats: Vec<FormatEntry>,
}

fn best_thumbnail(value: &serde_json::Value) -> Option<String> {
    // Prefer real thumbnails reported by yt-dlp over fabricated img.youtube
    // URLs — maxresdefault.jpg 404s for a large share of videos.
    if let Some(arr) = value["thumbnails"].as_array() {
        let best = arr
            .iter()
            .filter_map(|t| {
                let url = t["url"].as_str()?;
                if url.starts_with("http://") || url.starts_with("https://") {
                    let w = t["width"].as_u64().unwrap_or(0);
                    let h = t["height"].as_u64().unwrap_or(0);
                    Some((w * h, url))
                } else {
                    None
                }
            })
            .max_by_key(|(area, _)| *area);
        if let Some((_, url)) = best {
            return Some(url.to_string());
        }
    }
    if let Some(t) = value["thumbnail"].as_str().filter(|u| u.starts_with("http")) {
        return Some(t.to_string());
    }
    let webpage = value["webpage_url"].as_str().unwrap_or("");
    let is_youtube = webpage.contains("youtube.com") || webpage.contains("youtu.be");
    if let Some(id) = value["id"].as_str().filter(|s| !s.is_empty()) {
        if is_youtube {
            return Some(format!(
                "https://img.youtube.com/vi/{}/maxresdefault.jpg",
                id
            ));
        }
    }
    None
}

fn extract_formats(value: &serde_json::Value) -> Vec<FormatEntry> {
    let Some(arr) = value["formats"].as_array() else {
        return vec![];
    };
    arr.iter()
        .filter_map(|f| {
            let format_id = f["format_id"].as_str()?.to_string();
            let ext = f["ext"].as_str().unwrap_or("mp4").to_string();
            Some(FormatEntry {
                format_id,
                ext,
                height: f["height"].as_u64().map(|v| v as u32),
                width: f["width"].as_u64().map(|v| v as u32),
                filesize: f["filesize"].as_u64(),
                filesize_approx: f["filesize_approx"].as_u64(),
                vcodec: f["vcodec"].as_str().map(|s| s.to_string()),
                acodec: f["acodec"].as_str().map(|s| s.to_string()),
                fps: f["fps"].as_f64(),
                tbr: f["tbr"].as_f64(),
            })
        })
        .collect()
}

fn pick_source(value: &serde_json::Value) -> (serde_json::Value, Option<String>) {
    // Returns the entry to display, plus the real yt-dlp error if no entry is
    // usable (searches can return "_type":"url" stubs or per-entry errors).
    if let Some(entries) = value["entries"].as_array() {
        let usable = entries.iter().find(|e| {
            e["title"].is_string() || e["formats"].is_array() || e["duration"].is_number()
        });
        if let Some(e) = usable {
            return (e.clone(), None);
        }
        let err = entries
            .iter()
            .find_map(|e| e["error"].as_str())
            .map(|s| s.to_string());
        return (
            serde_json::Value::Null,
            Some(err.unwrap_or_else(|| "no usable results".into())),
        );
    }
    (value.clone(), None)
}

fn extract_info(value: &serde_json::Value, fallback_url: &str) -> VideoInfo {
    let (source, _) = pick_source(value);
    let source = if source.is_null() {
        value.clone()
    } else {
        source
    };
    let webpage_url = source["webpage_url"]
        .as_str()
        .or_else(|| source["url"].as_str())
        .filter(|u| u.starts_with("http"))
        .unwrap_or(fallback_url)
        .to_string();
    VideoInfo {
        id: source["id"]
            .as_str()
            .filter(|s| !s.is_empty())
            .unwrap_or("video")
            .to_string(),
        url: webpage_url,
        title: source["title"].as_str().unwrap_or("Unknown title").to_string(),
        uploader: source["uploader"]
            .as_str()
            .or_else(|| source["channel"].as_str())
            .map(|s| s.to_string()),
        duration: source["duration"].as_f64().filter(|d| *d > 0.0 && d.is_finite()),
        view_count: source["view_count"].as_u64(),
        like_count: source["like_count"].as_u64(),
        upload_date: source["upload_date"].as_str().map(|s| s.to_string()),
        thumbnail: best_thumbnail(&source),
        entry_count: value["entries"].as_array().map(|a| a.len() as u32),
        formats: extract_formats(&source),
    }
}

fn attempt(
    url: &str,
    playlist: bool,
    cookies: &[String],
    js_runtime: Option<&str>,
) -> Result<VideoInfo, (String, bool)> {
    // (error, is_retriable_option_error)
    let mut cmd = std::process::Command::new("yt-dlp");
    cmd.arg("-J").arg("--skip-download");
    if playlist {
        // Flat manifest: fast even for huge playlists; entry_count is accurate
        // and the first entry drives the preview.
        cmd.arg("--flat-playlist");
    } else {
        cmd.arg("--no-playlist");
    }
    cmd.args(cookies);
    if let Some(runtime) = js_runtime {
        cmd.arg("--js-runtimes").arg(runtime);
    }
    cmd.arg(url);

    let out = run_with_timeout(cmd, Duration::from_secs(25))
        .map_err(|e| (e, false))?;

    if let Ok(v) = serde_json::from_slice::<serde_json::Value>(&out.stdout) {
        // Prefer a real yt-dlp error from inside the JSON over showing an
        // "Unknown title" card to the user.
        if let Some(err) = pick_source(&v).1 {
            return Err((
                format!("yt-dlp failed: {err} — try enabling Sign-in cookies in Settings."),
                false,
            ));
        }
        // Valid JSON wins even on non-zero exit (warnings on stderr).
        return Ok(extract_info(&v, url));
    }
    if !out.success && out.stderr.contains("no such option") && js_runtime.is_some() {
        return Err(("js-runtimes option unsupported".into(), true));
    }
    if out.timed_out {
        return Err((
            "yt-dlp timed out after 25s — check the link or your connection.".into(),
            false,
        ));
    }
    let msg = extract_error(out.stderr.lines().map(String::from))
        .unwrap_or_else(|| "Could not parse yt-dlp output".into());
    Err((format!("yt-dlp failed: {msg}"), false))
}

/// Flat search: fast top-15 results (no per-video format extraction), for
/// the in-app results list. Clicking a result calls fetch_metadata on its
/// real URL for full preview data.
#[tauri::command]
pub async fn search_videos(
    query: String,
    cookies_browser: Option<String>,
    cookies_file: Option<String>,
) -> Result<Vec<VideoInfo>, String> {
    let query = query.trim().to_string();
    if query.is_empty() {
        return Err("Empty search query".into());
    }
    let cookies = cookies_args(&cookies_browser, &cookies_file)?;
    let browser = cookies_browser.filter(|b| b != "none").unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || {
        let decorate = |e: String| hint_for_error(&fix_cookie_browser_name(&e, &browser));
        let run = |js: Option<&str>| -> Result<Vec<VideoInfo>, (String, bool)> {
            let mut cmd = std::process::Command::new("yt-dlp");
            cmd.args(["-J", "--no-playlist", "--flat-playlist", "--skip-download"]);
            cmd.args(&cookies);
            if let Some(r) = js {
                cmd.arg("--js-runtimes").arg(r);
            }
            cmd.arg(format!("ytsearch15:{query}"));
            let out = run_with_timeout(cmd, Duration::from_secs(25)).map_err(|e| (e, false))?;
            if let Ok(v) = serde_json::from_slice::<serde_json::Value>(&out.stdout) {
                if let Some(entries) = v["entries"].as_array() {
                    let usable =
                        |e: &serde_json::Value| e["title"].is_string() && e.get("error").is_none();
                    // Flat search can mix in channel/playlist stubs (no duration,
                    // url points at /channel/, /@ or playlist) — prefer videos.
                    let is_video_stub = |e: &serde_json::Value| {
                        e.get("url")
                            .and_then(|u| u.as_str())
                            .map(|u| {
                                u.contains("/channel/")
                                    || u.contains("/playlist")
                                    || u.contains("/@")
                            })
                            .unwrap_or(false)
                    };
                    let mut iter = entries
                        .iter()
                        .filter(|e| usable(e) && !is_video_stub(e));
                    let picked: Vec<VideoInfo> =
                        iter.by_ref().map(|e| extract_info(e, "")).collect();
                    let list = if picked.is_empty() {
                        entries
                            .iter()
                            .filter(|e| usable(e))
                            .map(|e| extract_info(e, ""))
                            .collect()
                    } else {
                        picked
                    };
                    return Ok(list);
                }
                return Err(("search returned no results".into(), false));
            }
            if !out.success
                && out.stderr.contains("no such option")
                && out.stderr.contains("js-runtimes")
            {
                return Err((String::new(), true));
            }
            if out.timed_out {
                return Err((
                    "yt-dlp timed out after 25s — check the connection.".into(),
                    false,
                ));
            }
            Err((
                extract_error(out.stderr.lines().map(String::from))
                    .unwrap_or_else(|| "Could not parse search output".into()),
                false,
            ))
        };
        let list = match run(detect_js_runtime()) {
            Ok(l) => l,
            Err((_, true)) => run(None).map_err(|(e, _)| decorate(e))?,
            Err((e, false)) => return Err(decorate(e)),
        };
        Ok(list)
    })
    .await
    .map_err(|e| format!("internal error: {e}"))?
}

#[tauri::command]
pub async fn fetch_metadata(
    url: String,
    playlist: bool,
    cookies_browser: Option<String>,
    cookies_file: Option<String>,
) -> Result<VideoInfo, String> {
    validate_fetch_target(&url)?;
    let cookies = cookies_args(&cookies_browser, &cookies_file)?;
    let browser = cookies_browser
        .filter(|b| b != "none")
        .unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || {
        let decorate = |e: String| hint_for_error(&fix_cookie_browser_name(&e, &browser));
        // Plain "ytsearch:" pulls ten full extracts — pin to the top hit.
        let url: String = if !playlist && url.len() >= 9 && url[..9].eq_ignore_ascii_case("ytsearch:") {
            format!("ytsearch1{}", &url[9..])
        } else {
            url
        };
        let runtime = detect_js_runtime();
        let first = attempt(&url, playlist, &cookies, runtime);
        let info = match first {
            Ok(info) => info,
            Err((_, true)) => {
                // Old yt-dlp without --js-runtimes → retry plain.
                attempt(&url, playlist, &cookies, None).map_err(|(e, _)| decorate(e))?
            }
            Err((e, false)) => return Err(decorate(e)),
        };
        if info.formats.is_empty() && info.entry_count.is_none() && info.duration.is_none()
        {
            return Err(format!(
                "yt-dlp could not extract info for this link — try updating yt-dlp (Update button in the dependencies dialog, or `yt-dlp --update`). Title: {}",
                info.title
            ));
        }
        Ok(info)
    })
    .await
    .map_err(|e| format!("internal error: {e}"))?
}
