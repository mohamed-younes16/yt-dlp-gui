import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowUpRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";

const REPO = "mohamed-younes16/yt-dlp-gui";
const CHECK_KEY = "updateCheck";
const CHECK_TTL_MS = 24 * 60 * 60 * 1000; // 24h

type State =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "upToDate" }
  | { status: "update"; tag: string; url: string; dismissed?: boolean }
  | { status: "error" };

function cmpSemver(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da - db;
  }
  return 0;
}

export function UpdateBanner() {
  const { t } = useTranslation();
  const [state, setState] = useState<State>({ status: "idle" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = localStorage.getItem(CHECK_KEY);
        if (raw) {
          try {
            const cached = JSON.parse(raw) as {
              at: number;
              tag: string;
              dismissed?: boolean;
            };
            const localVer = await getVersion().catch(() => null);
            // If we've already dismissed this tag and it's still the latest, stay quiet.
            if (cached.dismissed && localVer && cmpSemver(cached.tag, `v${localVer}`) <= 0) {
              // Respect dismissal until a newer tag appears — still allow fresh check after TTL.
              if (Date.now() - cached.at < CHECK_TTL_MS) return;
            } else if (Date.now() - cached.at < CHECK_TTL_MS) {
              // Use cached result within TTL without hitting the API.
              if (localVer && /^v\d+\.\d+\.\d+/.test(cached.tag) && cmpSemver(cached.tag, `v${localVer}`) > 0 && !cached.dismissed) {
                if (!cancelled) {
                  setState({
                    status: "update",
                    tag: cached.tag,
                    url: `https://github.com/${REPO}/releases/tag/${cached.tag}`,
                  });
                }
              }
              return;
            }
          } catch {
            // corrupt cache → refetch
          }
        }

        if (cancelled) return;
        setState({ status: "checking" });
        const localVer = await getVersion().catch(() => "0.0.0");
        const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
          headers: { Accept: "application/vnd.github+json" },
        });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { tag_name?: string; html_url?: string };
        const tag: string | undefined = data.tag_name;
        if (!tag || !/^v\d+\.\d+\.\d+/.test(tag)) throw new Error("invalid tag");
        if (cancelled) return;
        // Persist for TTL / dismissal memory.
        localStorage.setItem(CHECK_KEY, JSON.stringify({ at: Date.now(), tag }));
        if (cmpSemver(tag, `v${localVer}`) > 0) {
          const safeUrl = /^https:\/\/github\.com\//.test(data.html_url ?? "") ? data.html_url! : `https://github.com/${REPO}/releases/tag/${tag}`;
          setState({
            status: "update",
            tag,
            url: safeUrl,
          });
        } else {
          setState({ status: "upToDate" });
        }
      } catch {
        if (!cancelled) setState({ status: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status !== "update" || state.dismissed) return null;

  return (
    <div
      role="status"
      className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-sm"
    >
      <span className="min-w-0 flex-1">
        {t("updateBanner.available", { tag: state.tag })}{" "}
        <button
          type="button"
          className="inline-flex items-center gap-1 font-medium text-primary underline underline-offset-2 hover:text-primary/80"
          onClick={() => openUrl(state.url)}
        >
          {t("updateBanner.viewRelease")} <ArrowUpRight className="size-3" />
        </button>
      </span>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={t("updateBanner.dismiss")}
        onClick={() => {
          try {
            const raw = localStorage.getItem(CHECK_KEY);
            if (raw) {
              const cached = JSON.parse(raw) as { at: number; tag: string };
              localStorage.setItem(
                CHECK_KEY,
                JSON.stringify({ ...cached, dismissed: true }),
              );
            }
          } catch {
            // ignore
          }
          setState((s) => (s.status === "update" ? { ...s, dismissed: true } : s));
        }}
      >
        <X />
      </Button>
    </div>
  );
}
