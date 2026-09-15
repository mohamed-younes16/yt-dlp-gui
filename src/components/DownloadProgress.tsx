import { CheckCircle2, ChevronDown, ChevronUp, ListMusic, Loader2, X, XCircle } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { fileNameOf } from "@/lib/types";
import type { DownloadJob } from "@/lib/types";

interface DownloadStatusBarProps {
  job: DownloadJob;
  queueCount: number;
  queuedJobs: DownloadJob[];
  onCancel: (id: string) => void;
  onDismiss: (id: string) => void;
}

export function DownloadStatusBar({
  job,
  queueCount,
  queuedJobs,
  onCancel,
  onDismiss,
}: DownloadStatusBarProps) {
  const { t } = useTranslation();

  function phaseLabel(job: DownloadJob): string {
    const both = job.settings.mode === "both";
    switch (job.phase) {
      case "audio":
        return both ? t("download.audioBoth") : t("download.audio");
      case "thumbnail":
        return t("download.thumbnail");
      default:
        return both ? t("download.videoBoth") : t("download.video");
    }
  }

  const active = job.status === "starting" || job.status === "downloading";
  const percent = Math.min(job.percent, 100);
  const [queueOpen, setQueueOpen] = useState(false);

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
              ? fileNameOf(job.file) || t("download.complete")
              : job.status === "error"
                ? job.message || t("download.failed")
                : job.status === "cancelled"
                  ? t("download.cancelled")
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
            <button
              type="button"
              className="bg-muted text-muted-foreground ml-auto inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-micro tabular-nums transition-colors hover:bg-muted/80"
              onClick={() => setQueueOpen((o) => !o)}
            >
              <ListMusic className="size-3" />
              {t("download.queued", { count: queueCount })}
              {queueOpen ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
            </button>
          )}
          {active ? (
            <Button
              variant="outline"
              size="xs"
              className={queueCount > 0 ? "" : "ml-auto"}
              onClick={() => onCancel(job.id)}
            >
              <X />
              {t("download.cancel")}
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="xs"
              className={queueCount > 0 ? "" : "ml-auto"}
              onClick={() => onDismiss(job.id)}
              aria-label={t("download.dismiss")}
            >
              <X />
              {t("download.dismiss")}
            </Button>
          )}
        </div>
        {active && <Progress value={percent} className="h-1.5" />}
        {queueCount > 0 && queueOpen && (
          <div className="flex flex-col gap-1 border-t pt-2">
            {queuedJobs.map((q, i) => (
              <div
                key={q.id}
                className="flex items-center gap-2 rounded-md px-2 py-1 text-xs"
              >
                <span className="text-muted-foreground w-4 shrink-0 text-right tabular-nums">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate">{q.info.title}</span>
                <span className="text-muted-foreground shrink-0 capitalize">
                  {q.settings.mode}
                </span>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="shrink-0"
                  onClick={() => onCancel(q.id)}
                  aria-label={`${t("download.cancel")}: ${q.info.title}`}
                >
                  <X className="size-3" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
