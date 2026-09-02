import { CheckCircle2, ListMusic, Loader2, X, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { fileNameOf } from "@/lib/types";
import type { DownloadJob } from "@/lib/types";

interface DownloadStatusBarProps {
  job: DownloadJob;
  queueCount: number;
  onCancel: (id: string) => void;
  onDismiss: (id: string) => void;
}

function phaseLabel(job: DownloadJob): string {
  const both = job.settings.mode === "both";
  switch (job.phase) {
    case "audio":
      return both ? "Audio (2 of 2)" : "Audio";
    case "thumbnail":
      return "Thumbnail";
    default:
      return both ? "Video (1 of 2)" : "Video";
  }
}

export function DownloadStatusBar({
  job,
  queueCount,
  onCancel,
  onDismiss,
}: DownloadStatusBarProps) {
  const active = job.status === "starting" || job.status === "downloading";
  const percent = Math.min(job.percent, 100);

  return (
    <Card size="sm" className="shrink-0 py-0">
      <CardContent className="flex flex-col gap-2 px-3 py-2.5">
        <div className="flex items-center gap-2 text-sm">
          {active ? (
            <Loader2 className="text-muted-foreground size-4 shrink-0 animate-spin" />
          ) : job.status === "done" ? (
            <CheckCircle2 className="text-success size-4 shrink-0" />
          ) : (
            <XCircle className="text-destructive size-4 shrink-0" />
          )}
          <span className="min-w-0 truncate font-medium">
            {job.status === "done"
              ? fileNameOf(job.file) || "Download complete"
              : job.status === "error"
                ? job.message || "Download failed"
                : job.status === "cancelled"
                  ? "Download cancelled"
                  : job.info.title}
          </span>
          {active && (
            <span className="text-muted-foreground ml-auto hidden shrink-0 tabular-nums sm:inline">
              {phaseLabel(job)} · {percent.toFixed(1)}%
              {job.speed ? ` · ${job.speed}` : ""}
              {job.eta ? ` · ETA ${job.eta}` : ""}
            </span>
          )}
          {queueCount > 0 && (
            <span className="bg-muted text-muted-foreground ml-auto inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-micro tabular-nums">
              <ListMusic className="size-3" />
              {queueCount} queued
            </span>
          )}
          {active ? (
            <Button
              variant="outline"
              size="xs"
              className={queueCount > 0 ? "" : "ml-auto"}
              onClick={() => onCancel(job.id)}
            >
              <X />
              Cancel
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="xs"
              className={queueCount > 0 ? "" : "ml-auto"}
              onClick={() => onDismiss(job.id)}
              aria-label="Dismiss"
            >
              <X />
              Dismiss
            </Button>
          )}
        </div>
        {active && <Progress value={percent} className="h-1.5" />}
      </CardContent>
    </Card>
  );
}
