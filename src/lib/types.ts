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
  title: string;
  uploader?: string;
  duration?: number;
  viewCount?: number;
  likeCount?: number;
  uploadDate?: string;
  thumbnail?: string;
  formats: FormatEntry[];
}

export type DownloadMode = "video" | "audio" | "both" | "thumbnail";

export interface DownloadProgress {
  status: "starting" | "downloading" | "done" | "cancelled" | "error";
  phase: "video" | "audio";
  percent: number;
  speed?: string;
  eta?: string;
  file?: string;
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

export interface HistoryEntry {
  videoId: string;
  title: string;
  url: string;
  channel?: string;
  thumbnail?: string;
  mode: DownloadMode;
  qualityLabel: string;
  folder?: string;
  downloadedAt: number;
}

export function formatDuration(secs?: number): string {
  if (!secs || secs <= 0) return "--:--";
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

function sizeOf(fmt: FormatEntry): number | null {
  return fmt.filesize ?? fmt.filesizeApprox ?? null;
}

function isVideo(fmt: FormatEntry): boolean {
  return !!fmt.vcodec && fmt.vcodec !== "none";
}

function isAudio(fmt: FormatEntry): boolean {
  return !!fmt.acodec && fmt.acodec !== "none" && (!fmt.vcodec || fmt.vcodec === "none");
}

export function estimateVideoSize(info: VideoInfo, quality: number): number | null {
  let best: { bytes: number; h: number } | null = null;
  for (const f of info.formats) {
    if (!isVideo(f) || f.height == null) continue;
    const h = f.height!;
    if (h > quality) continue;
    const bytes = sizeOf(f);
    if (bytes == null) continue;
    if (!best || h > best.h) best = { bytes, h };
  }
  return best?.bytes ?? null;
}

export function estimateAudioSize(info: VideoInfo): number | null {
  let best: number | null = null;
  let bestTbr = 0;
  for (const f of info.formats) {
    if (!isAudio(f)) continue;
    const bytes = sizeOf(f);
    if (bytes == null) continue;
    const tbr = f.tbr ?? 0;
    if (best == null || tbr > bestTbr) {
      best = bytes;
      bestTbr = tbr;
    }
  }
  return best;
}

export function estimateSize(
  info: VideoInfo,
  mode: DownloadMode,
  quality: number,
): number | null {
  if (mode === "thumbnail") return 300_000;
  if (mode === "video") {
    const v = estimateVideoSize(info, quality);
    const a = estimateAudioSize(info);
    if (v != null && a != null) return v + a;
    return v ?? a;
  }
  if (mode === "audio") return estimateAudioSize(info);
  if (mode === "both") {
    const v = estimateVideoSize(info, quality);
    const a = estimateAudioSize(info);
    if (v != null && a != null) return v + a;
    return v ?? a ?? null;
  }
  return null;
}
