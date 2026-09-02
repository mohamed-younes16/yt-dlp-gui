import facebook from "@/assets/brands/facebook.svg";
import instagram from "@/assets/brands/instagram.svg";
import reddit from "@/assets/brands/reddit.svg";
import soundcloud from "@/assets/brands/soundcloud.svg";
import tiktok from "@/assets/brands/tiktok.svg";
import twitch from "@/assets/brands/twitch.svg";
import vimeo from "@/assets/brands/vimeo.svg";
import x from "@/assets/brands/x.svg";
import youtube from "@/assets/brands/youtube.svg";

const SITES = [
  { name: "YouTube", logo: youtube },
  { name: "Instagram", logo: instagram },
  { name: "TikTok", logo: tiktok },
  { name: "X", logo: x },
  { name: "Facebook", logo: facebook },
  { name: "Reddit", logo: reddit },
  { name: "Twitch", logo: twitch },
  { name: "Vimeo", logo: vimeo },
  { name: "SoundCloud", logo: soundcloud },
];

export function SupportedSites() {
  return (
    <div className="flex flex-col items-center gap-2.5">
      <p className="text-muted-foreground text-micro uppercase tracking-widest">
        Works with
      </p>
      <div className="flex max-w-xl flex-wrap items-center justify-center gap-2">
        {SITES.map((site) => (
          <span
            key={site.name}
            className="border-border bg-card/85 text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 rounded-full border py-1 pl-1 pr-2.5 text-xs transition-colors"
          >
            <img
              src={site.logo}
              alt=""
              aria-hidden
              loading="lazy"
              className="bg-white size-5 shrink-0 rounded-full object-contain p-0.5"
            />
            {site.name}
          </span>
        ))}
        <span className="text-muted-foreground px-1 text-xs">
          + every other yt-dlp site
        </span>
      </div>
    </div>
  );
}
