use serde::Serialize;

use super::hide_window;

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
    pub title: String,
    pub uploader: Option<String>,
    pub duration: Option<f64>,
    pub view_count: Option<u64>,
    pub like_count: Option<u64>,
    pub upload_date: Option<String>,
    pub thumbnail: Option<String>,
    pub formats: Vec<FormatEntry>,
}

fn best_thumbnail(value: &serde_json::Value) -> Option<String> {
    if let Some(id) = value["id"].as_str().filter(|s| !s.is_empty()) {
        return Some(format!(
            "https://img.youtube.com/vi/{}/maxresdefault.jpg",
            id
        ));
    }
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
    value["thumbnail"]
        .as_str()
        .filter(|u| u.starts_with("http"))
        .map(|u| u.to_string())
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

fn extract_info(value: &serde_json::Value) -> VideoInfo {
    VideoInfo {
        id: value["id"].as_str().unwrap_or_default().to_string(),
        title: value["title"].as_str().unwrap_or("Unknown title").to_string(),
        uploader: value["uploader"]
            .as_str()
            .or_else(|| value["channel"].as_str())
            .map(|s| s.to_string()),
        duration: value["duration"].as_f64(),
        view_count: value["view_count"].as_u64(),
        like_count: value["like_count"].as_u64(),
        upload_date: value["upload_date"].as_str().map(|s| s.to_string()),
        thumbnail: best_thumbnail(value),
        formats: extract_formats(value),
    }
}

#[tauri::command]
pub fn fetch_metadata(url: String) -> Result<VideoInfo, String> {
    // Try with --js-runtimes bun first (fixes SABR on newer yt-dlp), fallback without for older yt-dlp
    let args_sets: Vec<Vec<&str>> = vec![
        vec!["-J", "--no-playlist", "--skip-download", "--js-runtimes", "bun"],
        vec!["-J", "--no-playlist", "--skip-download"],
    ];
    let mut last_err = String::new();
    let mut json: Option<serde_json::Value> = None;
    for args in args_sets {
        let mut cmd = std::process::Command::new("yt-dlp");
        let mut full_args = args.clone();
        full_args.push(&url);
        cmd.args(&full_args);
        hide_window(&mut cmd);
        let output = cmd
            .output()
            .map_err(|e| format!("Could not run yt-dlp. Is it installed and on PATH? ({e})"))?;
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        // If yt-dlp doesn't know --js-runtimes, retry without it
        if !output.status.success() && stderr.contains("no such option") {
            last_err = stderr.trim().to_string();
            continue;
        }
        // Try to parse stdout as JSON even if status is non-zero (warnings like SABR are on stderr but JSON is still valid)
        if let Ok(v) = serde_json::from_slice::<serde_json::Value>(&output.stdout) {
            // Check if JSON is actually an error object without formats? Still try to use it
            json = Some(v);
            // If status was success, or JSON parsed, break
            if output.status.success() || stderr.contains("SABR") || stderr.contains("WARNING") {
                break;
            }
            break;
        }
        if !output.status.success() {
            last_err = stderr.trim().to_string();
            continue;
        }
        last_err = format!("Could not parse yt-dlp output");
    }
    let json = json.ok_or_else(|| {
        if last_err.is_empty() {
            "Could not parse yt-dlp output".to_string()
        } else {
            format!("yt-dlp failed: {}", last_err)
        }
    })?;

    // Playlists return "entries"; take the first one.
    let info = if json["entries"].is_array() {
        let first = &json["entries"][0];
        if first.is_null() {
            return Err("Playlist is empty".into());
        }
        extract_info(first)
    } else {
        extract_info(&json)
    };

    if info.id.is_empty() || info.title == "Unknown title" {
        return Err(format!(
            "yt-dlp failed: could not extract video info (try updating yt-dlp: winget upgrade yt-dlp.yt-dlp or yt-dlp --update). Raw title: {}",
            info.title
        ));
    }

    Ok(info)
}
