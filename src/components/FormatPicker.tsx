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
} from "@/lib/types";

export interface FormatSettings {
  mode: DownloadMode;
  quality: number;
  container: string;
  audioBitrate: number;
  audioFormat: string;
  saveThumbnail: boolean;
  embedThumbnail: boolean;
  embedMetadata: boolean;
  folder: string | null;
}

interface FormatPickerProps {
  settings: FormatSettings;
  onChange: (patch: Partial<FormatSettings>) => void;
  downloading: boolean;
  onPickFolder: () => void;
  onDownload: () => void;
  estimate?: number | null;
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
  downloading,
  onPickFolder,
  onDownload,
  estimate,
}: FormatPickerProps) {
  const isThumbnail = settings.mode === "thumbnail";
  const isAudioOnly = settings.mode === "audio";

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {MODES.map(({ value, label, icon: Icon }) => (
          <Button
            key={value}
            variant={settings.mode === value ? "default" : "outline"}
            className="h-12 flex-col gap-1 py-2"
            onClick={() => onChange({ mode: value })}
            disabled={downloading}
          >
            <Icon className="size-4" />
            <span className="text-xs font-medium">{label}</span>
          </Button>
        ))}
      </div>

      {!isThumbnail ? (
        <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-3">
          <span className="text-foreground w-16 text-sm">Quality</span>
          <Select
            value={
              isAudioOnly
                ? String(settings.audioBitrate)
                : String(settings.quality)
            }
            onValueChange={(v) =>
              isAudioOnly
                ? onChange({ audioBitrate: Number(v) })
                : onChange({ quality: Number(v) })
            }
            disabled={downloading}
          >
            <SelectTrigger className="min-w-0">
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

          <span className="text-foreground text-sm">
            {isAudioOnly ? "Format" : "Container"}
          </span>
          {isAudioOnly ? (
            <Select
              value={settings.audioFormat}
              onValueChange={(v) => onChange({ audioFormat: v })}
              disabled={downloading}
            >
              <SelectTrigger className="min-w-0">
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
              disabled={downloading}
            >
              <SelectTrigger className="min-w-0">
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

          <span className="text-foreground w-16 text-sm">Folder</span>
          <div className="col-span-2">
            <Button
              variant="outline"
              className="w-full justify-start font-normal"
              onClick={onPickFolder}
              disabled={downloading}
            >
              <FolderOpen className="size-4" />
              <span className="truncate">
                {settings.folder ?? "Downloads (default)"}
              </span>
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3">
          <span className="text-foreground w-16 text-sm">Folder</span>
          <Button
            variant="outline"
            className="justify-start font-normal"
            onClick={onPickFolder}
            disabled={downloading}
          >
            <FolderOpen className="size-4" />
            <span className="truncate">
              {settings.folder ?? "Downloads (default)"}
            </span>
          </Button>
          <SizePill bytes={estimate} />
        </div>
      )}

      {isThumbnail && (
        <p className="text-muted-foreground -mt-1 text-center text-xs">
          Saves the highest-resolution thumbnail as JPG — no video download.
        </p>
      )}

      {!isThumbnail && (
        <>
          <Separator />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Label className="hover:bg-accent/50 flex cursor-pointer items-center gap-2.5 rounded-lg border p-3 font-normal">
              <Checkbox
                checked={settings.saveThumbnail}
                onCheckedChange={(v) => onChange({ saveThumbnail: v === true })}
                disabled={downloading}
              />
              <span className="text-sm">Save thumbnail</span>
            </Label>
            <Label className="hover:bg-accent/50 flex cursor-pointer items-center gap-2.5 rounded-lg border p-3 font-normal">
              <Checkbox
                checked={settings.embedThumbnail}
                onCheckedChange={(v) => onChange({ embedThumbnail: v === true })}
                disabled={downloading}
              />
              <span className="text-sm">Embed thumbnail</span>
            </Label>
            <Label className="hover:bg-accent/50 flex cursor-pointer items-center gap-2.5 rounded-lg border p-3 font-normal">
              <Checkbox
                checked={settings.embedMetadata}
                onCheckedChange={(v) => onChange({ embedMetadata: v === true })}
                disabled={downloading}
              />
              <span className="text-sm">Embed metadata</span>
            </Label>
          </div>
        </>
      )}

      <Button
        size="lg"
        className="h-12 text-base font-semibold"
        onClick={onDownload}
        disabled={downloading}
      >
        <Download className="size-5" />
        {isThumbnail ? "Download thumbnail" : "Download"}
      </Button>
    </div>
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
    mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
  return (
    <Badge variant="secondary" className="h-6 shrink-0 text-xs font-normal tabular-nums">
      ≈ {text}
    </Badge>
  );
}
