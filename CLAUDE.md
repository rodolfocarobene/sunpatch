# sun-in-house

## Goal and scope
Build our own sun/shadow tool that also roughly simulates the interior of a house:
pick a building on an open-source map, choose a floor, sketch the floor plan and windows,
then walk inside in first person and see the direct sun patches coming through the windows
for any date/time. Direct sun only (no diffuse/indirect light).
Reference tools studied: Shadowmap (app.shadowmap.org), SunTrace3D (suntrace3d.com).

## Stack
- TypeScript + Vite, browser-only (no backend for the MVP).
- three.js: local scene, directional-light shadow maps, first-person controls.
- SunCalc: sun position (azimuth/altitude).
- MapLibre GL JS + OSM vector tiles: building picker (M2+).
- Overpass API / Overture Maps: neighbor building footprints and heights (M2+).
- Copernicus GLO-30 DEM: terrain horizon profile (M5).
- three-mesh-bvh: raycasting for sun-hours heatmap (M5).
Pin exact versions in package.json.

Scene convention: local ENU metres centred on the chosen building; x = east, y = up,
z = south (three.js right-handed, so north = -z).

## Milestones
1. M1: three.js scene with sun position from SunCalc, date/time slider, test box house + ground, shadows.
2. M2: real neighbor buildings loaded from OSM around a chosen location (map picker).
3. M3: floor picker + 2D floor-plan/window editor on the building footprint, extruded to 3D.
4. M4: first-person interior view with sun patches through windows.
5. M5: terrain horizon (DEM) + per-floor sun-hours heatmap.

## Build / test
- `npm install` then `npm run dev` (dev server), `npm run build` (type-check + build).
- `npm test` runs unit tests (vitest).

## Conventions
- Follow the global working style (smallest change, match existing style, verify before done).
- Python: virtualenv in the project, PEP 8. JS/TS: local deps only, pinned versions.
- Scratch files go in the session scratchpad, not here.

## Safety
- Secrets: never print, log, commit, upload or send API keys, tokens (e.g. Google Maps /
  Cesium ion / Mapbox keys), passwords or `.env` contents. Keep keys out of source; load
  from env vars. If one is found in a file, report it without copying it.
- Git: commit often in this repo (small, logical commits, several per feature) — the user
  asked for this. No pushes, remotes or PRs unless asked. Never force-push, rewrite pushed history,
  `git reset --hard`, `git clean -f` or `git checkout .` on uncommitted work.
- Deletion: never delete, overwrite or move files/dirs without asking first; look at the
  target before any such action.
- Off-limits: anything outside this directory (except the recap file
  `/home/rodolfo/Documents/claude_dir/recaps/sun-in-house.md`). No sudo, no system-wide
  installs, no shell/system config changes.
- Respect third-party data/tile terms of use (Google 3D Tiles, OSM ODbL attribution).
