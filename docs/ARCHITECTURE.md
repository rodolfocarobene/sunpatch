# Architecture

Sunpatch is a static site with no backend: a landing page at `/` (`index.html`) and the app at `/app/`
(`app/index.html` loads `src/main.ts`), both built by Vite (`vite.config.ts`, multi-page). The app is a single-page app: Vite + TypeScript, three.js for the 3D scene, MapLibre GL JS
for the map, plain DOM/SVG for the UI. Modules are small; geometry and parsing live in pure functions with Vitest
tests next to them (`*.test.ts`).

## Coordinate frame

Everything in the 3D scene and the plan is in **local metres around the selected building** (its footprint
centroid is the origin):

- x = east, y = up, z = south, so north is −z.
- `project(lat, lon, origin)` / `unproject(point, origin)` in `src/osm.ts` convert to and from latitude and
  longitude (equirectangular, accurate to centimetres within a few hundred metres).
- Rings never repeat their first point at the end.
- Yaw (walk view, plan viewpoint) is radians counter-clockwise from north, matching three.js `rotation.y`;
  `yawOf(dx, dz)` in `src/walk-geom.ts` converts a direction.

## Data flow

```
map click ──► tiles.ts (instant preview from vector tiles) ──► scene.setBuildings
          └─► overpass.ts (mirrors, timeout, cache) ──► osm.ts parseOverpass ──► scene.setBuildings (keepCamera)
Plan view ──► editor.ts (SVG) ──► Plan (plan.ts, autosaved) ──► scene.setPlan ──► apartment.ts + edits.ts
time/date ──► ui.ts ──► sun.ts sunDirection ──► scene.update
Sun map switch / date / scene change ──► main.ts ──► sunmap-job.ts ──► Web Worker (sunmap.worker.ts, BVH rays)
                                                  └──► scene.setSunMap (floor overlay) + popover on click
```

`src/main.ts` owns the app state (current view, picked site, current plan) and wires the modules together.

## Modules

| File | Role |
|---|---|
| `main.ts` | App state and wiring: views (Map / Plan / 3D), picking, OSM refinement, plan loading. |
| `ui.ts`, `chip.ts`, `style.css` | Left panel (views, building info, location, date/time, play), status chip. |
| `example.ts` | The `?example=milan` sample: lazy-loads the Milan fixture and builds the apartment plan from the building outline. |
| `map.ts`, `geocode.ts` | MapLibre map, Nominatim search (house-number ranking: a bare street is labelled and drawn as a line, never snapped to a building), found-building highlight, tile buildings accessor. |
| `tiles.ts` | Vector-tile features → `Building` for the instant preview; joins pieces cut at tile borders. |
| `overpass.ts` | Overpass query with mirror fallback, per-endpoint timeout, in-memory cache. |
| `block.ts` | The selection model: flood fill over touching, overlapping and related polygons into the selected `Building` with `members` and `sources`; shift-click trimming; restoring a saved selection. |
| `osm.ts` | Projection, Overpass parsing (ways, multipolygon relations, ring stitching), heights, picking helpers. |
| `trees.ts` | Trees: green areas and mapped trees from Overpass, seeded Poisson-ish scatter (clear of buildings, capped at 1500 within 300 m), two `InstancedMesh`es that cast shadows. |
| `footprint.ts` | Extrudes footprints into three.js geometry. |
| `sun.ts` | Sun direction vector from SunCalc, compass names. |
| `plan.ts` | The `Plan` data model (outline, walls, windows, viewpoint, building edits) and helpers. |
| `editor.ts`, `editor-draw.ts`, `editor-geom.ts`, `editor.css` | 2D plan editor: tools, snapping, undo, import/export, autosave, validation. |
| `panel.ts`, `panel-mesh.ts` | Solar panels: geometry (corners from tilt and azimuth, plan footprint, rotate handle), snapping to facade edges, presets; the 3D slabs. |
| `apartment.ts` | Plan → geometry: blocks below/above, rest of the storey, facade walls with window openings, interior walls, glass. |
| `edits.ts` | Building fixes: carving cuts per height range and adding prisms (`polygon-clipping`). |
| `scene.ts` | three.js scene: buildings, lights, shadows, cutaway, sun disc, sky, two-pass apartment rendering, walk mode. |
| `walk.ts`, `walk-geom.ts` | First-person controls and HUD; collision, start position and look direction. |
| `sunmap.ts` | Sun map, pure part: floor sampling grid, time slots, lit intervals, share of daylight, colour ramp, overlay texels. |
| `sunmap-trace.ts`, `sunmap.worker.ts`, `sunmap-job.ts` | Sun map rays: occluder collection and BVH tracing (three-mesh-bvh), the worker that runs them, and the job that debounces, caches and reports progress. |
| `sunmap-popover.ts` | The popover on a clicked floor point: the sentence and the day strip with the sunny intervals. |

## The selection model

One real building is often several OSM polygons (an outline plus `building:part`s with their own heights, the
outer rings of a multipolygon, a footprint mapped twice, or neighbouring volumes of different height that merely
touch). `selectBuilding` in `src/block.ts` turns the clicked polygon into one selected `Building`:

