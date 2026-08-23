import { ClipboardPaste, Loader2, Search } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface UrlBarProps {
  onFetch: (url: string) => Promise<void>;
  disabled: boolean;
}

export function UrlBar({ onFetch, disabled }: UrlBarProps) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleFetch() {
    if (!url.trim() || loading) return;
    setLoading(true);
    try {
      await onFetch(url.trim());
    } finally {
      setLoading(false);
    }
  }

  async function handlePaste() {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setUrl(text.trim());
      }
    } catch {
      // clipboard permission denied — user can paste manually
    }
  }

  return (
    <div className="flex w-full gap-2">
      <Input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && handleFetch()}
        placeholder="Paste a video URL…"
        className="h-11 flex-1 text-base"
        autoFocus
        spellCheck={false}
      />
      <Button
        variant="outline"
        size="icon"
        className="h-11 w-11 shrink-0"
        onClick={handlePaste}
        title="Paste from clipboard"
      >
        <ClipboardPaste className="size-4" />
      </Button>
      <Button
        className="h-11 shrink-0 px-5 font-semibold"
        onClick={handleFetch}
        disabled={disabled || loading || !url.trim()}
      >
        {loading ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Fetching…
          </>
        ) : (
          <>
            <Search className="size-4" />
            Fetch
          </>
        )}
      </Button>
    </div>
  );
}
