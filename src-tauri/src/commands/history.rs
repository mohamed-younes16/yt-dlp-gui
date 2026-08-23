use std::fs;

use tauri::{AppHandle, Manager};

fn history_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Could not resolve app data dir: {e}"))?;
    Ok(dir.join("history.json"))
}

#[tauri::command]
pub fn load_history(app: AppHandle) -> Result<Vec<serde_json::Value>, String> {
    let path = history_path(&app)?;
    if !path.exists() {
        return Ok(vec![]);
    }
    let data = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&data).map_err(|e| format!("Corrupt history file: {e}"))
}

#[tauri::command]
pub fn save_history(
    app: AppHandle,
    entries: Vec<serde_json::Value>,
) -> Result<(), String> {
    let path = history_path(&app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(&entries).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}
