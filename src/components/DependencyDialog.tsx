import { useState, type ReactNode } from "react";
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  RefreshCw,
  XCircle,
  AlertTriangle,
} from "lucide-react";
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
import { updateYtdlp } from "@/lib/tauri";

function copy(text: string) {
  navigator.clipboard
    .writeText(text)
    .then(() => toast.success("Copied to clipboard"))
    .catch(() => {});
}

function CopyChip({ command }: { command: string }) {
  return (
    <>
      <code className="bg-muted mx-1 rounded px-1 py-0.5 font-mono text-xs">
        {command}
      </code>
      <Button
        variant="ghost"
        size="icon-xs"
        className="ml-1 align-middle"
        onClick={() => copy(command)}
        aria-label={`Copy command: ${command}`}
      >
        <Copy />
      </Button>
    </>
  );
}

function DepRow({
  name,
  ok,
  version,
  children,
}: {
  name: string;
  ok: boolean;
  version?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border p-4">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm font-semibold">
          {ok ? (
            <CheckCircle2 className="text-success size-4" />
          ) : (
            <XCircle className="text-destructive size-4" />
          )}
          {name}
          {version}
        </span>
        <Badge variant={ok ? "default" : "destructive"}>
          {ok ? "Found" : "Missing"}
        </Badge>
      </div>
      {!ok && (
        <ol className="text-muted-foreground mt-3 list-decimal space-y-1 pl-5 text-sm">
          {children}
        </ol>
      )}
    </div>
  );
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
  const [updating, setUpdating] = useState(false);
  const hasYt = status?.hasYtdlp ?? false;
  const hasFf = status?.hasFfmpeg ?? false;
  const allOk = hasYt && hasFf;

  async function handleUpdate() {
    setUpdating(true);
    try {
      const msg = await updateYtdlp();
      toast.success(msg || "yt-dlp updated");
      onRecheck();
    } catch (err) {
      toast.error("yt-dlp update failed", {
        description: String(err).slice(0, 240),
      });
    } finally {
      setUpdating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {allOk ? (
              <CheckCircle2 className="text-success size-5" />
            ) : (
              <AlertTriangle className="text-warning size-5" />
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
          <DepRow
            name="yt-dlp"
            ok={hasYt}
            version={
              hasYt && status?.ytdlpVersion ? (
                <Badge variant="secondary" className="font-mono text-micro">
                  {status.ytdlpVersion}
                </Badge>
              ) : undefined
            }
          >
            <li>
              Fastest on Windows: open PowerShell and run
              <CopyChip command="winget install yt-dlp.yt-dlp" />
            </li>
            <li>
              Or download the standalone exe from{" "}
              <a
                href="https://github.com/yt-dlp/yt-dlp/releases"
                target="_blank"
                rel="noreferrer"
                className="text-primary inline-flex items-center gap-1 underline"
              >
                github.com/yt-dlp/yt-dlp <ExternalLink className="size-3" />
              </a>{" "}
              and add it to PATH.
            </li>
            <li>Then hit Recheck below — no restart needed.</li>
          </DepRow>

          <DepRow
            name="ffmpeg"
            ok={hasFf}
            version={
              hasFf && status?.ffmpegVersion ? (
                <Badge
                  variant="secondary"
                  className="max-w-[220px] truncate font-mono text-micro"
                >
                  {status.ffmpegVersion.split("\n")[0]}
                </Badge>
              ) : undefined
            }
          >
            <li>
              On Windows: <CopyChip command="winget install Gyan.FFmpeg" />
            </li>
            <li>
              Or grab a build from{" "}
              <a
                href="https://ffmpeg.org/download.html"
                target="_blank"
                rel="noreferrer"
                className="text-primary inline-flex items-center gap-1 underline"
              >
                ffmpeg.org <ExternalLink className="size-3" />
              </a>{" "}
              /{" "}
              <a
                href="https://www.gyan.dev/ffmpeg/builds/"
                target="_blank"
                rel="noreferrer"
                className="text-primary inline-flex items-center gap-1 underline"
              >
                gyan.dev <ExternalLink className="size-3" />
              </a>{" "}
              and add{" "}
              <code className="bg-muted rounded px-1 py-0.5 font-mono text-xs">
                bin
              </code>{" "}
              to PATH.
            </li>
            <li>Then hit Recheck below — no restart needed.</li>
          </DepRow>
        </div>

        <Separator />

        <div className="flex items-center justify-between gap-2">
          <p className="text-muted-foreground text-xs">
            Recheck re-reads your PATH from the registry — installs show up
            without restarting the app.
          </p>
          <div className="flex shrink-0 gap-2">
            {hasYt && (
              <Button
                variant="outline"
                onClick={handleUpdate}
                disabled={updating}
              >
                <RefreshCw className={updating ? "size-4 animate-spin" : "size-4"} />
                {updating ? "Updating…" : "Update yt-dlp"}
              </Button>
            )}
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
