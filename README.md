# ytdl-gui

Tauri + yt-dlp GUI. Paste a link, preview thumbnail + sizes, trim, pick format, download. Tiny, fast, no bundled Chromium.

## Requirements

- `yt-dlp` on PATH — `winget install yt-dlp.yt-dlp` / https://github.com/yt-dlp/yt-dlp/releases
- `ffmpeg` on PATH — `winget install Gyan.FFmpeg` / https://ffmpeg.org
- Rust (latest) + Bun 1.3+

App checks both on launch (status pill, top-left). Missing deps show a text
banner with **Recheck / Fix it**; Recheck re-reads PATH from the registry, so
fresh winget installs are detected without restarting. A JS runtime
(`bun`/`deno`/`node`) on PATH is auto-detected and used for SABR-protected
YouTube content when present.

## Dev

```powershell
cd ytdl-gui
bun install
bun run tauri dev
```

## Build

```powershell
bun run tauri build
```

Outputs:

```
src-tauri/target/release/ytdl-gui.exe              # portable — double-click
src-tauri/target/release/bundle/nsis/*-setup.exe   # installer (Start Menu)
src-tauri/target/release/bundle/msi/*.msi
```

On Linux use WSL2 or GitHub Actions — `bun run tauri build` there gives `.deb` / `.AppImage`.

## Use

1. Paste a link (or drag one from a browser) — or flip the bar to **Search**
   and get a clickable top-15 results list, like a mini YouTube search page.
   Hit `Fetch`/`Search`.
2. Trim with the slider (both ends) when you want a slice.
3. Pick `Video` / `Audio` / `Both` / `Thumbnail`, quality/container, subtitles
   (EN, SRT), playlist mode, folder.
4. `Download` → confirm → it runs in a global status bar with %, speed, ETA
   and **Cancel that always works** (views can change mid-download).
5. Queue more while it runs: fetch the next link → `Add to queue`. Downloads
   run one at a time in order; the backend hard-caps at 3 concurrent and
   stall-kills dead yt-dlp processes.

History records the real URL + final file path — Re-download, Copy link and
Show in folder all work for any yt-dlp-supported site, not just YouTube.

## Troubleshooting private / age-restricted videos

Settings (gear, or `Ctrl+,`) → **Sign-in cookies**:

- **Firefox** — reads live cookies even while the browser runs.
- **Chrome / Edge** — Windows encrypts their cookies (app-bound, [yt-dlp #10927](https://github.com/yt-dlp/yt-dlp/issues/10927));
  third-party reads usually fail. Use the next option instead.
- **cookies.txt file** — export with any cookie extension (e.g. "Get cookies.txt
  LOCALLY") and pick the file; always works.
- **No sign-in** — default, public content only.

**Verify** checks whether cookies can actually be read before you waste a
fetch. The dialog's **Update yt-dlp** button runs `yt-dlp --update`.

## Settings

Theme (dark/light/system-first, no flash on launch), download folder, cookies
browser, background (`Magic Rings` / `Lite` / `Off`), shiny text toggle — all
persisted. Download options (mode, quality, container, audio, subtitles,
playlist) are remembered between launches too. `prefers-reduced-motion`
disables the shader, shine and all animations automatically.

Shortcuts: `Ctrl+L` focus URL bar · `Ctrl+,` settings · `Enter` fetch ·
`←/→` switch tabs.

## Release v1 (exe)

Don't commit `*.exe` — upload as a GitHub Release:

```powershell
git tag v1.0.0
git push origin v1.0.0
# then on GitHub → Releases → Draft → upload src-tauri/target/release/bundle/nsis/*-setup.exe + ytdl-gui.exe
```

Or with `gh` CLI:

```powershell
gh release create v1.0.0 src-tauri/target/release/bundle/nsis/*-setup.exe src-tauri/target/release/ytdl-gui.exe --title "v1.0.0" --notes "first build"
```
