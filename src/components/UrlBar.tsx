import { ClipboardPaste, Globe, Loader2, Search } from "lucide-react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export type UrlBarMode = "link" | "search";

interface UrlBarProps {
  value: string;
  onChange: (v: string) => void;
  onFetch: (url: string) => void;
  disabled: boolean;
  loading: boolean;
  mode: UrlBarMode;
  onModeChange: (m: UrlBarMode) => void;
}

export function UrlBar({
  value,
  onChange,
  onFetch,
  disabled,
  loading,
  mode,
  onModeChange,
}: UrlBarProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFetch() {
    // Guard here too — the Enter key must obey the same rules as the button.
    if (disabled || loading || !value.trim()) return;
    onFetch(value.trim());
  }

  async function handlePaste() {
    try {
      const text = await navigator.clipboard.readText();
      if (text) onChange(text.trim());
    } catch {
      inputRef.current?.focus();
    }
  }

  return (
    <div className="flex w-full flex-col gap-2">
      <div
        role="group"
        aria-label={t("urlBar.inputMode")}
        className="border-border inline-flex w-fit items-center gap-0.5 rounded-full border p-0.5"
      >
        <Button
          size="xs"
          variant={mode === "link" ? "default" : "ghost"}
          className="rounded-full px-3"
          aria-pressed={mode === "link"}
          onClick={() => onModeChange("link")}
        >
          <Globe />
          {t("urlBar.link")}
        </Button>
        <Button
          size="xs"
          variant={mode === "search" ? "default" : "ghost"}
          className="rounded-full px-3"
          aria-pressed={mode === "search"}
          onClick={() => onModeChange("search")}
        >
          <Search />
          {t("urlBar.search")}
        </Button>
      </div>
      <div className="flex w-full gap-2 min-w-0">
        <Input
          ref={inputRef}
          id="url-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleFetch()}
          placeholder={
            mode === "search"
              ? t("urlBar.placeholderSearch")
              : t("urlBar.placeholderLink")
          }
          aria-label={mode === "search" ? t("urlBar.ariaSearch") : t("urlBar.ariaLink")}
          className="h-11 flex-1 min-w-0 text-base"
          autoFocus
          spellCheck={false}
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon-lg"
              className="shrink-0"
              onClick={handlePaste}
              aria-label={t("urlBar.paste")}
            >
              <ClipboardPaste />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t("urlBar.paste")}</TooltipContent>
        </Tooltip>
        <Button
          size="lg"
          className="px-5 shrink-0"
          onClick={handleFetch}
          disabled={disabled || loading || !value.trim()}
        >
          {loading ? (
            <>
              <Loader2 />
              <span className="hidden sm:inline">{t("urlBar.fetching")}</span>
            </>
          ) : mode === "search" ? (
            <>
              <Search />
              <span className="hidden sm:inline">{t("urlBar.search")}</span>
            </>
          ) : (
            <>
              <Globe />
              <span className="hidden sm:inline">{t("urlBar.fetch")}</span>
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
