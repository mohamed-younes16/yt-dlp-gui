# ytdl-gui — The Plan

## Vibe
A clean, fast, no-nonsense YouTube/video downloader GUI. Paste a link, see the video come alive (thumbnail, title, metadata), pick what you want, hit download, watch the progress bar fly. Beautiful shadcn/ui frontend, Rust muscle underneath. Small binary, native speed, zero bloat.

## Stack
- **Tauri 2** — desktop shell + Rust backend
- **React + Vite + TypeScript** — frontend
- **Tailwind CSS + shadcn/ui** — UI kit
- **yt-dlp + ffmpeg** — engine (already installed on system PATH)

## Core Flow
1. User pastes URL → hits **Fetch**
2. Backend runs `yt-dlp -J <url>` → returns JSON metadata
3. Frontend shows a card: HQ thumbnail (max-res), title, channel, duration, views
4. User picks mode:
   - **Video only**
   - **Audio only** (mp3/m4a)
   - **Both** (video + separate audio file)
5. Quality dropdown per mode:
   - Video: 2160p / 1440p / 1080p / 720p / 480p / 360p
   - Audio: 320kbps / 192kbps / 128kbps
6. Hit **Download** → backend spawns yt-dlp → progress events stream to frontend → live progress bar (% / speed / ETA)
7. Done toast on completion

## MVP Features
- [x] Paste URL input (+ clipboard paste button)
- [ ] Metadata fetch via `yt-dlp -J` (one call = thumbnail + all metadata)
- [ ] Mode selector: Video / Audio / Both
- [ ] Quality selector per mode
- [ ] Download with live progress via Tauri event system (`download://progress`)
- [ ] Cancel button (kills yt-dlp process)
- [ ] Download folder picker (native dialog)
- [ ] Error states (bad URL, network fail, yt-dlp missing)

## Architecture
```
ytdl-gui/
├── src/                  # React frontend
│   ├── components/
│   │   ├── UrlBar.tsx        # URL input + fetch button
│   │   ├── VideoCard.tsx     # thumbnail + metadata display
│   │   ├── FormatPicker.tsx  # mode + quality selectors
│   │   └── DownloadProgress.tsx
│   ├── App.tsx
│   └── lib/tauri.ts      # invoke() wrappers + event listeners
├── src-tauri/
│   └── src/
│       ├── main.rs
│       └── commands/
│           ├── metadata.rs   # fetch_metadata(url) -> VideoInfo
│           └── download.rs   # download(url, opts, folder), cancel_download()
└── PLAN.md
```

## Key Commands (Rust side)
- `fetch_metadata(url)` → spawn `yt-dlp -J --no-playlist <url>`, parse JSON, return typed struct
- `download(url, mode, quality, folder)` → build yt-dlp args per mode:
  - Video: `-f "bv*[height<=Q]+ba/b[height<=Q]"`
  - Audio: `-x --audio-format mp3 --audio-quality Q`
  - Both: run both variants
  - Emit `download://progress` events by parsing stdout progress lines
- `cancel_download()` → kill child process

## Nice-to-haves (post-MVP)
- Download history (persisted)
- Playlist support
- Subtitles checkbox
- Dark/light theme toggle

## v1.1 (current)
- Download history persisted to app data dir (history.json): re-download / show in folder / remove / clear all
- Video container choice: MP4 / MKV / WEBM
- Audio formats: MP3 / M4A / OPUS / WAV
- Thumbnail options: save as JPG, embed into file, embed metadata
- ReactBits polish: Aurora background, ShinyText logo, SpotlightCard hover
- Tabs layout (Download / History), dark-light toggle persisted via localStorage
