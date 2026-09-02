import type { ReactNode } from "react";
import {
  Download,
  FileVideo,
  FolderOpen,
  ImageDown,
  Music,
  Package,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AUDIO_BITRATES,
  AUDIO_FORMATS,
  VIDEO_CONTAINERS,
  VIDEO_QUALITIES,
  type DownloadMode,
  type FormatSettings,
} from "@/lib/types";

export type { FormatSettings };

interface FormatPickerProps {
  settings: FormatSettings;
  onChange: (patch: Partial<FormatSettings>) => void;
  busy: boolean;
  onPickFolder: () => void;
  onDownload: () => void;
  estimate?: number | null;
  /** True when something already runs — the button becomes "Add to queue". */
  queued: boolean;
}

const MODES: {
  value: DownloadMode;
  label: string;
  icon: typeof FileVideo;
}[] = [
  { value: "video", label: "Video", icon: FileVideo },
  { value: "audio", label: "Audio", icon: Music },
  { value: "both", label: "Both", icon: Package },
  { value: "thumbnail", label: "Thumbnail", icon: ImageDown },
];

export function FormatPicker({
  settings,
  onChange,
  busy,
  onPickFolder,
  onDownload,
  estimate,
  queued,
}: FormatPickerProps) {
  const isThumbnail = settings.mode === "thumbnail";
  const isAudioOnly = settings.mode === "audio";
  const both = settings.mode === "both";

  const extras: { key: keyof FormatSettings; label: string; hint?: string; enabled: boolean }[] = [
    { key: "saveThumbnail", label: "Save thumbnail", enabled: !isThumbnail },
    {
      key: "embedThumbnail",
      label: isAudioOnly && settings.audioFormat === "wav" ? "Embed thumbnail (n/a for WAV)" : "Embed thumbnail",
      enabled: !(isThumbnail || (isAudioOnly && settings.audioFormat === "wav")),
    },
    { key: "embedMetadata", label: "Embed metadata", enabled: !isThumbnail },
    { key: "subtitles", label: "Subtitles (EN)", enabled: !isThumbnail },
    { key: "playlist", label: "Entire playlist", enabled: !isThumbnail },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {MODES.map(({ value, label, icon: Icon }) => (
          <Button
            key={value}
            variant={settings.mode === value ? "default" : "outline"}
            size="xl"
            className="flex-col gap-1 py-2"
            onClick={() => onChange({ mode: value })}
            disabled={busy}
          >
            <Icon className="size-4" />
            <span className="text-xs font-medium">{label}</span>
          </Button>
        ))}
      </div>

      {settings.playlist && (
        <p className="text-muted-foreground -mt-2 text-xs">
          Playlist mode — every entry in the list downloads with these
          settings (size unknown until yt-dlp starts).
        </p>
      )}

      {!isThumbnail ? (
        <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3">
          <span className="text-foreground w-16 text-sm">
            {isAudioOnly ? "Bitrate" : "Quality"}
          </span>
          <Select
            value={isAudioOnly ? String(settings.audioBitrate) : String(settings.quality)}
            onValueChange={(v) =>
              isAudioOnly
                ? onChange({ audioBitrate: Number(v) })
                : onChange({ quality: Number(v) })
            }
            disabled={busy}
          >
            <SelectTrigger className="w-full min-w-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {isAudioOnly
                ? AUDIO_BITRATES.map((b) => (
                    <SelectItem key={b} value={String(b)}>
                      {b} kbps
                    </SelectItem>
                  ))
                : VIDEO_QUALITIES.map((q) => (
                    <SelectItem key={q} value={String(q)}>
                      {q === 2160 ? "4K" : q === 1440 ? "2K" : `${q}p`}
                    </SelectItem>
                  ))}
            </SelectContent>
          </Select>
          <SizePill bytes={estimate} />

          {both && (
            <>
              <span className="text-foreground w-16 text-sm">Audio</span>
              <div className="flex min-w-0 items-center gap-2">
                <Select
                  value={String(settings.audioBitrate)}
                  onValueChange={(v) => onChange({ audioBitrate: Number(v) })}
                  disabled={busy}
                >
                  <SelectTrigger className="w-full min-w-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AUDIO_BITRATES.map((b) => (
                      <SelectItem key={b} value={String(b)}>
                        {b} kbps
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={settings.audioFormat}
                  onValueChange={(v) => onChange({ audioFormat: v })}
                  disabled={busy}
                >
                  <SelectTrigger className="w-full min-w-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AUDIO_FORMATS.map((f) => (
                      <SelectItem key={f.value} value={f.value}>
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <span />
            </>
          )}

          <span className="text-foreground w-16 text-sm">
            {isAudioOnly ? "Format" : "Container"}
          </span>
          {isAudioOnly ? (
            <Select
              value={settings.audioFormat}
              onValueChange={(v) => onChange({ audioFormat: v })}
              disabled={busy}
            >
              <SelectTrigger className="w-full min-w-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AUDIO_FORMATS.map((f) => (
                  <SelectItem key={f.value} value={f.value}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Select
              value={settings.container}
              onValueChange={(v) => onChange({ container: v })}
              disabled={busy}
            >
              <SelectTrigger className="w-full min-w-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VIDEO_CONTAINERS.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <span />

          <FolderRow settings={settings} busy={busy} onPickFolder={onPickFolder} />
        </div>
      ) : (
        <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3">
          <FolderRow settings={settings} busy={busy} onPickFolder={onPickFolder} />
          <span />
          <SizePill bytes={estimate} />
        </div>
      )}

      {isThumbnail && (
        <p className="text-muted-foreground text-center text-xs">
          Saves the highest-resolution thumbnail as JPG — no video download.
        </p>
      )}

      {!isThumbnail && (
        <>
          <Separator />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {extras.map(({ key, label, enabled }) => (
              <CheckboxCard
                key={key}
                label={label}
                checked={settings[key] as boolean}
                enabled={enabled}
                busy={busy}
                onCheckedChange={(v) => onChange({ [key]: v } as Partial<FormatSettings>)}
              />
            ))}
          </div>
        </>
      )}

      <Button
        size="xl"
        onClick={onDownload}
        disabled={busy && !queued}
      >
        <Download className="size-5" />
        {isThumbnail
          ? queued
            ? "Add thumbnail to queue"
            : "Download thumbnail"
          : queued
            ? "Add to queue"
            : "Download"}
      </Button>
    </div>
  );
}

function FolderRow({
  settings,
  busy,
  onPickFolder,
}: {
  settings: FormatSettings;
  busy: boolean;
  onPickFolder: () => void;
}) {
  return (
    <>
      <span className="text-foreground w-16 text-sm">Folder</span>
      <Button
        variant="outline"
        className="col-span-2 w-full justify-start font-normal"
        onClick={onPickFolder}
        disabled={busy}
      >
        <FolderOpen />
        <span className="truncate">{settings.folder ?? "Downloads (default)"}</span>
      </Button>
    </>
  );
}

function CheckboxCard({
  label,
  checked,
  enabled,
  busy,
  onCheckedChange,
  children,
}: {
  label: string;
  checked: boolean;
  enabled: boolean;
  busy: boolean;
  onCheckedChange: (v: boolean) => void;
  children?: ReactNode;
}) {
  return (
    <Label
      className={
        enabled
          ? "hover:bg-accent/50 flex cursor-pointer items-center gap-2.5 rounded-lg border p-3 font-normal"
          : "flex items-center gap-2.5 rounded-lg border p-3 font-normal opacity-40"
      }
    >
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => onCheckedChange(v === true)}
        disabled={!enabled || busy}
      />
      <span className="text-sm">{label}</span>
      {children}
    </Label>
  );
}

function SizePill({ bytes }: { bytes?: number | null }) {
  if (bytes == null || bytes <= 0) {
    return (
      <Badge variant="outline" className="text-muted-foreground h-6 text-xs font-normal">
        — MB
      </Badge>
    );
  }
  const mb = bytes / (1024 * 1024);
  const text =
    mb >= 1024
      ? `${(mb / 1024).toFixed(1)} GB`
      : mb >= 1
        ? `${mb.toFixed(1)} MB`
        : `${(bytes / 1024).toFixed(0)} KB`;
  return (
    <Badge variant="secondary" className="h-6 shrink-0 text-xs font-normal tabular-nums">
      ≈ {text}
    </Badge>
  );
}
