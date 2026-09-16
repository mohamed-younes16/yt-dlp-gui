import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Clock, ListVideo } from "lucide-react";
import { formatDuration } from "@/lib/types";
import type { PlaylistEntry } from "@/lib/types";

const PAGE_SIZE = 10;

export function PlaylistPreviewDialog({
  open,
  onOpenChange,
  playlistTitle,
  entries,
  loading = false,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  playlistTitle: string;
  entries: PlaylistEntry[];
  loading?: boolean;
}) {
  const { t } = useTranslation();
  const [page, setPage] = useState(0);

  const totalPages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  // Clamp if entries shrank while dialog was open.
  const safePage = Math.min(page, totalPages - 1);
  const pageEntries = useMemo(
    () => entries.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE),
    [entries, safePage],
  );

  // Reset to page 0 when playlist changes or dialog reopens.
  useEffect(() => {
    setPage(0);
  }, [entries.length, open]);

  // Reset to first page when dialog opens or entries change identity.
  // (keyed by open + length so a new fetch resets).
  // Use derived reset: when open flips, parent should remount or we handle here.
  // Simple: if page is out of range, it was clamped; otherwise keep.
  // Explicit reset on open via effect in parent if needed — not required.

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] sm:max-w-[720px] flex flex-col p-0 overflow-hidden">
        <DialogHeader className="px-4 pt-4 pb-0 shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <ListVideo className="size-5 text-primary" />
            {t("playlistDialog.title")}
            <Badge variant="secondary" className="tabular-nums">
              {entries.length}
            </Badge>
          </DialogTitle>
          <DialogDescription className="line-clamp-2 text-left">
            {playlistTitle}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="min-h-0 flex-1">
          {loading ? (
            <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
              <span className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              {t("playlistDialog.loading")}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-4 pt-2">
            {pageEntries.map((e, i) => {
              const idx = safePage * PAGE_SIZE + i + 1;
              return (
                <div
                  key={e.id + String(idx)}
                  className="flex gap-3 rounded-lg border bg-card p-2.5"
                >
                  <span className="text-muted-foreground text-xs tabular-nums shrink-0 pt-0.5 w-6 text-right">
                    {idx}.
                  </span>
                  {e.thumbnail ? (
                    <img
                      src={e.thumbnail}
                      alt=""
                      className="size-14 shrink-0 rounded-md object-cover bg-muted"
                      referrerPolicy="no-referrer"
                      loading="lazy"
                    />
                  ) : (
                    <div className="size-14 shrink-0 rounded-md bg-muted" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-sm font-medium leading-snug">
                      {e.title}
                    </p>
                    {e.duration ? (
                      <p className="text-muted-foreground flex items-center gap-1 text-xs mt-1">
                        <Clock className="size-3" />
                        {formatDuration(e.duration)}
                      </p>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
          )}
        </ScrollArea>

        <div className="flex items-center justify-between gap-2 border-t bg-muted/40 px-4 py-3 shrink-0">
          <p className="text-muted-foreground text-xs tabular-nums">
            {t("playlistDialog.showing", {
              from: entries.length === 0 ? 0 : safePage * PAGE_SIZE + 1,
              to: Math.min((safePage + 1) * PAGE_SIZE, entries.length),
              total: entries.length,
            })}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={safePage === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              {t("playlistDialog.prev")}
            </Button>
            <span className="text-xs tabular-nums min-w-12 text-center">
              {safePage + 1} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={safePage >= totalPages - 1}
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            >
              {t("playlistDialog.next")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
