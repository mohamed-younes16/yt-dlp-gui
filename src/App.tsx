import { useEffect, useMemo, useRef, useState } from "react";
import {
  AnimatePresence,
  MotionConfig,
  motion,
  useReducedMotion,
} from "motion/react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Download,
  History as HistoryIcon,
  Loader2,
  Moon,
  Settings,
  ShieldCheck,
  Sun,
  X,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { DownloadStatusBar } from "@/components/DownloadProgress";
import { FormatPicker } from "@/components/FormatPicker";
import { HistoryList } from "@/components/HistoryList";
import { SearchResults } from "@/components/SearchResults";
import { SettingsRow } from "@/components/SettingsRow";
import { SupportedSites } from "@/components/SupportedSites";
import { TrimSlider } from "@/components/TrimSlider";
import { UrlBar, type UrlBarMode } from "@/components/UrlBar";
import { VideoCard } from "@/components/VideoCard";
import { SpotlightCard } from "@/components/SpotlightCard";
import MagicRings from "@/components/reactbits/MagicRings";
import ShinyText from "@/components/reactbits/ShinyText";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Drawer,
  DrawerClose,
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
  checkBrowserCookies,
  checkDependencies,
  downloadOptionsFrom,
  fetchMetadata,
  listenProgress,
  loadHistory,
  pickCookiesFile,
  pickFolder,
  saveHistory,
  searchVideos,
  startDownload,
} from "@/lib/tauri";
import {
  estimateSize,
  formatBytes,
  loadSettings,
  saveSettings,
  COOKIE_BROWSERS,
  type DownloadJob,
  type FormatSettings,
  type HistoryEntry,
  type VideoInfo,
} from "@/lib/types";
import type { DependencyStatus } from "@/lib/tauri";
import { DependencyDialog } from "@/components/DependencyDialog";

function initialTheme(): boolean {
  // index.html boot script already resolved the class — read the DOM, not LS,
  // so React never disagrees with what the user just saw.
  return document.documentElement.classList.contains("dark");
}
function initialShiny(): boolean {
  return localStorage.getItem("shinyEnabled") !== "false";
}
function initialBgMode(): "rings" | "lite" | "off" {
  const v = localStorage.getItem("bgMode") as "rings" | "lite" | "off" | null;
  return v === "lite" || v === "off" ? v : "rings";
}

const PILL =
  "h-8 rounded-full px-4 text-sm font-medium data-active:bg-primary data-active:text-primary-foreground data-active:shadow data-active:font-semibold";

function qualityLabel(s: FormatSettings): string {
  if (s.mode === "thumbnail") return "THUMBNAIL · JPG";
  if (s.mode === "audio") return `${s.audioFormat.toUpperCase()} · ${s.audioBitrate}kbps`;
  if (s.mode === "both")
    return `${s.quality}p ${s.container.toUpperCase()} + ${s.audioFormat.toUpperCase()}`;
  return `${s.quality}p ${s.container.toUpperCase()}`;
}

function readRingColors(): { a: string; b: string } {
  const cs = getComputedStyle(document.documentElement);
  return {
    a: cs.getPropertyValue("--ring-a").trim() || "#a3e635",
    b: cs.getPropertyValue("--ring-b").trim() || "#fde047",
  };
}

