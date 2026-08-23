import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Download,
  History as HistoryIcon,
  Loader2,
  Moon,
  Settings,
  Sun,
} from "lucide-react";
import { toast } from "sonner";
import { DownloadStatusBar } from "@/components/DownloadProgress";
import { FormatPicker, type FormatSettings } from "@/components/FormatPicker";
import { HistoryList } from "@/components/HistoryList";
import { TrimSlider } from "@/components/TrimSlider";
import { UrlBar } from "@/components/UrlBar";
import { VideoCard } from "@/components/VideoCard";
import { SpotlightCard } from "@/components/SpotlightCard";
import MagicRings from "@/components/reactbits/MagicRings";
import ShinyText from "@/components/reactbits/ShinyText";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Toaster } from "@/components/ui/sonner";
import {
  cancelDownload,
  checkDependencies,
  fetchMetadata,
  listenProgress,
  loadHistory,
  pickFolder,
  saveHistory,
  startDownload,
} from "@/lib/tauri";
import {
  estimateSize,
  formatBytes,
  type DownloadProgress,
  type HistoryEntry,
  type VideoInfo,
} from "@/lib/types";
import type { DependencyStatus } from "@/lib/tauri";
import { DependencyDialog } from "@/components/DependencyDialog";

function initialTheme(): boolean {
  return localStorage.getItem("theme") !== "light";
}
function initialShiny(): boolean {
  return localStorage.getItem("shinyEnabled") !== "false";
}
function initialBgMode(): "rings" | "lite" | "off" {
  const v = localStorage.getItem("bgMode") as "rings" | "lite" | "off" | null;
  return v === "lite" || v === "off" ? v : "rings";
}

