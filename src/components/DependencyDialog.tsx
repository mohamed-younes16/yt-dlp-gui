import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
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
import i18n from "@/i18n";

function copy(text: string) {
  navigator.clipboard
    .writeText(text)
    .then(() => toast.success(i18n.t("toast.copiedToClipboard")))
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
  const { t } = useTranslation();
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
          {ok ? t("dialog.found") : t("dialog.missing")}
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
  const { t } = useTranslation();
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
            {allOk ? t("dialog.depsReady") : t("dialog.depsMissing")}
          </DialogTitle>
          <DialogDescription>
            {allOk
              ? t("dialog.depsReadyDesc")
              : t("dialog.depsMissingDesc")}
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
              <strong>What it does:</strong> Downloads videos and audio from YouTube and other sites.
            </li>
            <li>
              <strong>Easiest install:</strong> open PowerShell and run
              <CopyChip command="winget install yt-dlp.yt-dlp" />
            </li>
            <li>
              Or download from{" "}
              <a
                href="https://github.com/yt-dlp/yt-dlp/releases"
                target="_blank"
                rel="noreferrer"
                className="text-primary inline-flex items-center gap-1 underline"
              >
                github.com/yt-dlp/yt-dlp <ExternalLink className="size-3" />
              </a>
              , extract the <code className="bg-muted rounded px-1 py-0.5 font-mono text-xs">.exe</code> file, and move it to a folder on your PATH (like{" "}
              <code className="bg-muted rounded px-1 py-0.5 font-mono text-xs">C:\yt-dlp</code>).
            </li>
            <li>Then click <strong>Recheck</strong> below — no restart needed.</li>
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
              <strong>What it does:</strong> Merges video + audio and handles audio extraction (needed for most downloads).
            </li>
            <li>
              <strong>Easiest install:</strong> open PowerShell and run
              <CopyChip command="winget install Gyan.FFmpeg" />
            </li>
            <li>
              Or download from{" "}
              <a
                href="https://www.gyan.dev/ffmpeg/builds/"
                target="_blank"
                rel="noreferrer"
                className="text-primary inline-flex items-center gap-1 underline"
              >
                gyan.dev <ExternalLink className="size-3" />
              </a>{" "}
              — get the <strong>ffmpeg-release-essentials.zip</strong>, extract it, and move the{" "}
              <code className="bg-muted rounded px-1 py-0.5 font-mono text-xs">bin</code>{" "}
              folder contents to a folder on your PATH.
            </li>
            <li>Then click <strong>Recheck</strong> below — no restart needed.</li>
          </DepRow>
        </div>

        <Separator />

        <div className="flex items-center justify-between gap-2">
          <p className="text-muted-foreground text-xs">
            {t("dialog.recheckDesc")}
          </p>
          <div className="flex shrink-0 gap-2">
            {hasYt && (
              <Button
                variant="outline"
                onClick={handleUpdate}
                disabled={updating}
              >
                <RefreshCw className={updating ? "size-4 animate-spin" : "size-4"} />
                {updating ? t("dialog.updating") : t("dialog.updateYtdlp")}
              </Button>
            )}
            <Button variant="outline" onClick={onRecheck}>
              {t("deps.recheck")}
            </Button>
            {allOk && (
              <Button onClick={() => onOpenChange?.(false)}>{t("dialog.continue")}</Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
