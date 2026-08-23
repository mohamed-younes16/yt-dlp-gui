import { FolderOpen, History, MoreVertical, RotateCcw, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { revealInFolder } from "@/lib/tauri";
import type { HistoryEntry } from "@/lib/types";

interface HistoryListProps {
  entries: HistoryEntry[];
  onRedownload: (entry: HistoryEntry) => void;
  onRemove: (index: number) => void;
  onClearAll: () => void;
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function HistoryList({
  entries,
  onRedownload,
  onRemove,
  onClearAll,
}: HistoryListProps) {
  if (entries.length === 0) {
    return (
      <div className="text-muted-foreground flex flex-col items-center gap-2 py-16 text-sm">
        <History className="size-8 opacity-50" />
        No downloads yet — your history will appear here
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-sm">
          {entries.length} download{entries.length === 1 ? "" : "s"}
        </p>
        <Button variant="ghost" size="sm" onClick={onClearAll}>
          <Trash2 className="size-4" />
          Clear all
        </Button>
      </div>
      <ScrollArea className="h-[calc(100dvh-320px)] min-h-64 pr-3">
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
  return (
    <div className="group hover:bg-accent/50 flex items-center gap-3 rounded-xl border p-2.5 transition-colors">
      {entry.thumbnail ? (
        <img
          src={entry.thumbnail}
          alt=""
          className="aspect-video w-24 shrink-0 rounded-md border object-cover"
          referrerPolicy="no-referrer"
        />
      ) : (
        <div className="bg-muted aspect-video w-24 shrink-0 rounded-md border" />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{entry.title}</p>
        <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <Badge variant="secondary" className="h-5 px-1.5 text-[10px] uppercase">
            {entry.mode}
          </Badge>
          <span>{entry.qualityLabel}</span>
          <span>·</span>
          <span>{formatDate(entry.downloadedAt)}</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          title="Re-download"
          onClick={() => onRedownload(entry)}
        >
          <RotateCcw className="size-4" />
        </Button>
        {entry.folder && (
          <Button
            variant="ghost"
            size="icon"
            title="Show in folder"
            onClick={() => revealInFolder(entry.folder!).catch(() => {})}
          >
            <FolderOpen className="size-4" />
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon">
              <MoreVertical className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onRedownload(entry)}>
              <RotateCcw className="size-4" />
              Re-download
            </DropdownMenuItem>
            {entry.folder && (
              <DropdownMenuItem
                onClick={() => revealInFolder(entry.folder!).catch(() => {})}
              >
                <FolderOpen className="size-4" />
                Show in folder
              </DropdownMenuItem>
            )}
            <DropdownMenuItem variant="destructive" onClick={() => onRemove(index)}>
              <Trash2 className="size-4" />
              Remove from history
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