export default function App() {
  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [phase, setPhase] = useState<"video" | "audio">("video");
  const [tab, setTab] = useState<"download" | "history">("download");
  const [fetching, setFetching] = useState(false);
  const [bgMode, setBgMode] = useState<"rings" | "lite" | "off">(initialBgMode);
  const [shinyEnabled, setShinyEnabled] = useState<boolean>(initialShiny);
  const [trim, setTrim] = useState<[number, number] | null>(null);
  const [deps, setDeps] = useState<DependencyStatus | null>(null);
  const [depsOpen, setDepsOpen] = useState(false);
  const [dark, setDark] = useState<boolean>(initialTheme);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [settings, setSettings] = useState<FormatSettings>({
    mode: "video",
    quality: 1080,
    container: "mp4",
    audioBitrate: 320,
    audioFormat: "mp3",
    saveThumbnail: false,
    embedThumbnail: false,
    embedMetadata: true,
    folder: null,
  });

  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const estimate = useMemo(
    () => (info ? estimateSize(info, settings.mode, settings.quality) : null),
    [info, settings.mode, settings.quality],
  );

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("theme", dark ? "dark" : "light");
  }, [dark]);
  useEffect(() => {
    localStorage.setItem("bgMode", bgMode);
  }, [bgMode]);
  useEffect(() => {
    localStorage.setItem("shinyEnabled", String(shinyEnabled));
  }, [shinyEnabled]);

  useEffect(() => {
    checkDependencies()
      .then((d) => {
        setDeps(d);
        if (!d.hasYtdlp || !d.hasFfmpeg) setDepsOpen(true);
      })
      .catch(() => {});
    let disposed = false;
    loadHistory()
      .then((h) => !disposed && setHistory(h))
      .catch(() => {});
    listenProgress((p) => {
      if (p.status === "starting") setPhase(p.phase);
      setProgress(p);
      if (p.status === "done") {
        toast.success("Download complete", {
          description: "File saved to your download folder",
        });
      } else if (p.status === "cancelled") {
        toast.info("Download cancelled");
      }
    }).then((unlisten) => {
      if (disposed) unlisten();
      else unlistenRef.current = unlisten;
    });
    return () => {
      disposed = true;
      unlistenRef.current?.();
    };
  }, []);

  const unlistenRef = useRef<(() => void) | null>(null);

  function persistHistory(next: HistoryEntry[]) {
    setHistory(next);
    saveHistory(next).catch(() => {});
  }

  function recheckDeps() {
    checkDependencies()
      .then((d) => {
        setDeps(d);
        if (d.hasYtdlp && d.hasFfmpeg) {
          toast.success("All dependencies found");
          setDepsOpen(false);
        } else {
          toast.info("Still missing dependencies");
        }
      })
      .catch(() => toast.error("Could not check dependencies"));
  }

  async function handleFetch(url: string) {
    setFetching(true);
    // jump to download tab immediately so the hero doesn't flash between history → hero → workspace
    setTab("download");
    try {
      const result = await fetchMetadata(url);
      setInfo(result);
      setProgress(null);
      if (result.duration && result.duration > 0) {
        setTrim([0, Math.floor(result.duration)]);
      } else {
        setTrim(null);
      }
    } catch (err) {
      setInfo(null);
      toast.error("Could not fetch video", {
        description: String(err).slice(0, 200),
      });
    } finally {
      setFetching(false);
    }
  }

  function handleReset() {
    setInfo(null);
    setProgress(null);
    setTrim(null);
    setTab("download");
  }

  function handleDownloadRequest() {
    setConfirmOpen(true);
  }

  async function handleConfirmedDownload() {
    if (!info) return;
    setConfirmOpen(false);
    setProgress({ status: "starting", phase: "video", percent: 0 });
    const isTrimmed =
      trim &&
      info.duration &&
      (trim[0] > 0.5 || trim[1] < (info.duration as number) - 0.5);
    try {
      await startDownload({
        url: `https://www.youtube.com/watch?v=${info.id}`,
        mode: settings.mode,
        quality: settings.quality,
        container: settings.container,
        audioBitrate: settings.audioBitrate,
        audioFormat: settings.audioFormat,
        saveThumbnail: settings.saveThumbnail,
        embedThumbnail: settings.embedThumbnail,
        embedMetadata: settings.embedMetadata,
        folder: settings.folder,
        trimStart: isTrimmed ? trim![0] : null,
        trimEnd: isTrimmed ? trim![1] : null,
      });
    } catch (err) {
      setProgress({ status: "error", phase: "video", percent: 0 });
      toast.error("Download failed", {
        description: String(err).slice(0, 200),
      });
    }
  }

  const recordedRef = useRef(false);
  useEffect(() => {
    if (progress?.status === "downloading" || progress?.status === "starting") {
      recordedRef.current = false;
    }
    if (progress?.status === "done" && info && !recordedRef.current) {
      recordedRef.current = true;
      const s = settingsRef.current;
      const qualityLabel =
        s.mode === "thumbnail"
          ? "THUMBNAIL · JPG"
          : s.mode === "audio"
            ? `${s.audioFormat.toUpperCase()} · ${s.audioBitrate}kbps`
            : s.mode === "both"
              ? `${s.quality}p ${s.container.toUpperCase()} + ${s.audioFormat.toUpperCase()}`
              : `${s.quality}p ${s.container.toUpperCase()}`;
      const entry: HistoryEntry = {
        videoId: info.id,
        title: info.title,
        url: `https://www.youtube.com/watch?v=${info.id}`,
        channel: info.uploader,
        thumbnail: info.thumbnail,
        mode: s.mode,
        qualityLabel,
        folder: s.folder ?? undefined,
        downloadedAt: Date.now(),
      };
      persistHistory([entry, ...history].slice(0, 200));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress?.status]);

  async function handleCancel() {
    try {
      await cancelDownload();
    } catch (err) {
      toast.error(String(err).slice(0, 200));
    }
  }

  async function handlePickFolder() {
    const dir = await pickFolder();
    if (dir) setSettings((s) => ({ ...s, folder: dir }));
  }

  function handleRedownload(entry: HistoryEntry) {
    handleFetch(entry.url);
  }

  const downloading =
    progress?.status === "starting" || progress?.status === "downloading";
  const depsMissing = !deps || !deps.hasYtdlp || !deps.hasFfmpeg;

  const confirmLabel =
    settings.mode === "thumbnail"
      ? "THUMBNAIL · JPG"
      : settings.mode === "audio"
        ? `${settings.audioFormat.toUpperCase()} · ${settings.audioBitrate} kbps`
        : settings.mode === "both"
          ? `${settings.quality}p ${settings.container.toUpperCase()} + audio`
          : `${settings.quality}p · ${settings.container.toUpperCase()}`;

  return (
    <main className="bg-background flex items-center text-foreground relative min-h-dvh overflow-hidden">
      {/* Background — rings (GPU, DPR=1) or lite (CSS ~0% GPU) */}
      {bgMode === "rings" ? (
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <MagicRings
            color="#00ff02"
            colorTwo="#fff399"
            ringCount={7}
            speed={0.6}
            attenuation={11.5}
            lineThickness={3.8}
            baseRadius={0.15}
            radiusStep={0.1}
            scaleRate={0.2}
            opacity={0.9}
            blur={0}
            noiseAmount={0.08}
            rotation={27}
            ringGap={1.1}
            fadeIn={0.1}
            fadeOut={3}
            followMouse
            mouseInfluence={0.15}
            hoverScale={1}
            parallax={0.06}
            clickBurst={false}
          />
        </div>
      ) : bgMode === "lite" ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-60"
          style={{
            background:
              "radial-gradient(ellipse 80% 60% at 50% 0%, color-mix(in oklab, var(--primary) 18%, transparent), transparent 70%), radial-gradient(ellipse 60% 50% at 95% 20%, color-mix(in oklab, #00dfff 14%, transparent), transparent 65%)",
          }}
        />
      ) : null}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-background/68 dark:bg-black/52"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.22] dark:opacity-[0.11]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, var(--foreground) 0.85px, transparent 0)",
          backgroundSize: "22px 22px",
        }}
      />

      <div className="relative mx-auto flex border h-[90vh] rounded-xl bg-background/80 w-full max-w-5xl flex-col px-4 py-5">
        {/* Top nav — single source of truth, strong active state + back affordance */}
        <header className="flex items-center justify-between gap-2  pb-4">
          <div className="flex items-center gap-2.5">
            <Button
              variant="outline"
              size="icon"
              className={`size-8 rounded-full border-2 shadow-sm transition-colors ${deps && deps.hasYtdlp && deps.hasFfmpeg ? "border-green-500/40 bg-green-50 dark:bg-green-950/30" : "border-amber-500/50 bg-amber-50 dark:bg-amber-950/30 animate-pulse"}`}
              onClick={() => setDepsOpen(true)}
              title={
                deps && deps.hasYtdlp && deps.hasFfmpeg
                  ? "Dependencies OK — click for details"
                  : "Missing dependencies — click to fix"
              }
            >
              {deps && deps.hasYtdlp && deps.hasFfmpeg ? (
                <CheckCircle2 className="size-4 text-green-600 dark:text-green-400" />
              ) : (
                <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400" />
              )}
            </Button>
            <button
              onClick={handleReset}
              className="shrink-0"
              title="Back to home"
            >
              {shinyEnabled ? (
                <ShinyText
                  text="ytdl-gui"
                  speed={3}
                  className="text-lg font-bold tracking-tight sm:text-xl"
                  color="var(--foreground)"
                  shineColor="var(--primary)"
                />
              ) : (
                <span className="text-lg font-bold tracking-tight sm:text-xl text-foreground">
                  ytdl-gui
                </span>
              )}
            </button>
          </div>

          <div className="bg-card border-border flex items-center gap-1 rounded-full border p-1 shadow-sm backdrop-blur-md">
            <Button
              variant={tab === "download" ? "default" : "ghost"}
              size="sm"
              aria-current={tab === "download" ? "page" : undefined}
              className={
                tab === "download"
                  ? "h-8 gap-1.5 rounded-full px-4 text-sm font-semibold shadow"
                  : "text-foreground hover:bg-accent h-8 gap-1.5 rounded-full px-4 text-sm font-medium"
              }
              onClick={() => setTab("download")}
            >
              <Download className="size-4" />
              Download
            </Button>
            <Button
              variant={tab === "history" ? "default" : "ghost"}
              size="sm"
              aria-current={tab === "history" ? "page" : undefined}
              className={
                tab === "history"
                  ? "h-8 gap-1.5 rounded-full px-4 text-sm font-semibold shadow"
                  : "text-foreground hover:bg-accent h-8 gap-1.5 rounded-full px-4 text-sm font-medium"
              }
              onClick={() => setTab("history")}
            >
              <HistoryIcon className="size-4" />
              History
              {history.length > 0 && (
                <span
                  className={
                    tab === "history"
                      ? "bg-primary-foreground/20 ml-0.5 rounded-full px-1.5 py-0.5 text-[11px] tabular-nums"
                      : "bg-accent text-foreground ml-0.5 rounded-full px-1.5 py-0.5 text-[11px] tabular-nums"
                  }
                >
                  {history.length}
                </span>
              )}
            </Button>
          </div>

          <div className="flex items-center gap-1">
            <Drawer>
              <DrawerTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0"
                  title="Settings"
                >
                  <Settings className="size-4" />
                </Button>
              </DrawerTrigger>
              <DrawerContent className="mx-auto max-w-xl">
                <DrawerHeader className="text-left">
                  <DrawerTitle>Settings</DrawerTitle>
                  <DrawerDescription>
                    App preferences — stored locally.
                  </DrawerDescription>
                </DrawerHeader>
                <div className="flex flex-col gap-4 px-4 pb-6">
                  <div className="flex items-center justify-between rounded-lg border p-3">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium">Theme</span>
                      <span className="text-muted-foreground text-xs">
                        Toggle dark / light
                      </span>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setDark((d) => !d)}
                    >
                      {dark ? (
                        <>
                          <Sun className="size-4" /> Light
                        </>
                      ) : (
                        <>
                          <Moon className="size-4" /> Dark
                        </>
                      )}
                    </Button>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border p-3">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium">
                        Download folder
                      </span>
                      <span className="text-muted-foreground line-clamp-1 text-xs">
                        {settings.folder ?? "Downloads (default)"}
                      </span>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handlePickFolder}
                    >
                      Change
                    </Button>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border p-3">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium">Background</span>
                      <span className="text-muted-foreground text-xs">
                        Rings = shader (GPU) · Lite = CSS (~0% GPU)
                      </span>
                    </div>
                    <Select
                      value={bgMode}
                      onValueChange={(v) => setBgMode(v as any)}
                    >
                      <SelectTrigger className="w-[140px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="rings">Magic Rings</SelectItem>
                        <SelectItem value="lite">Lite</SelectItem>
                        <SelectItem value="off">Off</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border p-3">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium">Shiny text</span>
                      <span className="text-muted-foreground text-xs">
                        Animated logo (per-frame)
                      </span>
                    </div>
                    <Switch
                      checked={shinyEnabled}
                      onCheckedChange={setShinyEnabled}
                    />
                  </div>
                  <div className="flex items-center justify-between rounded-lg border p-3">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium">Dependencies</span>
                      <span className="text-muted-foreground text-xs">
                        {deps
                          ? deps.hasYtdlp && deps.hasFfmpeg
                            ? "yt-dlp + ffmpeg ready"
                            : !deps.hasYtdlp && !deps.hasFfmpeg
                              ? "yt-dlp & ffmpeg missing"
                              : !deps.hasYtdlp
                                ? "yt-dlp missing"
                                : "ffmpeg missing"
                          : "Checking..."}
                      </span>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setDepsOpen(true)}
                    >
                      {deps && deps.hasYtdlp && deps.hasFfmpeg ? "View" : "Fix"}
                    </Button>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border p-3">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium">History</span>
                      <span className="text-muted-foreground text-xs">
                        {history.length} saved
                      </span>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={history.length === 0}
                      onClick={() => persistHistory([])}
                    >
                      Clear all
                    </Button>
                  </div>
                </div>
              </DrawerContent>
            </Drawer>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0"
              onClick={() => setDark((d) => !d)}
              title="Toggle theme"
            >
              {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </Button>
          </div>
        </header>
        <Separator />
        {/* Breadcrumb / context bar — tells you exactly where you are */}
        <div className="text-foreground/80 flex h-6 items-center gap-1.5 my-6 text-sm font-medium">
          {tab === "history" ? (
            <>
              <button
                onClick={() => setTab("download")}
                className="hover:text-foreground text-foreground inline-flex items-center gap-1.5 font-semibold transition-colors"
              >
                <ArrowLeft className="size-3.5" />
                Download
              </button>
              <span className="text-foreground/40">/</span>
              <span className="text-foreground font-semibold">History</span>
              <span className="bg-muted rounded-full px-1.5 py-0.5 text-[10px] tabular-nums">
                {history.length}
              </span>
            </>
          ) : fetching ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              <span className="text-foreground font-semibold">
                Fetching video…
              </span>
            </>
          ) : !info ? (
            <span className="text-foreground font-medium">
              Home — paste a link to start
            </span>
          ) : (
            <>
              <button
                onClick={handleReset}
                className="hover:text-foreground text-foreground inline-flex items-center gap-1.5 font-semibold transition-colors"
              >
                <ArrowLeft className="size-3.5" />
                Back
              </button>
              <span className="text-foreground/40">/</span>
              <span className="text-foreground line-clamp-1 font-medium">
                {info.title}
              </span>
            </>
          )}
        </div>
        <Separator />
        <AnimatePresence mode="wait">
          {tab === "history" ? (
            <motion.div
              key="history"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              className="flex flex-1 flex-col gap-3 pt-2"
            >
              <HistoryList
                entries={history}
                onRedownload={handleRedownload}
                onRemove={(i) => {
                  const next = history.filter((_, idx) => idx !== i);
                  persistHistory(next);
                }}
                onClearAll={() => persistHistory([])}
              />
            </motion.div>
          ) : fetching ? (
            <motion.div
              key="fetching"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              className="flex flex-1 flex-col items-center justify-center gap-4 pb-24"
            >
              <Loader2 className="text-primary size-8 animate-spin" />
              <p className="text-foreground text-sm font-semibold">
                Fetching video info…
              </p>
              <p className="text-muted-foreground text-xs">
                grabbing thumbnail & file sizes
              </p>
            </motion.div>
          ) : !info ? (
            <motion.div
              key="hero"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.35, ease: "easeOut" }}
              className="flex flex-1 flex-col items-center justify-center gap-7 pb-24"
            >
              {shinyEnabled ? (
                <ShinyText
                  text="ytdl-gui"
                  speed={4}
                  className="text-center text-5xl font-bold tracking-tight sm:text-6xl"
                  color="var(--foreground)"
                  shineColor="var(--primary)"
                />
              ) : (
                <span className="text-center text-5xl font-bold tracking-tight sm:text-6xl text-foreground">
                  ytdl-gui
                </span>
              )}
              <p className="text-muted-foreground -mt-3 max-w-sm text-center text-sm">
                Paste a link — preview the thumbnail, see file sizes, pick
                exactly what you want.
              </p>
              <div className="w-full max-w-lg">
                <UrlBar
                  onFetch={handleFetch}
                  disabled={downloading || fetching || depsMissing}
                />
              </div>
              <div className="text-muted-foreground flex flex-wrap justify-center gap-2 text-xs">
                {[
                  "MP4 · MKV · WEBM",
                  "MP3 · M4A · OPUS · WAV",
                  "THUMBNAIL · JPG",
                  "up to 4K",
                ].map((chip) => (
                  <span
                    key={chip}
                    className="bg-card/60 border-border rounded-full border px-2.5 py-1 backdrop-blur-sm"
                  >
                    {chip}
                  </span>
                ))}
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="workspace"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              className="flex flex-col gap-4"
            >
              <UrlBar
                onFetch={handleFetch}
                disabled={downloading || fetching || depsMissing}
              />
              <SpotlightCard>
                <VideoCard info={info} />
              </SpotlightCard>

              {trim && info.duration ? (
                <TrimSlider
                  duration={info.duration as number}
                  value={trim}
                  onChange={setTrim}
                  disabled={downloading || fetching || depsMissing}
                />
              ) : null}

              <FormatPicker
                settings={settings}
                onChange={(patch) => setSettings((s) => ({ ...s, ...patch }))}
                downloading={downloading || depsMissing}
                onPickFolder={handlePickFolder}
                onDownload={handleDownloadRequest}
                estimate={estimate}
              />

              <AnimatePresence>
                {progress && (
                  <motion.div
                    key="progress"
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <DownloadStatusBar
                      progress={progress}
                      phase={phase}
                      onCancel={handleCancel}
                    />
                  </motion.div>
                )}
              </AnimatePresence>

              {(progress || downloading) && (
                <button
                  onClick={handleReset}
                  disabled={downloading}
                  className="text-muted-foreground hover:text-foreground mx-auto text-sm transition-colors"
                >
                  Clear result
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Start download?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="flex flex-col gap-3 text-left">
                <p className="font-medium text-foreground line-clamp-2 leading-snug">
                  {info?.title}
                </p>
                <div className="bg-muted/60 grid grid-cols-2 gap-2 rounded-lg border p-3 text-xs">
                  <span className="text-muted-foreground">Mode</span>
                  <span className="font-medium">{confirmLabel}</span>
                  <span className="text-muted-foreground">Estimated size</span>
                  <span className="font-medium tabular-nums">
                    {estimate != null && estimate > 0
                      ? `~${formatBytes(estimate)}`
                      : "—"}
                  </span>
                  <span className="text-muted-foreground">Folder</span>
                  <span className="truncate font-medium">
                    {settings.folder ?? "Downloads (default)"}
                  </span>
                </div>
                <p className="text-xs">
                  Thumbnail and metadata options will be applied as configured.
                  Sizes are estimates from available formats.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmedDownload}>
              Download{estimate ? ` · ~${formatBytes(estimate)}` : ""}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <DependencyDialog
        open={depsOpen}
        status={deps}
        onRecheck={recheckDeps}
        onOpenChange={setDepsOpen}
      />
      <Toaster position="bottom-center" richColors />
    </main>
  );
}
