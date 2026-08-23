mod commands;

use commands::download::DownloadState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(DownloadState::default())
        .invoke_handler(tauri::generate_handler![
            commands::dependencies::check_dependencies,
            commands::metadata::fetch_metadata,
            commands::download::start_download,
            commands::download::cancel_download,
            commands::history::load_history,
            commands::history::save_history
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