- `outer`/`holes` are the union of the footprints (the plan editor snaps to it and "Whole floor" uses it);
  `height`/`minHeight`/`levels` summarise the pieces (tallest piece, lowest start).
- `members` are the pieces that are drawn, each with its own footprint and heights; `sources` lists every polygon
  merged in, including an outline that is only the footprint of its parts (not drawn). `anchor` is the clicked
  polygon.
- The selection is a flood fill from the clicked polygon over a graph. Edges: same relation; same `addr:street` +
  `addr:housenumber`; a part lying in an outline; overlapping outlines; touching (a shared wall of 1 m or more
  within 0.3 m, or an overlap of 1 m2; a corner contact does not count). In Milan this can be a whole perimeter
  block. The fill stops at 60 polygons or 250 m from the click and sets `capped`, which the building card reports.
- Shift-click in 3D (`scene.onPartClick`, then `togglePart`) removes a polygon or adds one that touches the
  selection. The clicked polygon always stays, and a removal also drops what it was the only link to. The plan key
  (`id`) does not change. The Map view has no shift-click: it does not draw the selection, and heights, which tell
  the parts apart, are only visible in 3D.
- `id` is the id of the largest outline, so it does not depend on which polygon was clicked, unless a trimmed or
  restored selection forces it (`options.id`). A lone polygon is returned unchanged, with no `members`/`sources`.
- Persistence: a `Plan` stores `selection` (the `sources` ids) next to `buildingId`. On a pick, `choose` in
  `main.ts` floods, finds a saved plan under any polygon of the result (`savedPlanFor`, so plans saved before merging
  still load), and, if the plan has a `selection`, rebuilds exactly those parts with `restoreSelection`. Shift-click
  saves the plan again when one exists.
- Tile preview to OSM: tile pieces are flooded the same way. If the user trimmed the preview, `carrySelection` picks
  the OSM polygons that lie mostly inside the previous footprint; otherwise the fill runs again from the click.
- Switching buildings without the map: a plain click (not a drag, `isClick` in `click.ts`) on an unselected building in 3D,
  or a click on a grey neighbour in the Plan with the Select tool, calls `switchTo` in `main.ts`. It saves the current
  plan, then, if the point is within 250 m of the loaded Overpass data (`loaded`), re-parses those elements around the
  new building and floods again (no request); otherwise it is a map pick (tile preview, then Overpass). The new
  building's own saved plan opens, or none.
- An outline is left out of `members` (and of the scene, `hiddenOutlines` in `osm.ts`) only when its parts cover at
  least 90% of it (`partsCover`): a podium outline with one tower part keeps the podium. A member that lies inside a
  taller one with the same footprint (the same building mapped twice) is not drawn (`buried` in `block.ts`); both
  stay in `sources`. Fixtures for these stacked shapes are `fixtures/overpass-stacked-*.json`, tested in
  `src/stacked.test.ts`.
- `apartment.ts` cuts every member around the one apartment outline, each with its own height and min height;
  whatever of any member lies above the ceiling slab goes to the cutaway group.
- The `?example=milan` sample keeps Palazzo Reale alone (`ids: [id]`): flooding adds its neighbours and moves the
  facade the sample apartment is drawn on.

`tiles.ts` also joins tile pieces of one building (`joinPieces`): same heights, touching or overlapping, same
feature id (without ids: a wall along a constant longitude or latitude, or a buffer overlap).

## The plan model

A `Plan` (see `src/plan.ts`) describes one apartment on one floor:

- `outline` is the **outer face** of the facade walls (outer ring plus holes such as courtyards). Facade walls are
  built inward from it, `FACADE_THICKNESS` thick.
- Windows reference an outline edge (`ring`, `edge`) and a position `t` along it, so they move with the outline.
- `edits` are building-level prisms (`add` or `cut`) with absolute heights above the ground.
- `panels` are solar panels (`Panel` in `plan.ts`): a row of `count` modules centred at `x`, `z`, with `elevation`
  (lowest edge above the ground, metres), `tilt` (0 flat, 90 vertical) and `azimuth` (degrees clockwise from north
  that the front faces). They may lie outside the outline. Older plans without `panels` load as `[]` (`validatePlan`),
  and `rebasePlan` moves them. In 3D (`panelMeshes`) each module is a 4 cm box that casts and receives shadows, with
  edge lines for the frame, floating (what carries it is not modelled); being shadow casters they are occluders in the
  sun map. They are added to the world beside the apartment, so the second pass and the cutaway leave them alone.
- Plans are saved in `localStorage` under `sun-in-house:plan:<buildingId>` and carry their own `origin`;
  `rebasePlan` moves them to the current scene origin. In example mode (`?example=milan`) nothing is loaded from or
  saved to `localStorage` until the user picks a building on the map.

## Rendering and shadows

- The neighbourhood uses one directional light with a 4096² shadow map covering about ±280 m.
- When a plan is shown, a second directional light (same direction) covers only the selected building with a
  2048² map, reaching back along the sun direction so neighbours still cast into it. To avoid lighting the
  apartment twice, the frame is drawn in two passes: pass 1 lights everything with the wide light; pass 2 turns on
  only the narrow light and redraws the apartment meshes at the same depth, with everything else set to
  `colorWrite = false` so it still occludes and casts shadows.