export default function App() {
  const reducedMotion = useReducedMotion() ?? false;

  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [url, setUrl] = useState("");
  const [inputMode, setInputMode] = useState<UrlBarMode>(() =>
    localStorage.getItem("urlMode") === "search" ? "search" : "link",
  );
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<VideoInfo[] | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const [tab, setTab] = useState<"download" | "history">("download");
  const [fetching, setFetching] = useState(false);
  const [bgMode, setBgMode] = useState<"rings" | "lite" | "off">(initialBgMode);
  const [shinyEnabled, setShinyEnabled] = useState<boolean>(initialShiny);
  const [trim, setTrim] = useState<[number, number] | null>(null);
  const [deps, setDeps] = useState<DependencyStatus | null>(null);
  const [depsOpen, setDepsOpen] = useState(false);
  const [dark, setDark] = useState<boolean>(initialTheme);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [clearHistoryOpen, setClearHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [cookieChecking, setCookieChecking] = useState(false);
  const [ringColors, setRingColors] = useState(readRingColors);
  const [settings, setSettings] = useState<FormatSettings>(loadSettings);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;
  const startedRef = useRef(new Set<string>());
  const fetchSeqRef = useRef(0);
  const unlistenRef = useRef<(() => void) | null>(null);
  const notifyOkRef = useRef(false);

  const activeBg: "rings" | "lite" | "off" = reducedMotion ? "off" : bgMode;
  const activeShiny = reducedMotion ? false : shinyEnabled;

  const estimate = useMemo(
    () => (info ? estimateSize(info, settings.mode, settings.quality) : null),
    [info, settings.mode, settings.quality],
  );

  const activeJob = jobs.find(
    (j) => j.status === "starting" || j.status === "downloading",
  );
  const queuedJobs = jobs.filter((j) => j.status === "queued");
  const terminalJobs = jobs.filter(
    (j) => j.status === "done" || j.status === "cancelled" || j.status === "error",
  );
  const displayJob =
    activeJob ?? terminalJobs[terminalJobs.length - 1] ?? null;
  const downloading = !!activeJob;
  const depsMissing = !deps || !deps.hasYtdlp || !deps.hasFfmpeg;

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("theme", dark ? "dark" : "light");
    setRingColors(readRingColors());
  }, [dark]);
  useEffect(() => {
    localStorage.setItem("bgMode", bgMode);
  }, [bgMode]);
  useEffect(() => {
    localStorage.setItem("shinyEnabled", String(shinyEnabled));
  }, [shinyEnabled]);
  useEffect(() => {
    localStorage.setItem("urlMode", inputMode);
  }, [inputMode]);
  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  // Native notifications ask once at startup; toasts stay the in-app channel.
  useEffect(() => {
    (async () => {
      try {
        notifyOkRef.current =
          (await isPermissionGranted()) ||
          (await requestPermission()) === "granted";
      } catch {
        notifyOkRef.current = false;
      }
    })();
  }, []);

  // ---- startup: deps + history + the single global progress listener ----
  useEffect(() => {
    checkDependencies()
      .then((d) => {
        setDeps(d);
        if (!d.hasYtdlp || !d.hasFfmpeg) setDepsOpen(true);
      })
      .catch(() => {});
    loadHistory()
      .then(setHistory)
      .catch((err) =>
        toast.warning("History could not be loaded", {
          description: String(err).slice(0, 240),
        }),
      );

    let disposed = false;
    listenProgress((p) => {
      if (p.status === "done") {
        const job = jobsRef.current.find((j) => j.id === p.id);
        if (job) recordDownload(job, p.file);
        toast.success("Download complete", {
          description: p.file
            ? p.file.split(/[\\/]/).pop()
            : "Saved to your download folder",
        });
        if (notifyOkRef.current) {
          sendNotification({
            title: "Download complete",
            body:
              job?.info.title ??
              p.file?.split(/[\\/]/).pop() ??
              "Saved to your download folder",
          });
        }
      } else if (p.status === "error") {
        toast.error("Download failed", { description: p.message });
        if (notifyOkRef.current) {
          sendNotification({
            title: "Download failed",
            body: p.message ?? "Unknown error — see the app for details",
          });
        }
      } else if (p.status === "cancelled") {
        toast.info("Download cancelled");
      }
      setJobs((js) =>
        js.map((j) =>
          j.id === p.id
            ? {
                ...j,
                status: p.status,
                phase: p.phase ?? j.phase,
                percent: p.status === "downloading" ? p.percent : j.percent,
                speed: p.speed ?? j.speed,
                eta: p.eta ?? j.eta,
                file: p.file ?? j.file,
                message: p.message ?? j.message,
              }
            : j,
        ),
      );
    })
      .then((unlisten) => {
        if (disposed) unlisten();
        else unlistenRef.current = unlisten;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unlistenRef.current?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- keyboard shortcuts ----
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key.toLowerCase() === "l") {
        e.preventDefault();
        setTab("download");
        document.getElementById("url-input")?.focus();
      } else if (e.key === ",") {
        e.preventDefault();
        setSettingsOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function recordDownload(job: DownloadJob, file?: string) {
    const s = job.settings;
    const entry: HistoryEntry = {
      videoId: job.info.id,
      title: job.info.title,
      url: job.info.url,
      channel: job.info.uploader,
      thumbnail: job.info.thumbnail,
      mode: s.mode,
      qualityLabel: qualityLabel(s),
      folder: s.folder ?? undefined,
      path: file,
      downloadedAt: Date.now(),
    };
    setHistory((prev) => {
      const next = [
        entry,
        ...prev.filter((e) => !(e.url === entry.url && e.mode === entry.mode)),
      ].slice(0, 200);
      saveHistory(next).catch(() => {});
      return next;
    });
  }

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

  async function handleFetch(rawUrl: string) {
    const input = rawUrl.trim();
    if (!input) return;
    // Search mode with free text → results list. Pasted links (or manual
    // ytsearch: prefixes) always resolve directly.
    const isDirect = /^https?:\/\//i.test(input) || /^ytsearch(1|all)?:/i.test(input);
    if (inputMode === "search" && !isDirect) return handleSearch(input);
    const parts = input.split(/\s+/).filter(Boolean);
    const target = parts[0] ?? "";
    const links = parts.filter((t) => /^https?:\/\//i.test(t));
    const seq = ++fetchSeqRef.current;
    setFetching(true);
    setFetchError(null);
    setTab("download");
    try {
      const result = await fetchMetadata(
        target,
        settingsRef.current.playlist,
        settingsRef.current.cookiesBrowser,
        settingsRef.current.cookiesFile,
      );
      if (seq !== fetchSeqRef.current) return;
      setInfo(result);
      setTrim(
        result.duration && result.duration > 1 ? [0, Math.floor(result.duration)] : null,
      );
      if (links.length > 1) {
        toast.info(`${links.length} links found`, {
          description: "Opened the first — fetch each and hit Add to queue to batch.",
        });
      }
    } catch (err) {
      if (seq !== fetchSeqRef.current) return;
      setInfo(null);
      setTrim(null);
      setSearchResults(null);
      setFetchError(String(err).slice(0, 300));
    } finally {
      if (seq === fetchSeqRef.current) setFetching(false);
    }
  }

  async function handleSearch(query: string) {
    const seq = ++fetchSeqRef.current;
    setSearching(true);
    setFetchError(null);
    setSearchResults(null);
    setTab("download");
    try {
      const list = await searchVideos(
        query,
        settingsRef.current.cookiesBrowser,
        settingsRef.current.cookiesFile,
      );
      if (seq !== fetchSeqRef.current) return;
      if (list.length === 0) {
        setFetchError(`No results for “${query}”.`);
      } else {
        setSearchQuery(query);
        setSearchResults(list);
      }
    } catch (err) {
      if (seq !== fetchSeqRef.current) return;
      setFetchError(String(err).slice(0, 300));
    } finally {
      if (seq === fetchSeqRef.current) setSearching(false);
    }
  }

  function handlePickResult(video: VideoInfo) {
    setUrl(video.url);
    handleFetch(video.url);
  }

  function handleReset() {
    setInfo(null);
    setTrim(null);
    setFetchError(null);
    setSearchResults(null);
    setTab("download");
  }

  function handleDownloadRequest() {
    if (!info || depsMissing) return;
    setConfirmOpen(true);
  }

  function handleConfirmedDownload() {
    if (!info) return;
    setConfirmOpen(false);
    const isTrimmed =
      trim &&
      info.duration &&
      (trim[0] > 0 || trim[1] < Math.floor(info.duration));
    const id = crypto.randomUUID();
    const job: DownloadJob = {
      id,
      info,
      settings: { ...settingsRef.current },
      trim: isTrimmed && trim ? [trim[0], trim[1]] : null,
      status: "queued",
      phase: settingsRef.current.mode === "audio" ? "audio" : "video",
      percent: 0,
    };
    setJobs((js) => [...js, job]);
    // Clear the workspace so the user can immediately fetch the next link.
    setInfo(null);
    setUrl("");
    setTrim(null);
    setFetchError(null);
    setSearchResults(null);
  }

  // Start the next queued job whenever nothing is running (frontend serializes
  // the queue; the backend also caps concurrency).
  useEffect(() => {
    if (jobs.some((j) => j.status === "starting" || j.status === "downloading"))
      return;
    const next = jobs.find((j) => j.status === "queued");
    if (!next || startedRef.current.has(next.id)) return;
    startedRef.current.add(next.id);
    setJobs((js) =>
      js.map((j) => (j.id === next.id ? { ...j, status: "starting" } : j)),
    );
    startDownload(
      downloadOptionsFrom(next.id, next.info.url, next.settings, next.trim),
    ).catch((err) => {
      const message = String(err).slice(0, 300);
      toast.error("Download failed to start", { description: message });
      setJobs((js) =>
        js.map((j) =>
          j.id === next.id ? { ...j, status: "error", message } : j,
        ),
      );
    });
  }, [jobs]);

  async function handleCancel(id: string) {
    try {
      const found = await cancelDownload(id);
      if (!found) {
        toast.info("That download already finished");
        setJobs((js) => js.filter((j) => j.id !== id));
      }
    } catch (err) {
      toast.error(String(err).slice(0, 200));
    }
  }

  async function handleCookiesModeChange(v: string) {
    if (v !== "file") {
      setSettings((s) => ({ ...s, cookiesBrowser: v }));
      toast.success(
        v === "none"
          ? "Sign-in cookies cleared"
          : `Cookies will be read from ${v}`,
      );
      return;
    }
    const file = await pickCookiesFile();
    if (file) {
      setSettings((s) => ({ ...s, cookiesBrowser: "file", cookiesFile: file }));
      toast.success("cookies.txt selected", { description: file });
    } else if (settingsRef.current.cookiesBrowser !== "file") {
      toast.info("No file picked — sign-in unchanged");
    }
  }

  async function verifyCookies() {
    setCookieChecking(true);
    try {
      const msg = await checkBrowserCookies(settingsRef.current.cookiesBrowser);
      toast.success(msg || "Cookies loaded");
    } catch (err) {
      toast.error("Cookie check failed", {
        description: String(err).slice(0, 500),
      });
    } finally {
      setCookieChecking(false);
    }
  }

  async function handlePickFolder() {
    const dir = await pickFolder();
    if (dir) setSettings((s) => ({ ...s, folder: dir }));
  }

  function handleRedownload(entry: HistoryEntry) {
    setUrl(entry.url);
    handleFetch(entry.url);
  }

  const confirmLabel = settings.mode === "thumbnail"
    ? "THUMBNAIL · JPG"
    : settings.mode === "audio"
      ? `${settings.audioFormat.toUpperCase()} · ${settings.audioBitrate} kbps`
      : settings.mode === "both"
        ? `${settings.quality}p ${settings.container.toUpperCase()} + audio`
        : `${settings.quality}p · ${settings.container.toUpperCase()}`;

  const depsMissingText = !deps
    ? "Checking yt-dlp and ffmpeg…"
    : !deps.hasYtdlp && !deps.hasFfmpeg
      ? "yt-dlp and ffmpeg are not installed — downloads are disabled."
      : !deps.hasYtdlp
        ? "yt-dlp is not installed — downloads are disabled."
        : "ffmpeg is not installed — merging and audio extraction won't work.";

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const text = (
      e.dataTransfer.getData("text/uri-list") ||
      e.dataTransfer.getData("text/plain") ||
      ""
    ).split(/\r?\n/)[0]?.trim();
    if (/^https?:\/\//i.test(text)) {
      setUrl(text);
      setTab("download");
      document.getElementById("url-input")?.focus();
    }
  }

  return (
    <TooltipProvider delayDuration={300}>
      <MotionConfig
        reducedMotion="user"
        transition={{ duration: 0.25, ease: [0.2, 0, 0, 1] }}
      >
        <main
          className="bg-background text-foreground relative flex min-h-dvh items-center"
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
        >
          {/* Background — rings (GPU) or lite (CSS) */}
          {activeBg === "rings" ? (
            <div aria-hidden className="pointer-events-none absolute inset-0">
              <MagicRings
                color={ringColors.a}
                colorTwo={ringColors.b}
                ringCount={7}
                speed={0.6}
                attenuation={11.5}
                lineThickness={3.8}
                baseRadius={0.15}
                radiusStep={0.1}
                scaleRate={0.2}
                opacity={0.9}
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
          ) : activeBg === "lite" ? (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 opacity-60"
              style={{
                background:
                  "radial-gradient(ellipse 80% 60% at 50% 0%, color-mix(in oklab, var(--primary) 18%, transparent), transparent 70%), radial-gradient(ellipse 60% 50% at 95% 20%, color-mix(in oklab, var(--ring-b) 12%, transparent), transparent 65%)",
              }}
            />
          ) : null}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-background/70 dark:bg-black/55"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-20 dark:opacity-10"
            style={{
              backgroundImage:
                "radial-gradient(circle at 1px 1px, var(--foreground) 0.85px, transparent 0)",
              backgroundSize: "22px 22px",
            }}
          />

          <div className="relative mx-auto flex h-[90vh] w-full max-w-5xl flex-col rounded-xl bg-background/85 px-4 py-5 shadow-sm">
            {/* Top nav */}
            <header className="flex shrink-0 items-center justify-between gap-2 pb-4">
              <div className="flex min-w-0 items-center gap-2.5">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      className={
                        deps && deps.hasYtdlp && deps.hasFfmpeg
                          ? "rounded-full border-2 border-success/60 bg-success/15 text-success"
                          : "animate-pulse rounded-full border-2 border-warning/70 bg-warning/15 text-warning"
                      }
                      onClick={() => setDepsOpen(true)}
                      aria-label={
                        deps && deps.hasYtdlp && deps.hasFfmpeg
                          ? "Dependencies OK — open details"
                          : "Missing dependencies — open fix dialog"
                      }
                    >
                      {deps && deps.hasYtdlp && deps.hasFfmpeg ? (
                        <CheckCircle2 />
                      ) : (
                        <AlertTriangle />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {deps && deps.hasYtdlp && deps.hasFfmpeg
                      ? "yt-dlp + ffmpeg ready"
                      : depsMissingText}
                  </TooltipContent>
                </Tooltip>
                <Button
                  variant="ghost"
                  className="h-auto shrink-0 px-1"
                  onClick={handleReset}
                  aria-label="Back to home"
                  title="Back to home"
                >
                  {activeShiny ? (
                    <ShinyText
                      text="ytdl-gui"
                      speed={3}
                      className="text-lg font-bold tracking-tight sm:text-xl"
                      color="var(--foreground)"
                      shineColor="var(--shine)"
                    />
                  ) : (
                    <span className="text-foreground text-lg font-bold tracking-tight sm:text-xl">
                      ytdl-gui
                    </span>
                  )}
                </Button>
              </div>

              <Tabs
                value={tab}
                onValueChange={(v) => setTab(v as "download" | "history")}
                className="contents"
              >
                <TabsList className="bg-card/90 border-border h-auto gap-1 rounded-full border p-1">
                  <TabsTrigger value="download" className={PILL}>
                    <Download />
                    Download
                  </TabsTrigger>
                  <TabsTrigger value="history" className={PILL}>
                    <HistoryIcon />
                    History
                    {history.length > 0 && (
                      <span
                        className={
                          tab === "history"
                            ? "bg-primary-foreground/25 text-primary-foreground rounded-full px-1.5 text-micro tabular-nums"
                            : "bg-accent text-foreground rounded-full px-1.5 text-micro tabular-nums"
                        }
                      >
                        {history.length}
                      </span>
                    )}
                  </TabsTrigger>
                </TabsList>
              </Tabs>

              <div className="flex shrink-0 items-center gap-1">
                <Drawer open={settingsOpen} onOpenChange={setSettingsOpen}>
                  <DrawerTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label="Settings" title="Settings (Ctrl+,)">
                      <Settings />
                    </Button>
                  </DrawerTrigger>
                  <DrawerContent className="mx-auto max-w-xl">
                    <DrawerHeader className="flex flex-row items-start justify-between text-left">
                      <div className="flex flex-col gap-0.5">
                        <DrawerTitle>Settings</DrawerTitle>
                        <DrawerDescription>
                          App preferences — stored locally.
                        </DrawerDescription>
                      </div>
                      <DrawerClose asChild>
                        <Button variant="ghost" size="icon-sm" aria-label="Close settings">
                          <X />
                        </Button>
                      </DrawerClose>
                    </DrawerHeader>
                    <ScrollArea className="min-h-0 flex-1">
                      <div className="flex flex-col gap-3 px-4 pb-6" data-vaul-no-drag>
                        <SettingsRow title="Theme" description="Toggle dark / light">
                          <Button variant="outline" size="sm" onClick={() => setDark((d) => !d)}>
                            {dark ? (
                              <>
                                <Sun /> Light
                              </>
                            ) : (
                              <>
                                <Moon /> Dark
                              </>
                            )}
                          </Button>
                        </SettingsRow>
                        <SettingsRow
                          title="Download folder"
                          description={settings.folder ?? "Downloads (default)"}
                        >
                          <Button variant="outline" size="sm" onClick={handlePickFolder}>
                            Change
                          </Button>
                        </SettingsRow>
                        <SettingsRow
                          title="Sign-in cookies"
                          description={
                            settings.cookiesBrowser === "file"
                              ? settings.cookiesFile ?? "No file picked yet"
                              : "Use a browser's cookies for private / age-restricted videos"
                          }
                        >
                          <div className="flex items-center gap-2">
                            <Select
                              value={settings.cookiesBrowser}
                              onValueChange={handleCookiesModeChange}
                            >
                              <SelectTrigger className="w-40">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent position="popper">
                                {COOKIE_BROWSERS.map((b) => (
                                  <SelectItem key={b.value} value={b.value}>
                                    {b.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {settings.cookiesBrowser !== "none" &&
                              settings.cookiesBrowser !== "file" && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={verifyCookies}
                                  disabled={cookieChecking}
                                >
                                  {cookieChecking ? (
                                    <Loader2 className="animate-spin" />
                                  ) : (
                                    <ShieldCheck />
                                  )}
                                  {cookieChecking ? "Checking…" : "Verify"}
                                </Button>
                              )}
                            {settings.cookiesBrowser === "file" && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleCookiesModeChange("file")}
                              >
                                Change file
                              </Button>
                            )}
                          </div>
                        </SettingsRow>
                        <SettingsRow
                          title="Background"
                          description="Rings = shader (GPU) · Lite = static CSS"
                        >
                          <Select
                            value={bgMode}
                            onValueChange={(v) => setBgMode(v as "rings" | "lite" | "off")}
                          >
                            <SelectTrigger className="w-36">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="rings">Magic Rings</SelectItem>
                              <SelectItem value="lite">Lite</SelectItem>
                              <SelectItem value="off">Off</SelectItem>
                            </SelectContent>
                          </Select>
                        </SettingsRow>
                        <SettingsRow
                          title="Shiny text"
                          description={
                            reducedMotion
                              ? "Disabled — your system requests reduced motion"
                              : "Animated logo (per-frame)"
                          }
                        >
                          <Switch
                            checked={activeShiny}
                            disabled={reducedMotion}
                            onCheckedChange={setShinyEnabled}
                          />
                        </SettingsRow>
                        <SettingsRow
                          title="Dependencies"
                          description={depsMissingText}
                        >
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setDepsOpen(true)}
                          >
                            {deps && deps.hasYtdlp && deps.hasFfmpeg ? "View" : "Fix"}
                          </Button>
                        </SettingsRow>
                        <SettingsRow title="History" description={`${history.length} saved`}>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={history.length === 0}
                            onClick={() => {
                              setSettingsOpen(false);
                              setClearHistoryOpen(true);
                            }}
                          >
                            Clear all
                          </Button>
                        </SettingsRow>
                      </div>
                    </ScrollArea>
                  </DrawerContent>
                </Drawer>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setDark((d) => !d)}
                      aria-label="Toggle theme"
                    >
                      {dark ? <Sun /> : <Moon />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {dark ? "Switch to light" : "Switch to dark"}
                  </TooltipContent>
                </Tooltip>
              </div>
            </header>
            <Separator className="shrink-0" />

            {/* Context bar */}
            <div className="my-4 flex h-6 shrink-0 items-center gap-1.5 text-sm font-medium text-muted-foreground">
              {tab === "history" ? (
                <>
                  <Button
                    variant="ghost"
                    className="h-6 gap-1.5 px-1 text-sm font-semibold text-foreground"
                    onClick={() => setTab("download")}
                  >
                    <ArrowLeft className="size-3.5" />
                    Download
                  </Button>
                  <span className="text-foreground/40">/</span>
                  <span className="text-foreground font-semibold">History</span>
                  <span className="bg-muted rounded-full px-1.5 text-micro tabular-nums">
                    {history.length}
                  </span>
                </>
          ) : fetching || searching ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              <span className="text-foreground font-semibold">
                {searching ? "Searching YouTube…" : "Fetching video…"}
              </span>
            </>
          ) : !info && searchResults ? (
            <>
              <Button
                variant="ghost"
                className="h-6 gap-1.5 px-1 text-sm font-semibold text-foreground"
                onClick={() => setSearchResults(null)}
              >
                <ArrowLeft className="size-3.5" />
                Search
              </Button>
              <span className="text-foreground/40">/</span>
              <span className="text-foreground line-clamp-1 font-medium">
                “{searchQuery}”
              </span>
            </>
          ) : !info ? (
                <span className="text-foreground font-medium">
                  Home — paste a link to start
                </span>
              ) : (
                <>
                  <Button
                    variant="ghost"
                    className="h-6 gap-1.5 px-1 text-sm font-semibold text-foreground"
                    onClick={handleReset}
                  >
                    <ArrowLeft className="size-3.5" />
                    Back
                  </Button>
                  <span className="text-foreground/40">/</span>
                  <span className="text-foreground line-clamp-1 font-medium">
                    {info.title}
                  </span>
                </>
              )}
            </div>
            <Separator className="shrink-0" />

            <AnimatePresence mode="wait">
              {tab === "history" ? (
                <motion.div
                  key="history"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="flex min-h-0 flex-1 flex-col pt-2"
                >
                  <HistoryList
                    entries={history}
                    onRedownload={handleRedownload}
                    onRemove={(i) => persistHistory(history.filter((_, idx) => idx !== i))}
                    onClearAll={() => setClearHistoryOpen(true)}
                  />
                </motion.div>
              ) : fetching || searching ? (
                <motion.div
                  key="fetching"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4"
                >
                  <Loader2 className="text-primary size-8 animate-spin" />
                  <p className="text-foreground text-sm font-semibold">
                    {searching ? "Searching YouTube…" : "Fetching video info…"}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {searching
                      ? "grabbing top results"
                      : "grabbing thumbnail & file sizes"}
                  </p>
                </motion.div>
              ) : !info && searchResults ? (
                <motion.div
                  key="results"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="flex min-h-0 flex-1 flex-col pt-2"
                >
                  <SearchResults
                    results={searchResults}
                    query={searchQuery}
                    onPick={handlePickResult}
                    onClear={() => setSearchResults(null)}
                  />
                </motion.div>
              ) : !info ? (
                <motion.div
                  key="hero"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 overflow-y-auto"
                >
                  {activeShiny ? (
                    <ShinyText
                      text="ytdl-gui"
                      speed={3}
                      className="text-center text-5xl font-bold tracking-tight sm:text-6xl"
                      color="var(--foreground)"
                      shineColor="var(--shine)"
                    />
                  ) : (
                    <span className="text-foreground text-center text-5xl font-bold tracking-tight sm:text-6xl">
                      ytdl-gui
                    </span>
                  )}
                  <p className="text-muted-foreground max-w-sm text-center text-sm">
                    Paste a link or switch to Search — preview the thumbnail
                    and sizes, then pick exactly what you want.
                  </p>
                  <div className="flex w-full max-w-lg flex-col gap-3">
                    {deps && depsMissing && (
                      <div
                        role="alert"
                        className="flex flex-wrap items-center gap-2 rounded-lg border border-warning/70 bg-warning/15 p-3 text-sm"
                      >
                        <AlertTriangle className="text-warning size-4 shrink-0" />
                        <span className="min-w-0 flex-1">{depsMissingText}</span>
                        <Button variant="outline" size="xs" onClick={recheckDeps}>
                          Recheck
                        </Button>
                        <Button variant="outline" size="xs" onClick={() => setDepsOpen(true)}>
                          Fix it
                        </Button>
                      </div>
                    )}
                    {fetchError && (
                      <div
                        role="alert"
                        className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/60 bg-destructive/10 p-3 text-sm"
                      >
                        <XCircle className="text-destructive size-4 shrink-0" />
                        <span className="min-w-0 flex-1">{fetchError}</span>
                        <Button
                          variant="outline"
                          size="xs"
                          onClick={() => handleFetch(url)}
                          disabled={fetching || depsMissing}
                        >
                          Retry
                        </Button>
                        <Button variant="ghost" size="xs" onClick={() => setFetchError(null)}>
                          Dismiss
                        </Button>
                      </div>
                    )}
                    <UrlBar
                      value={url}
                      onChange={setUrl}
                      onFetch={handleFetch}
                      disabled={fetching || searching || depsMissing}
                      loading={fetching || searching}
                      mode={inputMode}
                      onModeChange={setInputMode}
                    />
                  </div>
                  <SupportedSites />
                  <p className="text-muted-foreground text-micro">
                    Enter fetches · Ctrl+L focuses this box anytime · drop a
                    link anywhere in the window
                  </p>
                </motion.div>
              ) : (
                <motion.div
                  key="workspace"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto"
                >
                  {deps && depsMissing && (
                    <div
                      role="alert"
                      className="flex flex-wrap items-center gap-2 rounded-lg border border-warning/70 bg-warning/15 p-3 text-sm"
                    >
                      <AlertTriangle className="text-warning size-4 shrink-0" />
                      <span className="min-w-0 flex-1">{depsMissingText}</span>
                      <Button variant="outline" size="xs" onClick={recheckDeps}>
                        Recheck
                      </Button>
                      <Button variant="outline" size="xs" onClick={() => setDepsOpen(true)}>
                        Fix it
                      </Button>
                    </div>
                  )}
                  {fetchError && (
                    <div
                      role="alert"
                      className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/60 bg-destructive/10 p-3 text-sm"
                    >
                      <XCircle className="text-destructive size-4 shrink-0" />
                      <span className="min-w-0 flex-1">{fetchError}</span>
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() => handleFetch(url)}
                        disabled={fetching || depsMissing}
                      >
                        Retry
                      </Button>
                      <Button variant="ghost" size="xs" onClick={() => setFetchError(null)}>
                        Dismiss
                      </Button>
                    </div>
                  )}
                  <UrlBar
                    value={url}
                    onChange={setUrl}
                    onFetch={handleFetch}
                    disabled={fetching || searching || depsMissing}
                    loading={fetching || searching}
                    mode={inputMode}
                    onModeChange={setInputMode}
                  />
                  <SpotlightCard>
                    <VideoCard info={info} />
                  </SpotlightCard>

                  {trim && info.duration && settings.mode !== "thumbnail" && !settings.playlist ? (
                    <TrimSlider
                      duration={info.duration}
                      value={trim}
                      onChange={setTrim}
                      disabled={fetching || depsMissing}
                    />
                  ) : null}

                  <FormatPicker
                    settings={settings}
                    onChange={(patch) => setSettings((s) => ({ ...s, ...patch }))}
                    busy={depsMissing}
                    queued={downloading || queuedJobs.length > 0}
                    onPickFolder={handlePickFolder}
                    onDownload={handleDownloadRequest}
                    estimate={estimate}
                  />
                </motion.div>
              )}
            </AnimatePresence>

            {/* Global download bar — survives view switches, always cancellable */}
            <AnimatePresence>
              {displayJob && (
                <motion.div
                  key="bar"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="shrink-0 pt-3"
                >
                  <DownloadStatusBar
                    job={displayJob}
                    queueCount={queuedJobs.length}
                    onCancel={handleCancel}
                    onDismiss={(id) =>
                      setJobs((js) => js.filter((j) => j.id !== id))
                    }
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {downloading || queuedJobs.length > 0
                    ? "Add to queue?"
                    : "Start download?"}
                </AlertDialogTitle>
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
                          : settings.playlist
                            ? "playlist — varies"
                            : "—"}
                      </span>
                      <span className="text-muted-foreground">Folder</span>
                      <span className="truncate font-medium">
                        {settings.folder ?? "Downloads (default)"}
                      </span>
                    </div>
                    <p className="text-muted-foreground text-xs">
                      {downloading || queuedJobs.length > 0
                        ? "Something is already running — this will start when the queue is free."
                        : "Sizes are estimates from available formats."}
                    </p>
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleConfirmedDownload}>
                  {downloading || queuedJobs.length > 0 ? "Queue" : "Download"}
                  {estimate ? ` · ~${formatBytes(estimate)}` : ""}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <AlertDialog open={clearHistoryOpen} onOpenChange={setClearHistoryOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Clear all history?</AlertDialogTitle>
                <AlertDialogDescription>
                  Removes all {history.length} entries. Downloaded files are
                  not deleted.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    persistHistory([]);
                    setClearHistoryOpen(false);
                  }}
                >
                  Clear all
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
          <Toaster position="bottom-center" richColors theme={dark ? "dark" : "light"} />
        </main>
      </MotionConfig>
    </TooltipProvider>
  );
}
