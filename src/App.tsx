import { useEffect, useMemo, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { useTranslation } from "react-i18next";
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
  Globe,
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
  if (s.mode === "audio")
    return `${s.audioFormat.toUpperCase()} · ${s.audioBitrate}kbps`;
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
  const { t, i18n } = useTranslation();
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
  const [appVersion, setAppVersion] = useState("…");
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

  const estimate = useMemo(() => {
    if (!info) return null;
    const base = estimateSize(info, settings.mode, settings.quality);
    if (base == null) return null;
    // Trim-aware: scale by the selected duration fraction. Real bitrate is
    // variable (VBR), so a 20s slice of a 60s video is only *roughly* a
    // third of the bytes — good enough for a badge, not a promise.
    if (
      trim &&
      info.duration &&
      info.duration > 0 &&
      settings.mode !== "thumbnail" &&
      !settings.playlist
    ) {
      const frac = (trim[1] - trim[0]) / info.duration;
      if (frac > 0 && frac < 1) return base * frac;
    }
    return base;
  }, [info, settings.mode, settings.quality, settings.playlist, trim]);

  const activeJob = jobs.find(
    (j) => j.status === "starting" || j.status === "downloading",
  );
  const queuedJobs = jobs.filter((j) => j.status === "queued");
  const terminalJobs = jobs.filter(
    (j) =>
      j.status === "done" || j.status === "cancelled" || j.status === "error",
  );
  const displayJob = activeJob ?? terminalJobs[terminalJobs.length - 1] ?? null;
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
    getVersion()
      .then(setAppVersion)
      .catch(() => {});
    checkDependencies()
      .then((d) => {
        setDeps(d);
        if (!d.hasYtdlp || !d.hasFfmpeg) setDepsOpen(true);
      })
      .catch(() => {});
    loadHistory()
      .then(setHistory)
      .catch((err) =>
        toast.warning(t("toast.historyLoadFailed"), {
          description: String(err).slice(0, 240),
        }),
      );

    let disposed = false;
    listenProgress((p) => {
      if (p.status === "done") {
        const job = jobsRef.current.find((j) => j.id === p.id);
        if (job) recordDownload(job, p.file);
        toast.success(t("toast.downloadComplete"), {
          description: p.file
            ? p.file.split(/[\\/]/).pop()
            : t("toast.savedToFolder"),
        });
        if (notifyOkRef.current) {
          sendNotification({
            title: t("notification.downloadComplete"),
            body:
              job?.info.title ??
              p.file?.split(/[\\/]/).pop() ??
              t("toast.savedToFolder"),
          });
        }
      } else if (p.status === "error") {
        toast.error(t("toast.downloadFailed"), { description: p.message });
        if (notifyOkRef.current) {
          sendNotification({
            title: t("notification.downloadFailed"),
            body: p.message ?? t("toast.unknownError"),
          });
        }
      } else if (p.status === "cancelled") {
        toast.info(t("toast.downloadCancelled"));
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

  function recordFetch(info: VideoInfo, settings: FormatSettings) {
    const entry: HistoryEntry = {
      videoId: info.id,
      title: info.title,
      url: info.url,
      channel: info.uploader,
      thumbnail: info.thumbnail,
      mode: settings.mode,
      qualityLabel: qualityLabel(settings),
      folder: settings.folder ?? undefined,
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
          toast.success(t("toast.depsFound"));
          setDepsOpen(false);
        } else {
          toast.info(t("toast.depsStillMissing"));
        }
      })
      .catch(() => toast.error(t("toast.depsCheckFailed")));
  }

  async function handleFetch(rawUrl: string) {
    const input = rawUrl.trim();
    if (!input) return;
    // Search mode with free text → results list. Pasted links (or manual
    // ytsearch: prefixes) always resolve directly.
    const isDirect =
      /^https?:\/\//i.test(input) || /^ytsearch(1|all)?:/i.test(input);
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
        result.duration && result.duration > 1
          ? [0, Math.floor(result.duration)]
          : null,
      );
      recordFetch(result, settingsRef.current);
      if (links.length > 1) {
        toast.info(`${links.length} links found`, {
          description:
            "Opened the first — fetch each and hit Add to queue to batch.",
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
    // Leave the video page open so the user can download again or tweak
    // settings — they can navigate away manually via the back button.
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
      downloadOptionsFrom(
        next.id,
        next.info.url,
        next.info.title,
        next.settings,
        next.trim,
      ),
    ).catch((err) => {
      const message = String(err).slice(0, 300);
      toast.error(t("toast.downloadFailedStart"), { description: message });
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
        toast.info(t("toast.alreadyFinished"));
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
          ? t("toast.cookiesCleared")
          : t("toast.cookiesReadFrom", { browser: v }),
      );
      return;
    }
    const file = await pickCookiesFile();
    if (file) {
      setSettings((s) => ({ ...s, cookiesBrowser: "file", cookiesFile: file }));
      toast.success(t("toast.cookiesSelected"), { description: file });
    } else if (settingsRef.current.cookiesBrowser !== "file") {
      toast.info(t("toast.noFilePicked"));
    }
  }

  async function verifyCookies() {
    setCookieChecking(true);
    try {
      const msg = await checkBrowserCookies(settingsRef.current.cookiesBrowser);
      toast.success(msg || t("toast.cookiesLoaded"));
    } catch (err) {
      toast.error(t("toast.cookieCheckFailed"), {
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

  const confirmLabel =
    settings.mode === "thumbnail"
      ? "THUMBNAIL · JPG"
      : settings.mode === "audio"
        ? `${settings.audioFormat.toUpperCase()} · ${settings.audioBitrate} kbps`
        : settings.mode === "both"
          ? `${settings.quality}p ${settings.container.toUpperCase()} + audio`
          : `${settings.quality}p · ${settings.container.toUpperCase()}`;

  const depsMissingText = !deps
    ? t("deps.checking")
    : !deps.hasYtdlp && !deps.hasFfmpeg
      ? t("deps.bothMissing")
      : !deps.hasYtdlp
        ? t("deps.ytdlpMissing")
        : t("deps.ffmpegMissing");

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const text = (
      e.dataTransfer.getData("text/uri-list") ||
      e.dataTransfer.getData("text/plain") ||
      ""
    )
      .split(/\r?\n/)[0]
      ?.trim();
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
                <img
                  src="/logo.svg"
                  alt="ytdl-gui logo"
                  className="size-7 shrink-0"
                  draggable={false}
                />
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
                          ? t("deps.okLabel")
                          : t("deps.missingLabel")
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
                      ? t("deps.ready")
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
                <TabsList className="bg-card/90 border-border h-auto gap-1 p-0! rounded-full border ">
                  <TabsTrigger value="download" className={PILL}>
                    <Download />
                    Download
                  </TabsTrigger>
                  <TabsTrigger value="history" className={PILL}>
                    <HistoryIcon />
                    {t("tab.history")}
                    {history.length > 0 && (
                      <span
                        className={
                          tab === "history"
                            ? "bg-primary-foreground text-primary rounded-full px-1.5 text-micro tabular-nums"
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
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Settings"
                      title="Settings (Ctrl+,)"
                    >
                      <Settings />
                    </Button>
                  </DrawerTrigger>
                  <DrawerContent className="mx-auto w-[min(70vw,56rem)]">
                    <DrawerHeader className="flex flex-row items-start justify-between text-left">
                      <div className="flex items-start flex-col gap-0.5">
                        <DrawerTitle>{t("settings.title")}</DrawerTitle>
                        <DrawerDescription>
                          {t("settings.description")}
                        </DrawerDescription>
                      </div>
                      <DrawerClose asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Close settings"
                        >
                          <X />
                        </Button>
                      </DrawerClose>
                    </DrawerHeader>
                    <ScrollArea className="min-h-0  flex-1">
                      <div
                        className="grid grid-cols-1 gap-3 px-4 pb-6 sm:grid-cols-2"
                        data-vaul-no-drag
                      >
                        <SettingsRow
                          title={t("settings.theme.title")}
                          description={t("settings.theme.description")}
                        >
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setDark((d) => !d)}
                          >
                            {dark ? (
                              <>
                                <Sun /> {t("settings.theme.light")}
                              </>
                            ) : (
                              <>
                                <Moon /> {t("settings.theme.dark")}
                              </>
                            )}
                          </Button>
                        </SettingsRow>
                        <SettingsRow
                          title={t("settings.folder.title")}
                          description={settings.folder ?? t("settings.folder.default")}
                        >
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={handlePickFolder}
                          >
                            {t("settings.folder.change")}
                          </Button>
                        </SettingsRow>
                        <SettingsRow
                          title={t("settings.cookies.title")}
                          description={
                            settings.cookiesBrowser === "file"
                              ? (settings.cookiesFile ?? t("settings.cookies.noFile"))
                              : t("settings.cookies.description")
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
                                   {cookieChecking ? t("settings.cookies.checking") : t("settings.cookies.verify")}
                                </Button>
                              )}
                            {settings.cookiesBrowser === "file" && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleCookiesModeChange("file")}
                              >
                                {t("settings.cookies.changeFile")}
                              </Button>
                            )}
                          </div>
                        </SettingsRow>
                        <SettingsRow
                          title={t("settings.background.title")}
                          description={t("settings.background.description")}
                        >
                          <Select
                            value={bgMode}
                            onValueChange={(v) =>
                              setBgMode(v as "rings" | "lite" | "off")
                            }
                          >
                            <SelectTrigger className="w-36">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="rings">{t("settings.background.rings")}</SelectItem>
                              <SelectItem value="lite">{t("settings.background.lite")}</SelectItem>
                              <SelectItem value="off">{t("settings.background.off")}</SelectItem>
                            </SelectContent>
                          </Select>
                        </SettingsRow>
                        <SettingsRow
                          title={t("settings.shiny.title")}
                          description={
                            reducedMotion
                              ? t("settings.shiny.disabled")
                              : t("settings.shiny.enabled")
                          }
                        >
                          <Switch
                            checked={activeShiny}
                            disabled={reducedMotion}
                            onCheckedChange={setShinyEnabled}
                          />
                        </SettingsRow>
                        <SettingsRow
                          title={t("settings.dependencies.title")}
                          description={depsMissingText}
                        >
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setDepsOpen(true)}
                          >
                            {deps && deps.hasYtdlp && deps.hasFfmpeg
                              ? t("deps.view")
                              : t("deps.fix")}
                          </Button>
                        </SettingsRow>
                        <SettingsRow
                          title={t("settings.history.title")}
                          description={t("settings.history.saved", { count: history.length })}
                        >
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={history.length === 0}
                            onClick={() => {
                              setSettingsOpen(false);
                              setClearHistoryOpen(true);
                            }}
                          >
                            {t("settings.history.clearAll")}
                          </Button>
                        </SettingsRow>
                      </div>
                      <div className="border-t px-4 pt-3 pb-4 text-center">
                        <p className="text-foreground text-sm font-medium">
                          ytdl-gui
                          <span className="text-muted-foreground ml-1 text-xs font-normal">
                            v{appVersion}
                          </span>
                        </p>
                        <p className="text-muted-foreground mt-1 text-xs">
                          Built with{" "}
                          <a
                            href="https://tauri.app"
                            target="_blank"
                            rel="noreferrer"
                            className="hover:text-foreground underline underline-offset-2"
                          >
                            Tauri
                          </a>
                          ,{" "}
                          <a
                            href="https://react.dev"
                            target="_blank"
                            rel="noreferrer"
                            className="hover:text-foreground underline underline-offset-2"
                          >
                            React
                          </a>
                          ,{" "}
                          <a
                            href="https://github.com/yt-dlp/yt-dlp"
                            target="_blank"
                            rel="noreferrer"
                            className="hover:text-foreground underline underline-offset-2"
                          >
                            yt-dlp
                          </a>
                          {" & "}
                          <a
                            href="https://ffmpeg.org"
                            target="_blank"
                            rel="noreferrer"
                            className="hover:text-foreground underline underline-offset-2"
                          >
                            ffmpeg
                          </a>
                        </p>
                        <p className="text-muted-foreground mt-2 text-xs">
                          Created by{" "}
                          <a
                            href="https://github.com/mohamed-younes16"
                            target="_blank"
                            rel="noreferrer"
                            className="hover:text-foreground underline underline-offset-2"
                          >
                            Mohamed Younes
                          </a>
                        </p>
                        <div className="text-muted-foreground mt-1 flex items-center justify-center gap-3 text-xs">
                          <a
                            href="https://instagram.com/younesmohamed_77"
                            target="_blank"
                            rel="noreferrer"
                            className="hover:text-foreground underline underline-offset-2"
                          >
                            Instagram
                          </a>
                          <span>·</span>
                          <a
                            href="https://github.com/mohamed-younes16/yt-dlp-gui"
                            target="_blank"
                            rel="noreferrer"
                            className="hover:text-foreground underline underline-offset-2"
                          >
                            GitHub
                          </a>
                        </div>
                      </div>
                    </ScrollArea>
                  </DrawerContent>
                </Drawer>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        const next = i18n.language === "ar" ? "en" : "ar";
                        i18n.changeLanguage(next);
                        localStorage.setItem("lang", next);
                        document.documentElement.lang = next;
                      }}
                      aria-label="Toggle language"
                    >
                      <Globe />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {i18n.language === "ar" ? "Switch to English" : "التبديل إلى العربية"}
                  </TooltipContent>
                </Tooltip>
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
                    {t("tab.download")}
                  </Button>
                  <span className="text-foreground/40">/</span>
                  <span className="text-foreground font-semibold">{t("tab.history")}</span>
                  <span className="bg-muted rounded-full px-1.5 text-micro tabular-nums">
                    {history.length}
                  </span>
                </>
              ) : fetching || searching ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  <span className="text-foreground font-semibold">
                    {searching ? t("context.searching") : t("context.fetching")}
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
                    {t("context.search")}
                  </Button>
                  <span className="text-foreground/40">/</span>
                  <span className="text-foreground line-clamp-1 font-medium">
                    “{searchQuery}”
                  </span>
                </>
              ) : !info ? (
                <span className="text-foreground font-medium">
                  {t("context.home")}
                </span>
              ) : (
                <>
                  <Button
                    variant="ghost"
                    className="h-6 gap-1.5 px-1 text-sm font-semibold text-foreground"
                    onClick={handleReset}
                  >
                    <ArrowLeft className="size-3.5" />
                    {t("context.back")}
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
                    onRemove={(i) =>
                      persistHistory(history.filter((_, idx) => idx !== i))
                    }
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
                    {searching ? t("context.searching") : t("context.fetching")}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {searching
                      ? t("context.grabbingResults")
                      : t("context.grabbingInfo")}
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
                    {t("hero.description")}
                  </p>
                  <div className="flex w-full max-w-lg flex-col gap-3">
                    {deps && depsMissing && (
                      <div
                        role="alert"
                        className="flex flex-wrap items-center gap-2 rounded-lg border border-warning/70 bg-warning/15 p-3 text-sm"
                      >
                        <AlertTriangle className="text-warning size-4 shrink-0" />
                        <span className="min-w-0 flex-1">
                          {depsMissingText}
                        </span>
                        <Button
                          variant="outline"
                          size="xs"
                          onClick={recheckDeps}
                        >
                          {t("deps.recheck")}
                        </Button>
                        <Button
                          variant="outline"
                          size="xs"
                          onClick={() => setDepsOpen(true)}
                        >
                          {t("deps.fixIt")}
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
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => setFetchError(null)}
                        >
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
                    {t("hero.hint")}
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
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() => setDepsOpen(true)}
                      >
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
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => setFetchError(null)}
                      >
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
                  <SpotlightCard className=" min-h-fit!">
                    <VideoCard info={info} />
                  </SpotlightCard>

                  {trim &&
                  info.duration &&
                  settings.mode !== "thumbnail" &&
                  !settings.playlist ? (
                    <TrimSlider
                      duration={info.duration}
                      value={trim}
                      onChange={setTrim}
                      disabled={fetching || depsMissing}
                    />
                  ) : null}

                  <FormatPicker
                    settings={settings}
                    onChange={(patch) =>
                      setSettings((s) => ({ ...s, ...patch }))
                    }
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
                    queuedJobs={queuedJobs}
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
                    ? t("download.confirmQueue")
                    : t("download.confirmTitle")}
                </AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="flex flex-col gap-3 text-left">
                    <p className="font-medium text-foreground line-clamp-2 leading-snug">
                      {info?.title}
                    </p>
                    <div className="bg-muted/60 grid grid-cols-2 gap-2 rounded-lg border p-3 text-xs">
                      <span className="text-muted-foreground">{t("download.mode")}</span>
                      <span className="font-medium">{confirmLabel}</span>
                      <span className="text-muted-foreground">
                        {t("download.estimatedSize")}
                      </span>
                      <span className="font-medium tabular-nums">
                        {estimate != null && estimate > 0
                          ? `~${formatBytes(estimate)}`
                          : settings.playlist
                            ? t("download.playlistVaries")
                            : "—"}
                      </span>
                      <span className="text-muted-foreground">{t("download.folder")}</span>
                      <span className="truncate font-medium">
                        {settings.folder ?? t("formatPicker.defaultFolder")}
                      </span>
                    </div>
                    <p className="text-muted-foreground text-xs">
                      {downloading || queuedJobs.length > 0
                        ? t("download.queueNote")
                        : t("download.sizeNote")}
                    </p>
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("download.cancel")}</AlertDialogCancel>
                <AlertDialogAction onClick={handleConfirmedDownload}>
                  {downloading || queuedJobs.length > 0 ? t("download.queueBtn") : t("download.downloadBtn")}
                  {estimate ? ` · ~${formatBytes(estimate)}` : ""}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <AlertDialog
            open={clearHistoryOpen}
            onOpenChange={setClearHistoryOpen}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("dialog.clearHistory")}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t("dialog.clearHistoryDesc", { count: history.length })}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("dialog.keep")}</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    persistHistory([]);
                    setClearHistoryOpen(false);
                  }}
                >
                  {t("settings.history.clearAll")}
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
          <Toaster
            position="bottom-center"
            richColors
            theme={dark ? "dark" : "light"}
          />
        </main>
      </MotionConfig>
    </TooltipProvider>
  );
}
