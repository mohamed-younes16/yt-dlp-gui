export interface FormatEntry {
  formatId: string;
  ext: string;
  height?: number;
  width?: number;
  filesize?: number;
  filesizeApprox?: number;
  vcodec?: string;
  acodec?: string;
  fps?: number;
  tbr?: number;
}

export interface VideoInfo {
  id: string;
  /** Real page URL from yt-dlp — never fabricate a youtube.com/watch link. */
  url: string;
  title: string;
  uploader?: string;
  duration?: number;
  viewCount?: number;
  likeCount?: number;
  uploadDate?: string;
  thumbnail?: string;
  entryCount?: number;
  formats: FormatEntry[];
}

export type DownloadMode = "video" | "audio" | "both" | "thumbnail";

export type JobStatus =
  | "queued"
  | "starting"
  | "downloading"
  | "done"
  | "cancelled"
  | "error";

export interface DownloadProgress {
  id: string;
  status: JobStatus;
  phase: string;
  percent: number;
  speed?: string;
  eta?: string;
  file?: string;
  message?: string;
}

export interface FormatSettings {
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
  cookiesBrowser: string;
  cookiesFile: string | null;
  folder: string | null;
}

export interface DownloadJob {
  id: string;
  info: VideoInfo;
  settings: FormatSettings;
  trim: [number, number] | null;
  status: JobStatus;
  phase: string;
  percent: number;
  speed?: string;
  eta?: string;
  file?: string;
  message?: string;
}

export const VIDEO_QUALITIES = [2160, 1440, 1080, 720, 480, 360] as const;

export const AUDIO_BITRATES = [320, 192, 128] as const;

export const VIDEO_CONTAINERS = [
  { value: "mp4", label: "MP4" },
  { value: "mkv", label: "MKV" },
  { value: "webm", label: "WEBM" },
] as const;

export const AUDIO_FORMATS = [
  { value: "mp3", label: "MP3" },
  { value: "m4a", label: "M4A" },
  { value: "opus", label: "OPUS" },
  { value: "wav", label: "WAV (lossless)" },
] as const;

export const COOKIE_BROWSERS = [
  { value: "none", label: "No sign-in" },
  { value: "file", label: "cookies.txt file…" },
  { value: "chrome", label: "Chrome" },
  { value: "edge", label: "Edge" },
  { value: "firefox", label: "Firefox" },
  { value: "brave", label: "Brave" },
] as const;

export const DEFAULT_SETTINGS: FormatSettings = {
  mode: "video",
  quality: 1080,
  container: "mp4",
  audioBitrate: 320,
  audioFormat: "mp3",
  saveThumbnail: false,
  embedThumbnail: false,
  embedMetadata: true,
  subtitles: false,
  playlist: false,
  cookiesBrowser: "none",
  cookiesFile: null,
  folder: null,
};

