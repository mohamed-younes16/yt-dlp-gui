import { useState } from "react";
import { ChevronRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatDuration, type VideoInfo } from "@/lib/types";

interface SearchResultsProps {
  results: VideoInfo[];
  query: string;
  onPick: (video: VideoInfo) => void;
  onClear: () => void;
}

export function SearchResults({ results, query, onPick, onClear }: SearchResultsProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex shrink-0 items-center justify-between gap-2">
        <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
          <Search className="size-3.5" />
          Results for <span className="text-foreground font-medium">“{query}”</span>
        </p>
        <Button variant="ghost" size="xs" onClick={onClear}>
          Clear
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1" viewportClassName="pr-3">
        <div className="flex flex-col gap-2">
          {results.map((video) => (
            <ResultRow key={`${video.id}-${video.url}`} video={video} onPick={onPick} />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

function ResultRow({ video, onPick }: { video: VideoInfo; onPick: (v: VideoInfo) => void }) {
  const [imgFailed, setImgFailed] = useState(false);
  const thumb =
    !imgFailed && video.thumbnail
      ? video.thumbnail
      : video.url.includes("youtube")
        ? `https://img.youtube.com/vi/${video.id}/hqdefault.jpg`
        : null;

  return (
    <Button
      variant="outline"
      className="hover:bg-accent/50 flex h-auto w-full items-center gap-3 rounded-lg p-2.5 text-left font-normal"
      onClick={() => onPick(video)}
    >
      {thumb ? (
        <img
          src={thumb}
          alt=""
          loading="lazy"
          onError={() => setImgFailed(true)}
          className="aspect-video w-28 shrink-0 rounded-md border object-cover"
          referrerPolicy="no-referrer"
        />
      ) : (
        <div className="bg-muted aspect-video w-28 shrink-0 rounded-md border" />
      )}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="line-clamp-2 text-sm font-medium leading-snug">
          {video.title}
        </span>
        <span className="text-muted-foreground flex items-center gap-2 text-xs">
          {video.duration ? <span>{formatDuration(video.duration)}</span> : null}
          {video.uploader ? (
            <span className="truncate max-w-48">{video.uploader}</span>
          ) : null}
        </span>
      </span>
      <ChevronRight className="text-muted-foreground size-4 shrink-0" />
    </Button>
  );
}
