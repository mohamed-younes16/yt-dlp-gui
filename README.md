# ytdl-gui

Tauri + yt-dlp GUI. Paste a link, preview thumbnail + sizes, trim, pick format, download. Tiny, fast, no bundled Chromium.

## Requirements

- `yt-dlp` on PATH → `winget install yt-dlp.yt-dlp` / https://github.com/yt-dlp/yt-dlp/releases
- `ffmpeg` on PATH → `winget install Gyan.FFmpeg` / https://ffmpeg.org
- Rust (latest) + Bun 1.3+

App checks both on launch (top-left dot). Click it for install steps + `Recheck`.

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

1. Paste URL → `Fetch`.
2. Trim with the slider (both ends).
3. Pick `Video` / `Audio` / `Both` / `Thumbnail`, quality/container, folder.
4. `Download` → confirm size → progress bar → `Downloads` by default.

History, trimming, and thumbnail options are in the workspace. Settings (gear) → theme, background (`Magic Rings` / `Lite` / `Off` caps at 30fps, `DPR=1`), shiny text toggle.

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
