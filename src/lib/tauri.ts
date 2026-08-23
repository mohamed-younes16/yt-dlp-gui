import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import type {
  DownloadMode,
  DownloadProgress,
  HistoryEntry,
  VideoInfo,
} from "./types";

export function fetchMetadata(url: string): Promise<VideoInfo> {
  return invoke("fetch_metadata", { url });
}

export interface DownloadOptions {
  url: string;
  mode: DownloadMode;
  quality: number;
  container: string;
  audioBitrate: number;
  audioFormat: string;
  saveThumbnail: boolean;
  embedThumbnail: boolean;
  embedMetadata: boolean;
  folder?: string | null;
  trimStart?: number | null;
  trimEnd?: number | null;
}

export function startDownload(opts: DownloadOptions): Promise<void> {
  return invoke("start_download", { ...opts });
}

export function cancelDownload(): Promise<boolean> {
  return invoke("cancel_download");
}

export async function pickFolder(): Promise<string | null> {
  const dir = await open({ directory: true, multiple: false });
  return typeof dir === "string" ? dir : null;
}

export function loadHistory(): Promise<HistoryEntry[]> {
  return invoke("load_history");
}

export function saveHistory(entries: HistoryEntry[]): Promise<void> {
  return invoke("save_history", { entries });
}

export async function revealInFolder(path: string): Promise<void> {
  await revealItemInDir(path);
}

export interface DependencyStatus {
  hasYtdlp: boolean;
  hasFfmpeg: boolean;
  ytdlpVersion?: string | null;
  ffmpegVersion?: string | null;
}

export function checkDependencies(): Promise<DependencyStatus> {
  return invoke("check_dependencies");
}

export function listenProgress(
  cb: (progress: DownloadProgress) => void,
): Promise<() => void> {
  return listen<DownloadProgress>("download-progress", (event) =>
    cb(event.payload),
  );
}
