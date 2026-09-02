import { useState } from "react";
import { Eye, ThumbsUp, Clock, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  formatCount,
  formatDuration,
  formatUploadDate,
  type VideoInfo,
} from "@/lib/types";

export function VideoCard({ info }: { info: VideoInfo }) {
  const [fallback, setFallback] = useState(false);
  const isYoutube =
    info.url.includes("youtube.com") || info.url.includes("youtu.be");
  const src =
    fallback && isYoutube
      ? `https://img.youtube.com/vi/${info.id}/hqdefault.jpg`
      : info.thumbnail;
  const date = formatUploadDate(info.uploadDate);

  return (
    <div className="flex flex-col gap-4 p-4 sm:flex-row">
      {src && (
        <div className="relative aspect-video w-full shrink-0 overflow-hidden rounded-lg border bg-muted sm:w-64">
          <img
            src={src}
            alt=""
            className="size-full object-cover"
            referrerPolicy="no-referrer"
            onError={() => setFallback(true)}
          />
          <Badge className="absolute right-2 bottom-2 bg-black/80 text-white">
            {formatDuration(info.duration)}
          </Badge>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1.5">
        <h3 className="line-clamp-2 text-base font-semibold leading-snug sm:text-lg">
          {info.title}
        </h3>
        {info.entryCount ? (
          <p className="text-muted-foreground text-sm">
            Playlist · {info.entryCount} entries
          </p>
        ) : null}
        {info.uploader && (
          <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
            <UserRound className="size-3.5" />
            {info.uploader}
          </p>
        )}
        <Separator className="my-1" />
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          {info.viewCount !== undefined && info.viewCount > 0 && (
            <span className="flex items-center gap-1">
              <Eye className="size-3.5" />
              {formatCount(info.viewCount)} views
            </span>
          )}
          {info.likeCount !== undefined && info.likeCount > 0 && (
            <span className="flex items-center gap-1">
              <ThumbsUp className="size-3.5" />
              {formatCount(info.likeCount)}
            </span>
          )}
          {info.duration && (
            <span className="flex items-center gap-1">
              <Clock className="size-3.5" />
              {formatDuration(info.duration)}
            </span>
          )}
          {date && <span>{date}</span>}
        </div>
      </div>
    </div>
  );
}