- Cutaway hides the part above the apartment from the camera only (`colorWrite`/`depthWrite` off), so it keeps
  casting shadows into the rooms. Walk mode uses the same state: the panel checkbox "Hide floors above" (also
  shown in the walk panel) and the `H` key are one switch (`ui.ts` owns it). Hidden, the ceiling is open to
  the sky; shown, it is drawn. The floor's sun patches are the same pixels either way, since the sun reaches the
  rooms only through the windows.
- 3D hover: with the pointer over an unselected building (one raycast per animation frame, none while a button is
  down or in walk mode) the cursor becomes a pointer and the polygon gets a faint amber tint and edges.
- Interior brightness from bounced light is approximated with an emissive term proportional to daylight.

## Sun map

The sun map answers "how long is this spot of the floor in direct sun on this date?" for the whole apartment.

- **Sampling** (`floorGrid`): a grid of 0.25 m (coarser above 6000 samples) over the plan outline. A cell centre is
  a sample when it is inside the outline, outside the courtyards, at least `FACADE_THICKNESS` from every outline
  edge, and outside the footprint of every interior wall (`isFloor`, built on `wallsOf` from `walk-geom.ts`).
- **Time**: one slot per 5 minutes of the local day (the slider's grid) where the sun is above the horizon, with
  the sun taken at the slot's middle (`sunSlots`), so a run of lit slots reads in round times without a bias at
  either end. Daylight minutes are the slot count times 5; the share of daylight is minutes over that.
- **Rays**: each sample sends a ray from 5 cm above the floor toward the sun in every slot; it is lit when
  nothing is hit (`seesSun`, `raycastFirst`, double sided). The occluders are collected from the scene itself
  (`collectOccluders`): every visible mesh with `castShadow` set, which is what the shadow maps draw. That includes
  the apartment's walls, window reveals and the facade with its openings, the slab and the storey around it, the
  cutaway "floors above" (hidden from the camera by `colorWrite` but still there), the selected building's other
  parts, neighbours, building fixes and trees (`InstancedMesh`es expanded one copy per instance). Window glass
  never sets `castShadow`, so it lets the sun through. Ten thousand triangles is typical.
- **Worker** (`sunmap.worker.ts`): the triangles go over once per scene and the worker builds the BVH once and keeps
  it; each date only sends the sample points and sun directions. Results (a lit flag per sample and slot) come back
  as one `Uint8Array`; minutes, intervals (`litIntervals`) and the share per spot are derived from it on demand.
- **Caching and staleness** (`sunmap-job.ts`): results are cached per (scene version, date, place). `scene.sceneVersion()`
  goes up whenever `populate()` rebuilds the world (new buildings, plan, edits) or trees change, which also covers
  plan edits; the date and place come from the UI. Requests are debounced (250 ms), one runs at a time, and the
  newest request waits for it. Moving the time slider never recomputes. While a map computes, the old overlay is
  removed (it would show another day) and the legend shows progress.
- **Overlay** (`scene.ts`, `paintSunMap`): the plan outline as one flat mesh just above the floor, textured with one
  texel per grid cell and filtered smoothly; cells that are not floor take their nearest floor colour so nothing
  fades at walls. It is registered in `aptLines`, so the two-pass render draws it in the second pass, over the
  floor that pass repaints, and it stays visible while walking (fainter, so the patches show through). At 80%
  opacity the live sun patches still show faintly under it. Colour is by hours (`SUN_STOPS`, 0 to `FULL_SUN_MINUTES`
  = 6 h), not by share, so December and June maps read on one scale; the legend gives the share of the day's daylight
  for the same hours.
- **Click**: with the map on, a plain click on the floor (`onFloorClick`, not a drag, not through a hidden ceiling)
  marks the point and opens the popover; a click elsewhere or `Esc` closes it. The popover follows the point on
  screen (`onProbeScreen`) and a double-click still walks.
- **In walk mode** the left panel collapses to the tabs plus the same "Hide floors above" and "Sun map" controls
  (and the legend, without its hint); `H` and `M` flip them. There is no floors button in the HUD any more: two
  controls for one state would compete. A plain click on the floor (same `isClick` threshold as 3D, raycast from the
  walk camera) marks the spot and turns the sun map on if it was off; the popover opens when the result is ready,
  and not at all for a spot outside the grid (`probeOutcome` in `probe.ts`). `Esc` goes through `escapeAction`: first
  press closes the popover, the next leaves walk. Entering or leaving walk clears the mark.
- `window.__sunpatch` and `window.__sunpatchCamera` are exposed in the dev server only, for the visual checks.

## Testing

- `npm test` runs the unit tests (pure geometry, parsing, network fallbacks with an injected `fetch`).
- `npm run shots` drives the real app in headless Chromium (SwiftShader WebGL), answering Overpass from
  `fixtures/overpass-milan-duomo.json`, and writes PNGs to check visually.
- `dev/editor.html` and `dev/apartment.html` exercise the editor and the apartment rendering in isolation.
