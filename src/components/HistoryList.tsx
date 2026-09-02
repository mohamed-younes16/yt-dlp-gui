import { useState } from "react";
import {
  FolderOpen,
  History,
  Link2,
  MoreVertical,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { revealInFolder } from "@/lib/tauri";
import type { HistoryEntry } from "@/lib/types";

interface HistoryListProps {
  entries: HistoryEntry[];
  onRedownload: (entry: HistoryEntry) => void;
  onRemove: (index: number) => void;
  onClearAll: () => void;
}

function formatDate(ts: number): string {
  if (!Number.isFinite(ts)) return "";
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function thumbFallback(entry: HistoryEntry): string | null {
  // maxresdefault 404s often — fall back to hq once per image.
  if (entry.thumbnail?.includes("maxresdefault")) {
    return entry.thumbnail.replace("maxresdefault", "hqdefault");
  }
  return null;
}

export function HistoryList({
  entries,
  onRedownload,
  onRemove,
  onClearAll,
}: HistoryListProps) {
  if (entries.length === 0) {
    return (
      <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-2 text-sm">
        <History className="size-8 opacity-50" />
        No downloads yet — your history will appear here
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 items-center justify-between">
        <p className="text-muted-foreground text-sm">
          {entries.length} download{entries.length === 1 ? "" : "s"}
        </p>
        <Button variant="ghost" size="sm" onClick={onClearAll}>
          <Trash2 />
          Clear all
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1" viewportClassName="pr-3">
        <div className="flex flex-col gap-2">
          {entries.map((entry, i) => (
            <HistoryRow
              key={`${entry.videoId}-${entry.downloadedAt}-${i}`}
              entry={entry}
              index={i}
              onRedownload={onRedownload}
              onRemove={onRemove}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

function HistoryRow({
  entry,
  index,
  onRedownload,
  onRemove,
}: {
  entry: HistoryEntry;
  index: number;
  onRedownload: (entry: HistoryEntry) => void;
  onRemove: (index: number) => void;
}) {
  const [failed, setFailed] = useState(false);
  const src = !failed ? entry.thumbnail : thumbFallback(entry) ?? entry.thumbnail;
  const revealTarget = entry.path ?? entry.folder;

  function copyLink() {
    navigator.clipboard
      .writeText(entry.url)
      .then(() => toast.success("Link copied"))
      .catch(() => {});
  }

  return (
    <div className="hover:bg-accent/40 flex items-center gap-3 rounded-lg border p-3 transition-colors">
      {src ? (
        <img
          src={src}
          alt=""
          className="aspect-video w-24 shrink-0 rounded-md border object-cover"
          referrerPolicy="no-referrer"
          onError={() => {
            if (!failed && thumbFallback(entry)) setFailed(true);
          }}
        />
      ) : (
        <div className="bg-muted aspect-video w-24 shrink-0 rounded-md border" />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{entry.title}</p>
        <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <Badge variant="secondary" className="h-5 px-1.5 text-micro uppercase">
            {entry.mode}
          </Badge>
          <span>{entry.qualityLabel}</span>
          <span>·</span>
          <span>{formatDate(entry.downloadedAt)}</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Re-download"
              onClick={() => onRedownload(entry)}
            >
              <RotateCcw />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">Re-download</TooltipContent>
        </Tooltip>
        {revealTarget && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Show in folder"
                onClick={() => revealInFolder(revealTarget).catch(() => {})}
              >
                <FolderOpen />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Show in folder</TooltipContent>
          </Tooltip>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="More actions">
              <MoreVertical />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={copyLink}>
              <Link2 />
              Copy link
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={() => onRemove(index)}>
              <Trash2 />
              Remove from history
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
