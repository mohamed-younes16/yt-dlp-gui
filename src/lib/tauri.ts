import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import type {
  DownloadMode,
  DownloadProgress,
  FormatSettings,
  HistoryEntry,
  VideoInfo,
} from "./types";

export function fetchMetadata(
  url: string,
  playlist = false,
  cookiesBrowser?: string | null,
  cookiesFile?: string | null,
): Promise<VideoInfo> {
  return invoke("fetch_metadata", {
    url,
    playlist,
    cookiesBrowser: cookiesBrowser && cookiesBrowser !== "none" ? cookiesBrowser : null,
    cookiesFile: cookiesBrowser === "file" ? cookiesFile ?? null : null,
  });
}

export function searchVideos(
  query: string,
  cookiesBrowser?: string | null,
  cookiesFile?: string | null,
): Promise<VideoInfo[]> {
  return invoke("search_videos", {
    query,
    cookiesBrowser: cookiesBrowser && cookiesBrowser !== "none" ? cookiesBrowser : null,
    cookiesFile: cookiesBrowser === "file" ? cookiesFile ?? null : null,
  });
}

export interface DownloadOptions {
  id: string;
  url: string;
  mode: DownloadMode;
  quality: number;
  container: string;
  audioBitrate: number;
  audioFormat: string;
  saveThumbnail: boolean;
  embedThumbnail: boolean;
  embedMetadata: boolean;
  subtitles: boolean;
  playlist: boolean;
  cookiesBrowser: string | null;
  cookiesFile: string | null;
  folder?: string | null;
  trimStart?: number | null;
  trimEnd?: number | null;
}

export function downloadOptionsFrom(
  id: string,
  url: string,
  s: FormatSettings,
  trim: [number, number] | null,
): DownloadOptions {
  return {
    id,
    url,
    mode: s.mode,
    quality: s.quality,
    container: s.container,
    audioBitrate: s.audioBitrate,
    audioFormat: s.audioFormat,
    saveThumbnail: s.saveThumbnail,
    embedThumbnail: s.embedThumbnail,
    embedMetadata: s.embedMetadata,
    subtitles: s.subtitles,
    playlist: s.playlist,
    cookiesBrowser: s.cookiesBrowser !== "none" ? s.cookiesBrowser : null,
    cookiesFile: s.cookiesBrowser === "file" ? s.cookiesFile : null,
    folder: s.folder,
    trimStart: trim ? trim[0] : null,
    trimEnd: trim ? trim[1] : null,
  };
}

export function startDownload(opts: DownloadOptions): Promise<void> {
  return invoke("start_download", { ...opts });
}

export function cancelDownload(id: string): Promise<boolean> {
  return invoke("cancel_download", { id });
}

export async function pickFolder(): Promise<string | null> {
  const dir = await open({ directory: true, multiple: false });
  return typeof dir === "string" ? dir : null;
}

export async function pickCookiesFile(): Promise<string | null> {
  const file = await open({
    directory: false,
    multiple: false,
    filters: [{ name: "cookies.txt (Netscape format)", extensions: ["txt"] }],
  });
  return typeof file === "string" ? file : null;
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

export function updateYtdlp(): Promise<string> {
  return invoke("update_ytdlp");
}

export function checkBrowserCookies(browser: string): Promise<string> {
  return invoke("check_browser_cookies", { browser });
}

export function listenProgress(
  cb: (progress: DownloadProgress) => void,
): Promise<() => void> {
  return listen<DownloadProgress>("download-progress", (event) =>
    cb(event.payload),
  );
}
