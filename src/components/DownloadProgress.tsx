import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type {
  DownloadProgress as ProgressData,
} from "@/lib/types";

interface DownloadProgressProps {
  progress: ProgressData | null;
  phase: "video" | "audio";
  onCancel: () => void;
}

export function DownloadStatusBar({
  progress,
  phase,
  onCancel,
}: DownloadProgressProps) {
  const status = progress?.status;
  const percent = progress?.percent ?? 0;

  return (
    <Card className="py-0">
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
            {status === "done" ? (
              <span className="text-primary">Done — saved to your folder</span>
            ) : status === "cancelled" ? (
              <span>Download cancelled</span>
            ) : status === "error" ? (
              <span className="text-destructive">Download failed</span>
            ) : (
              <>
                <Loader2 className="text-muted-foreground size-4 animate-spin" />
                <span className="truncate">
                  {status === "starting"
                    ? "Starting…"
                    : `${phase === "video" ? "Video" : "Audio"} · ${percent.toFixed(1)}%`}
                </span>
                <span className="text-muted-foreground ml-auto shrink-0 tabular-nums">
                  {progress?.speed && `· ${progress.speed}`}
                  {progress?.eta && ` · ETA ${progress.eta}`}
                </span>
              </>
            )}
          </div>
          {(status === "starting" || status === "downloading") && (
            <Button variant="outline" size="sm" onClick={onCancel}>
              <X className="size-4" />
              Cancel
            </Button>
          )}
        </div>
        {(status === "starting" || status === "downloading") && (
          <Progress value={percent} className="h-2" />
        )}
      </CardContent>
    </Card>
  );
}
