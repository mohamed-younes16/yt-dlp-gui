import { ClipboardPaste, Globe, Loader2, Search } from "lucide-react";
import { useRef } from "react";
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
        aria-label="Input mode"
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
          Link
        </Button>
        <Button
          size="xs"
          variant={mode === "search" ? "default" : "ghost"}
          className="rounded-full px-3"
          aria-pressed={mode === "search"}
          onClick={() => onModeChange("search")}
        >
          <Search />
          Search
        </Button>
      </div>
      <div className="flex w-full gap-2">
        <Input
          ref={inputRef}
          id="url-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleFetch()}
          placeholder={
            mode === "search"
              ? "Search YouTube — the top result opens…"
              : "Paste a video URL…"
          }
          aria-label={mode === "search" ? "Search query" : "Video URL"}
          className="h-11 flex-1 text-base"
          autoFocus
          spellCheck={false}
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon-lg"
              onClick={handlePaste}
              aria-label="Paste from clipboard"
            >
              <ClipboardPaste />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Paste from clipboard</TooltipContent>
        </Tooltip>
        <Button
          size="lg"
          className="px-5"
          onClick={handleFetch}
          disabled={disabled || loading || !value.trim()}
        >
          {loading ? (
            <>
              <Loader2 />
              Fetching…
            </>
          ) : mode === "search" ? (
            <>
              <Search />
              Search
            </>
          ) : (
            <>
              <Globe />
              Fetch
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
