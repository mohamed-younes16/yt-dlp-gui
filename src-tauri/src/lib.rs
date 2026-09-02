mod commands;

use commands::download::DownloadState;
use tauri::{Manager, RunEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // Second launch: focus the existing window instead of forking a
            // second instance that would race on history.json / downloads.
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_notification::init())
        .manage(DownloadState::default())
        .setup(|_app| Ok(()))
        .invoke_handler(tauri::generate_handler![
            commands::dependencies::check_dependencies,
            commands::dependencies::update_ytdlp,
            commands::dependencies::check_browser_cookies,
            commands::metadata::fetch_metadata,
            commands::metadata::search_videos,
            commands::download::start_download,
            commands::download::cancel_download,
            commands::history::load_history,
            commands::history::save_history
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // Reap all live yt-dlp/ffmpeg trees before the process exits, so
            // closing the window mid-download doesn't orphan background procs.
            if let RunEvent::ExitRequested { .. } = event {
                app_handle.state::<DownloadState>().kill_all();
            }
        });
}