export function loadSettings(): FormatSettings {
  try {
    const raw = localStorage.getItem("dlSettings");
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<FormatSettings>;
    const s = { ...DEFAULT_SETTINGS, ...parsed };
    if (!["video", "audio", "both", "thumbnail"].includes(s.mode)) {
      s.mode = "video";
    }
    if (typeof s.quality !== "number" || !Number.isFinite(s.quality)) {
      s.quality = 1080;
    }
    if (typeof s.audioBitrate !== "number" || !Number.isFinite(s.audioBitrate)) {
      s.audioBitrate = 320;
    }
    if (
      typeof s.container !== "string" ||
      !VIDEO_CONTAINERS.some((c) => c.value === s.container)
    ) {
      s.container = "mp4";
    }
    if (
      typeof s.audioFormat !== "string" ||
      !AUDIO_FORMATS.some((f) => f.value === s.audioFormat)
    ) {
      s.audioFormat = "mp3";
    }
    if (
      typeof s.cookiesBrowser !== "string" ||
      !COOKIE_BROWSERS.some((b) => b.value === s.cookiesBrowser)
    ) {
      s.cookiesBrowser = "none";
    }
    if (s.cookiesFile !== null && typeof s.cookiesFile !== "string") {
      s.cookiesFile = null;
    }
    if (s.folder !== null && typeof s.folder !== "string") s.folder = null;
    for (const k of [
      "saveThumbnail",
      "embedThumbnail",
      "embedMetadata",
      "subtitles",
      "playlist",
    ] as const) {
      if (typeof s[k] !== "boolean") s[k] = DEFAULT_SETTINGS[k];
    }
    return s;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: FormatSettings) {
  try {
    localStorage.setItem("dlSettings", JSON.stringify(s));
  } catch {
    /* private mode etc. — non-fatal */
  }
}

export interface HistoryEntry {
  videoId: string;
  title: string;
  url: string;
  channel?: string;
  thumbnail?: string;
  mode: DownloadMode;
  qualityLabel: string;
  folder?: string;
  /** Absolute path of the downloaded file when the backend reported it. */
  path?: string;
  downloadedAt: number;
}

export function formatDuration(secs?: number): string {
  if (!secs || secs <= 0 || !Number.isFinite(secs)) return "--:--";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

export function formatCount(n?: number): string {
  if (n === undefined || n === null) return "";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function formatBytes(bytes?: number | null): string {
  if (bytes == null || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"] as const;
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[i]}`;
}

export function formatUploadDate(raw?: string): string {
  if (!raw || !/^\d{8}$/.test(raw)) return "";
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6)}`;
}

export function fileNameOf(path?: string): string {
  if (!path) return "";
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}

function sizeOf(fmt: FormatEntry): number | null {
  return fmt.filesize ?? fmt.filesizeApprox ?? null;
}

function isVideo(fmt: FormatEntry): boolean {
  return !!fmt.vcodec && fmt.vcodec !== "none";
}

function isAudio(fmt: FormatEntry): boolean {
  return (
    !!fmt.acodec &&
    fmt.acodec !== "none" &&
    (!fmt.vcodec || fmt.vcodec === "none")
  );
}

/**
 * Best video-only stream at or below the selected quality. Uses the reported
 * filesize when yt-dlp gives one, otherwise bitrate × duration (reported
 * per-format filesize is missing on most YouTube entries).
 */
export function estimateVideoSize(
  info: VideoInfo,
  quality: number,
): number | null {
  let best: { h: number; tbr: number; bytes: number | null } | null = null;
  for (const f of info.formats) {
    if (!isVideo(f) || f.height == null || f.height > quality) continue;
    const tbr = f.tbr ?? 0;
    if (tbr <= 0) continue;
    if (!best || f.height > best.h || (f.height === best.h && tbr > best.tbr)) {
      best = { h: f.height, tbr, bytes: sizeOf(f) };
    }
  }
  if (!best) return null;
  if (best.bytes != null) return best.bytes;
  if (!info.duration) return null;
  return (best.tbr * 1000 * info.duration) / 8;
}

/** Best audio-only stream — exact filesize when known, else bitrate × duration. */
export function estimateAudioSize(info: VideoInfo): number | null {
  let exact: number | null = null;
  let maxTbr = 0;
  for (const f of info.formats) {
    if (!isAudio(f)) continue;
    const bytes = sizeOf(f);
    if (bytes != null && (exact == null || bytes > exact)) exact = bytes;
    const tbr = f.tbr ?? 0;
    if (tbr > maxTbr) maxTbr = tbr;
  }
  if (exact != null) return exact;
  if (!info.duration || maxTbr <= 0) return null;
  return (maxTbr * 1000 * info.duration) / 8;
}

export function estimateSize(
  info: VideoInfo,
  mode: DownloadMode,
  quality: number,
): number | null {
  if (mode === "thumbnail") return 300_000;
  const v = estimateVideoSize(info, quality);
  const a = estimateAudioSize(info);
  if (mode === "audio") return a;
  if (mode === "video") {
    if (v != null && a != null) return v + a;
    return v ?? a;
  }
  if (mode === "both") {
    // Merged video file (v + a) plus a separate audio file (a).
    if (v != null && a != null) return v + 2 * a;
    return v ?? a;
  }
  return null;
}
