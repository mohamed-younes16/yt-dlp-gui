import { Eye, ThumbsUp, Clock, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  formatCount,
  formatDuration,
  type VideoInfo,
} from "@/lib/types";

export function VideoCard({ info }: { info: VideoInfo }) {
  return (
    <div className="flex flex-col gap-4 p-4 sm:flex-row">
        {info.thumbnail && (
          <div className="relative aspect-video w-full shrink-0 overflow-hidden rounded-lg border bg-muted sm:w-64">
            <img
              src={info.thumbnail}
              alt={info.title}
              className="size-full object-cover"
              referrerPolicy="no-referrer"
            />
            <Badge className="absolute right-2 bottom-2 bg-black/80 text-white">
              {formatDuration(info.duration)}
            </Badge>
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-1.5">
          <h3 className="line-clamp-2 font-semibold leading-snug">
            {info.title}
          </h3>
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
            {info.uploadDate && (
              <span>
                {`${info.uploadDate.slice(0, 4)}-${info.uploadDate.slice(4, 6)}-${info.uploadDate.slice(6)}`}
              </span>
            )}
          </div>
        </div>
    </div>
  );
}
