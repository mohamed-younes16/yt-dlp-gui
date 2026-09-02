use std::fs;

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

fn history_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Could not resolve app data dir: {e}"))?;
    Ok(dir.join("history.json"))
}

fn valid_entry(v: &Value) -> bool {
    v.get("videoId").and_then(|x| x.as_str()).is_some()
        && v.get("title").and_then(|x| x.as_str()).is_some()
        && v.get("url").and_then(|x| x.as_str()).is_some()
        && v.get("downloadedAt").and_then(|x| x.as_i64()).is_some()
}

fn parse_items(data: &str) -> Vec<Value> {
    let Ok(parsed) = serde_json::from_str::<Value>(data) else {
        return Vec::new();
    };
    // v1 = { v: 1, items: [...] } — legacy format was a bare array.
    let items = parsed
        .get("items")
        .and_then(|x| x.as_array())
        .or_else(|| parsed.as_array())
        .cloned()
        .unwrap_or_default();
    items.into_iter().filter(valid_entry).take(500).collect()
}

#[tauri::command]
pub fn load_history(app: AppHandle) -> Result<Vec<Value>, String> {
    let path = history_path(&app)?;
    if !path.exists() {
        return Ok(vec![]);
    }
    let data = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    match serde_json::from_str::<Value>(&data) {
        Ok(_) => Ok(parse_items(&data)),
        Err(e) => {
            // Never wipe user data on a parse failure — stash it aside so a
            // later save can't overwrite the only copy.
            let stamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis())
                .unwrap_or(0);
            let backup = path.with_file_name(format!("history.corrupt-{stamp}.json"));
            let _ = fs::rename(&path, &backup);
            Err(format!("History file was corrupt ({e}); saved a copy to {}", backup.display()))
        }
    }
}

#[tauri::command]
pub fn save_history(app: AppHandle, entries: Vec<Value>) -> Result<(), String> {
    let path = history_path(&app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let items: Vec<Value> = entries.into_iter().filter(valid_entry).collect();
    let doc = json!({ "v": 1, "items": items });
    let tmp = path.with_file_name("history.json.tmp");
    let payload = serde_json::to_string_pretty(&doc).map_err(|e| e.to_string())?;
    // Write temp → backup old → atomic rename. A crash mid-write can never
    // leave a truncated file in place.
    fs::write(&tmp, payload).map_err(|e| e.to_string())?;
    if path.exists() {
        let bak = path.with_file_name("history.json.bak");
        if fs::rename(&path, &bak).is_err() {
            // .bak already exists / can't be replaced — best-effort only.
            let _ = fs::remove_file(&path);
        }
    }
    fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::{parse_items, valid_entry};
    use serde_json::{json, Value};

    fn entry(id: &str) -> Value {
        json!({ "videoId": id, "title": "t", "url": "https://x", "downloadedAt": 1 })
    }

    #[test]
    fn reads_v1_and_legacy_without_trusting_junk() {
        let v1 = json!({ "v": 1, "items": [entry("a"), { "garbage": true }] });
        let got = parse_items(&v1.to_string());
        assert_eq!(got.len(), 1);
        assert_eq!(got[0]["videoId"], "a");
        assert_eq!(parse_items(&json!([entry("b")]).to_string()).len(), 1);
        assert!(parse_items("this is not {{{ json").is_empty());
        assert!(parse_items(r#"{"v": 999, "items": [1,2,3]}"#).is_empty());
    }

    #[test]
    fn rejects_entries_missing_required_fields() {
        assert!(!valid_entry(&json!({ "videoId": "a" })));
        assert!(!valid_entry(&json!({ "videoId": "a", "title": "t", "url": "u" }))); // no ts
        assert!(valid_entry(&entry("ok")));
    }
}
