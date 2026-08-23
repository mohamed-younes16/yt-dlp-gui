import { CheckCircle2, Copy, ExternalLink, XCircle, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import type { DependencyStatus } from "@/lib/tauri";

function copy(text: string) {
  navigator.clipboard.writeText(text).then(() => toast.success("Copied to clipboard"));
}

export function DependencyDialog({
  open,
  status,
  onRecheck,
  onOpenChange,
}: {
  open: boolean;
  status: DependencyStatus | null;
  onRecheck: () => void;
  onOpenChange?: (o: boolean) => void;
}) {
  const hasYt = status?.hasYtdlp ?? false;
  const hasFf = status?.hasFfmpeg ?? false;
  const allOk = hasYt && hasFf;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[85vh] overflow-y-auto sm:max-w-[560px]"
        onInteractOutside={(e) => {
          if (!allOk) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (!allOk) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {allOk ? (
              <CheckCircle2 className="size-5 text-primary" />
            ) : (
              <AlertTriangle className="size-5 text-amber-500" />
            )}
            {allOk ? "All dependencies ready" : "Missing dependencies"}
          </DialogTitle>
          <DialogDescription>
            {allOk
              ? "yt-dlp and ffmpeg are detected. You can close this and start downloading."
              : "ytdl-gui needs yt-dlp and ffmpeg on your PATH. Install them once and you're set."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          {/* yt-dlp */}
          <div className="rounded-xl border p-4">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm font-semibold">
                {hasYt ? <CheckCircle2 className="size-4 text-primary" /> : <XCircle className="size-4 text-destructive" />}
                yt-dlp
                {hasYt && status?.ytdlpVersion && (
                  <Badge variant="secondary" className="font-mono text-[11px]">{status.ytdlpVersion}</Badge>
                )}
              </span>
              <Badge variant={hasYt ? "default" : "destructive"}>{hasYt ? "Found" : "Missing"}</Badge>
            </div>
            {!hasYt && (
              <div className="mt-3 flex flex-col gap-2">
                <ol className="text-muted-foreground list-decimal space-y-1 pl-5 text-sm">
                  <li>
                    Fastest on Windows: open PowerShell and run
                    <code className="bg-muted mx-1 rounded px-1 py-0.5 font-mono text-xs">winget install yt-dlp.yt-dlp</code>
                    <Button variant="ghost" size="icon" className="ml-1 size-6" onClick={() => copy("winget install yt-dlp.yt-dlp")} title="Copy">
                      <Copy className="size-3" />
                    </Button>
                  </li>
                  <li>
                    Or download the standalone exe from{" "}
                    <a href="https://github.com/yt-dlp/yt-dlp/releases" target="_blank" rel="noreferrer" className="text-primary inline-flex items-center gap-1 underline">
                      github.com/yt-dlp/yt-dlp <ExternalLink className="size-3" />
                    </a>{" "}
                    and add it to PATH.
                  </li>
                  <li>Restart ytdl-gui after install.</li>
                </ol>
              </div>
            )}
          </div>

          {/* ffmpeg */}
          <div className="rounded-xl border p-4">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm font-semibold">
                {hasFf ? <CheckCircle2 className="size-4 text-primary" /> : <XCircle className="size-4 text-destructive" />}
                ffmpeg
                {hasFf && status?.ffmpegVersion && (
                  <Badge variant="secondary" className="max-w-[220px] truncate font-mono text-[11px]">{status.ffmpegVersion.split("\n")[0]}</Badge>
                )}
              </span>
              <Badge variant={hasFf ? "default" : "destructive"}>{hasFf ? "Found" : "Missing"}</Badge>
            </div>
            {!hasFf && (
              <div className="mt-3 flex flex-col gap-2">
                <ol className="text-muted-foreground list-decimal space-y-1 pl-5 text-sm">
                  <li>
                    On Windows: <code className="bg-muted mx-1 rounded px-1 py-0.5 font-mono text-xs">winget install Gyan.FFmpeg</code>
                    <Button variant="ghost" size="icon" className="ml-1 size-6" onClick={() => copy("winget install Gyan.FFmpeg")} title="Copy">
                      <Copy className="size-3" />
                    </Button>{" "}
                    or <code className="bg-muted rounded px-1 py-0.5 font-mono text-xs">winget install FFmpeg.FFmpeg</code>
                  </li>
                  <li>
                    Or grab a build from{" "}
                    <a href="https://ffmpeg.org/download.html" target="_blank" rel="noreferrer" className="text-primary inline-flex items-center gap-1 underline">
                      ffmpeg.org <ExternalLink className="size-3" />
                    </a>{" "}
                    /{" "}
                    <a href="https://www.gyan.dev/ffmpeg/builds/" target="_blank" rel="noreferrer" className="text-primary inline-flex items-center gap-1 underline">
                      gyan.dev <ExternalLink className="size-3" />
                    </a>{" "}
                    and add <code className="bg-muted rounded px-1 py-0.5 font-mono text-xs">bin</code> to PATH.
                  </li>
                  <li>Restart ytdl-gui after install.</li>
                </ol>
              </div>
            )}
          </div>
        </div>

        <Separator />

        <div className="flex items-center justify-between gap-2">
          <p className="text-muted-foreground text-xs">
            Tip: after installing, hit Recheck. No restart needed on most setups.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onRecheck}>
              Recheck
            </Button>
            {allOk && (
              <Button onClick={() => onOpenChange?.(false)}>Continue</Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
