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
| `main.ts` | App state and wiring: views (Map / Plan / 3D / Panels), picking, OSM refinement, plan loading. |
| `ui.ts`, `chip.ts`, `style.css` | Left panel (views, one-line building identity from `building-line.ts`, dismissible switching hint, overlay toggles, location and accuracy; in Panels the suitability switch, the panel list and the docked card), the docked date/time bar (`#dock`), status chip. |
| `example.ts` | The `?example=milan` sample: lazy-loads the Milan fixture and builds the apartment plan from the building outline. |
| `map.ts`, `geocode.ts` | MapLibre map, Nominatim search (house-number ranking: a bare street is labelled and drawn as a line, never snapped to a building), found-building highlight, tile buildings accessor. |
| `tiles.ts` | Vector-tile features → `Building` for the instant preview; joins pieces cut at tile borders. |
| `overpass.ts` | Overpass query (radius = neighbourhood + 100 m) with mirror fallback, per-endpoint timeout, in-memory cache; a bigger cached answer serves smaller sizes. |
| `neighborhood.ts` | Neighbourhood sizes (150 / 300 / 500 m), the radius filter, data-coverage test, building count line and the scene extent (ground, shadow frustum, sun distance) for a radius. |
| `block.ts` | The selection model: flood fill over touching, overlapping and related polygons into the selected `Building` with `members` and `sources`; shift-click trimming; restoring a saved selection. |
| `osm.ts` | Projection, Overpass parsing (ways, multipolygon relations, ring stitching), heights and their `HeightSource` (`tag`, `levels`, `default`, `tile`, `parts`, `user`), picking helpers. |
| `heights.ts`, `hatch.ts`, `height-popover.ts`, `height-ruler.ts` | Building heights: the user's overrides (`plan.heights`, applied to the parsed polygons, floors or metres), what counts as a guessed height, the striped material that marks those in 3D, the right-click Height box, the 3D height ruler and the hover note. |
| `trees.ts` | Trees: green areas and mapped trees from Overpass, seeded Poisson-ish scatter (clear of buildings, capped at 1500 within 300 m), two `InstancedMesh`es that cast shadows. |
| `footprint.ts` | Extrudes footprints into three.js geometry. |
| `sun.ts` | Sun direction vector from SunCalc, compass names. |
| `plan.ts` | The `Plan` data model (outline, walls, windows, viewpoint, building edits) and helpers. |
| `editor.ts`, `editor-draw.ts`, `editor-geom.ts`, `editor.css` | 2D plan editor: tools, snapping, undo, import/export, autosave, validation. |
| `panel.ts`, `panel-mesh.ts` | Solar panels: geometry (corners from tilt and azimuth, plan footprint, rotate handle), snapping to facade edges, presets; the 3D slabs. |
| `apartment.ts` | Plan → geometry: blocks below/above, rest of the storey, facade walls with window openings, interior walls, glass. |
| `edits.ts` | Building fixes: carving cuts per height range and adding prisms (`polygon-clipping`). |
| `scene.ts` | three.js scene: buildings, lights, shadows, cutaway, sun disc, sky, two-pass apartment rendering, walk mode. |
| `walk.ts`, `walk-geom.ts` | First-person controls and HUD (key hints, compass; the time controls are the docked bar); collision, start position and look direction. |
| `popover-place.ts` | Where a floor popover goes: above or below its point, inside the band between the compass and the docked bar. |
| `sunmap.ts` | Sun map, pure part: floor sampling grid, time slots, lit intervals, share of daylight, colour ramp, overlay texels. |
| `sunmap-trace.ts`, `sunmap.worker.ts`, `sunmap-job.ts` | Sun map rays: occluder collection and BVH tracing (three-mesh-bvh), the worker that runs them, and the job that debounces, caches and reports progress. |
| `panel-shade.ts`, `panel-shade-job.ts`, `panel-card.ts`, `panel-verdict.ts` | Panel shading analysis: samples, 12 days of rays, the month x hour matrix and totals; its worker job (debounced, cached); the card that shows it; the card's one-sentence verdict, shade warning and reference panel (pure). |
| `solar.ts`, `weather.ts`, `panel-totals.ts` | Panel energy: clear-sky model and kWh, NASA POWER climate (fetch, parse, cache), analysis of every panel for the Panels list and its total. |
| `garden-spots.ts`, `garden-trace.ts`, `garden-job.ts` | Gardener sun input: indoor, ground and roof spots, monthly direct-sun minutes per spot, the worker job. |
| `garden-find.ts`, `garden-find-panel.ts` | The reverse direction: kind filtering, colour steps, per-kind counts, summary text, best spot (pure), and the "Find a place for" picker with legend. |
| `garden-pick.ts`, `garden-text.ts`, `garden-card.ts` | The Garden tab: what a click means (floor, ground, roof or nothing), the card's words and month strips (pure), and the card itself. |
| `suitability.ts`, `suitability-job.ts`, `suitability-popover.ts` | Panel suitability map: facade, roof and ground samples, their tracing and kWh/kWp figures, the worker job that runs it progressively, the click popover. |
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
  plan, then, if the point is within the loaded data's radius minus 100 m of its centre (`loaded`), re-parses those elements around the
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

## Building heights

OSM often lacks `height` and `building:levels`, and the 9 m fallback then makes neighbour shadows wrong. Two things
deal with it:

- **Flagging** (`isGuessed`): a polygon whose `heightSource` is `default` (including a map-tile building without
  `render_height`) or `parts` (an outline raised from the parts floating above it) is guessed. `scene.ts` draws those with
  `hatchedMaterial` (`hatch.ts`), a standard material that darkens the albedo along diagonal world-space stripes
  (period 1.6 m, widening in steps from afar so they never shimmer); lighting and shadows are the plain material's, so
  they cast and receive normally. One shared uniform (`hatchStrength`) is the "Mark guessed heights" switch, so toggling
  does not rebuild anything and does not touch the scene version. The selected building is not striped while its
  apartment is in the scene (its info line says it instead). The hover note (`hoverLines`) and the building line give
  the source ("height guessed: 9 m default").
- **Overrides** (`heights.ts`): `main.ts` keeps `site.raw` (the polygons as the data has them) and `site.buildings`
  (`applyHeights(raw, heights)`: height, `minHeight`, `levels` replaced, `heightSource: 'user'`, `dataHeight` remembers the
  data's value). A merged selection is rebuilt from its polygons by `reselect` (the same `mergeSelection` call as
  after a pick), so a part's override changes the selection's height and `levels`. Entered in floors, an override
  sets `levels` and the height is `minHeight + floors x 3 m`; entered in metres it drops `levels`. Everything downstream
  reads `site.buildings` or the scene: `sunScene.setBuildings` rebuilds the world (version bump, so the sun map, panel
  shading and suitability caches, which key on `sceneVersion`, are invalid and rerun; suitability samples come from
  `site.buildings`). If the selected building's height changed, the plan's `floorHeight` is reset to the new
  `defaultFloorHeight` and `floor` clamped to the new level count, which is what the cutaway ("Hide floors above") reads.
  Overrides are saved with the plan; an edit with no plan yet creates the default plan for the selected building (as
  the Panels view does), without moving the camera. In `show()` the working set is the saved plan's overrides over the
  ones already in memory, pruned to polygons that exist in the new data (`keepKnown`), so edits made around one building
  carry to the next building picked nearby. Overrides are keyed by polygon id, so a map-tile preview edit does not carry
  to the OSM data (different ids).
- **Gesture**: right-click a building (without dragging, which pans) opens the Height box; the selected building also has
  an Edit height button on its info line. Plain click, shift-click, floor click and double-click are taken; Alt-click is
  often grabbed by window managers.

- **Height ruler** (`height-ruler.ts`, 3D tab only: Panels and Garden use clicks on roofs for their own picks): a DOM
  overlay (`#heightRuler`) with a tick per 3 m and a handle. `scene.rulerAnchor(polygon, pointer)` gives its screen place:
  the on-screen roof corner nearest the pointer, or, when no corner is in view (close camera), a spot beside the pointer
  with the metre scale taken at the surface under it. Hidden for the selected building while its floors above are cut
  away, while walking, and on any press elsewhere or wheel. It stays put once shown (a grace delay lets the pointer reach
  it). Dragging uses pure helpers (`snapHeight`, `heightFromDrag`, `rulerLabel`, `overrideFromRuler`): whole floors from
  `minHeight`, Shift 0.5 m, a 3 px dead zone. While dragging, `scene.previewHeight` only stretches that polygon's mesh
  (`userData.polygonId`; an outline is drawn for the selected building with its apartment): no rebuild, no scene version
  bump, no re-trace. On release `onCommit` calls `setHeight` (the same override path as the Height box, so `plan.heights`,
  the version bump and the selected building's floor count follow); Esc puts it back.

## The plan model

A `Plan` (see `src/plan.ts`) describes one apartment on one floor:

- `outline` is the **outer face** of the facade walls (outer ring plus holes such as courtyards). Facade walls are
  built inward from it, `FACADE_THICKNESS` thick.
- Windows reference an outline edge (`ring`, `edge`) and a position `t` along it, so they move with the outline.
- `edits` are building-level prisms (`add` or `cut`) with absolute heights above the ground.
- `heights` are the user's own heights for OSM polygons of the area, `{ [polygonId]: { height, minHeight?, levels? } }`:
  the selected building and its neighbours alike, so they live with the plan (export, import and `rebasePlan` carry
  them; they are metres, so rebasing leaves them as they are). `validatePlan` drops entries that are not usable and
  older plans without the field load as before. See "Building heights" below.
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
- **Docked time bar**: date chips, date input, time slider with day strip, label, Play and the sun summary live in one
  `#dock` box at the bottom centre, built in `ui.ts` (which owns the time state; the walk HUD no longer has its own
  slider). It shows in the 3D view and in walk mode only; Map, Plan and Panels hide it. The walk key hints
  (`createWalkHud(app, ui.dock, ...)`) are prepended to the same dock, so they sit just above the bar. In walk mode the
  slider and Play hand the keyboard back to the walk after use. The popovers read the dock's rect (`freeBand`) to stay
  clear of it.
- **In walk mode** the left panel collapses to the tabs plus the same "Hide floors above" and "Sun map" controls
  (and the legend, without its hint); `H` and `M` flip them. There is no floors button in the HUD any more: two
  controls for one state would compete. A plain click on the floor (same `isClick` threshold as 3D, raycast from the
  walk camera) marks the spot and turns the sun map on if it was off; the popover opens when the result is ready,
  and not at all for a spot outside the grid (`probeOutcome` in `probe.ts`). `Esc` goes through `escapeAction`: first
  press closes the popover, the next leaves walk. Entering or leaving walk clears the mark.
- **Panel shading** (`panel-shade.ts`): per panel, a 3 x 3 grid of samples per module, 2 cm in front of the glass
  (so the panel's own boxes never shade it), traced with the same BVH on the 21st of each month in 15-minute slots
  from sunrise to sunset. A sample is lit when cos(incidence) > 0 and the ray hits nothing (slots with the sun
  behind the panel cost no rays). Output: the 12 x 24 lit-share matrix, annual direct-sun hours (the twelve days
  scaled by days per month), the unshaded potential, the shading loss (1 - lit / potential, both weighted by
  cos(incidence), so it is energy and not just hours) and the annual cos x lit sum in hours (`annualCosHours`, for
  the energy step). `panel-shade-job.ts` runs it in its own worker instance (same `sunmap.worker.ts`, message
  `shade`), debounced 250 ms and cached per (scene version, panel parameters, place). The card (`panel-card.ts`)
  is docked in the left panel of the Panels view (`ui.cardSlot`), the only place it shows: a panel is selected from
  the list, by a plain click on it in the Panels view (`scene.onPanelClick`; main.ts ignores it in 3D), or in the
  Plan editor, where a one-sentence summary with "Open in Panels" sits at the end of the panel's properties in the
  right column (`panelSummary` option of `createPlanEditor`). Esc or the close button deselects. Panel snapping in
  the editor accepts only exterior edges (`exteriorEdge` in `panel.ts`).
- **Views**: Map, Plan, 3D and Panels. 3D and Panels are the same `scene` and camera (`setView` in main.ts only changes
  which controls the left panel shows and runs `setActive` for both), so switching keeps the camera. The suitability
  map belongs to Panels and is switched off when another tab opens; Panels creates the default plan when there is none,
  because panels live in the plan. Panels, their shadows and the sun map keep rendering in every view.
- **Panel card text** (`panel-verdict.ts`): `verdict` gives the sentence ("About 568 kWh a year with local weather, 76%
  of the ideal. Shading costs under 1%."; clear-sky wording while the weather loads or fails). It becomes a warning
  when `panelInside` (centre inside the footprint and lowest edge under the roof) or `shadingLoss >= SHADE_WARNING_LOSS`
  (0.95). `referenceEnergy` is the yardstick: an unshaded panel of the same size, 30 degrees, facing the equator, from
  `openIrradiation` (the same days, slots and clear-sky model as `shadePanel` with no rays), through `panelEnergy` with
  the current assumptions and climate. Everything else (ideal figure, months, hours, chart, assumptions) is folded
  under "Details".
- **Panel energy** (`solar.ts`, `weather.ts`): `shadePanel` also sums, per month, the clear-sky irradiation of a
  representative day: beam = Meinel DNI (1353 x 0.68^(AM^0.678), Kasten-Young air mass) x cos(incidence) x lit share
  (and the same with nothing in the way), plus isotropic diffuse (DHI = 10% of DNI, sky (1+cos tilt)/2, ground
  albedo 0.2 x (1-cos tilt)/2). Diffuse is not ray-traced and has no sky-view factor. `panelEnergy` turns that into
  kWh: irradiation x days per month x area x efficiency x (1 - losses); defaults 21% and 14% (PR 0.86, the PVGIS
  convention), so a 1.13 x 1.72 m module is about 0.41 kWp. The weather figure is the ideal month times the NASA POWER
  clear-sky index (ALLSKY / CLRSKY, horizontal), a simple approximation that slightly misstates vertical or shaded
  panels because clouds cut beam more than diffuse. The index is fetched once per place (0.1 degrees) by
  `loadClimate` once a plan has panels, kept in memory and localStorage for 30 days, never retried automatically;
  on failure the card shows the ideal figure with a Retry. PVGIS is not used: it sends no CORS header. Assumptions
  are edited in the card and recompute without new rays. `panel-totals.ts` runs the shading of every panel through a
  second job (one at a time) for the Panels list and its total. Tests use `fixtures/nasa-power-milan.json`.
- **Panel suitability** (`suitability.ts`): where to put panels. Candidate surfaces around the selected building
  (`surfaceSamples`): the facade is the outer boundary of the merged footprint (`selected.outer` and its courtyard
  holes, so a party wall between members is never sampled; cells pressed against an unselected taller neighbour are
  dropped), 1 m along by about 1 m up from the member's `minHeight` to its eaves, vertical and facing out; the roof
  is each member's flat roof at its own height on a 1 m grid, 0.3 m from the edge, once where members overlap (the
  taller wins); the ground is a 2 m grid within 18 m of the footprint, outside every building plus 1 m. Roof and
  ground samples are a 30 degree stand facing south (north when the latitude is negative); rays start at the stand's
  middle. `traceSamples` runs the same BVH rays as the panel card on the same 12 days at 30-minute slots and returns
  beam, unshaded beam and diffuse per month; `surfaceEnergy` feeds them to `panelEnergy` with an area of 1/efficiency
  so the result is kWh per kWp a year, ideal and with the NASA POWER factor, the same figure a panel card gives.
  `suitability-job.ts` runs it in a worker instance of its own (`sunmap.worker.ts`, message `suit`, 400 samples per
  turn with progress, so a newer request can stop it), cached per (scene version, place); a newer request terminates
  the run. `main.ts` asks only while the switch is on, waits for the climate before colouring, recolours when the
  climate or the assumptions change, and drops the map when the scene changes (not when a panel is placed from it:
  the old map stays until the update arrives). The scene (`setSuitability`) draws one vertex-coloured quad per sample
  (facade quads 8 cm off the wall, flat ones 8 cm above the surface) with the sun-map ramp, as an apartment line so the
  second render pass draws it over the walls. It has its own picking: a click returns the nearest quad unless a
  solid is closer, so orbit, building switching, panel clicks and double-click to walk are untouched. While it shows,
  the cutaway is off (`cutawayNow`): the facade and roof of the floors above need a building behind them; the
  map only exists in the Panels view, where the cutaway switch is not shown, and leaving it or walking turns the map off. "Place a panel here" (`panelFor`) adds a panel with
  the preset of the surface: facade vertical and facing out at the cell's height, roof the 30 degree stand at the roof
  height, ground the stand at `GROUND_ELEVATION`.
- `window.__sunpatch`, `window.__sunpatchCamera` and `window.__sunpatchControls` are exposed in the dev server only, for the visual checks.

## Gardener (data, logic, sun input and the Garden tab)

`plants.ts` is a catalogue of about 70 common plants, each with an English and an Italian common name (`nameIt`), with the direct-sun hours they need (least, best, and a scorch limit for shade plants), their temperature range (growth minimum, optimum, maximum, coldest they survive), whether they grow indoors or outdoors, and for annual crops the days to harvest. `garden.ts` rates a plant at a spot for each month: `good`, `ok` or `poor`, from the spot's mean daily direct-sun minutes per month and the temperatures in `Climate` (`weather.ts` now also reads NASA POWER `T2M`, `T2M_MIN` and `T2M_RANGE`; the typical daily minimum and maximum are the monthly mean minus and plus half the mean daily range, and `T2M_MIN` is the coldest value in the 25-year record). The worst finding sets the rating, and `explain` says it in one sentence. Tender plants (survive above -3 degC) are tested for frost against the coldest night on record, hardy ones against the typical night. A plant's summary gives its months, whether it works all year, and for annual crops whether the longest unbroken run of non-poor months is long enough for the days to harvest, with the month to sow. A hardy perennial that is too cold to grow outdoors is "resting" (ok, sun ignored); a perennial is scored over its non-resting months and scores 0 if any month kills it (frost, wrong place). Catalogue figures are typical values from general guidance, not checked plant by plant. `rankPlants` orders plants for a spot; `scoreSpots` scores one plant over many spots. Indoor spots ignore the weather and assume a heated home at 18 to 24 degC all year (`INDOOR_TEMP`); that is an assumption, real rooms differ. Only direct sun is counted, so a plant that lives on bright indirect light is rated by the direct sun alone.

The Garden tab (`View` 'garden') shares the 3D scene and camera with Panels; the docked time bar is not shown (everything is a year) and `setView('garden')` creates the default plan with `keepView` so the camera stays. While the view is active `scene.setGardenPicking(true)` makes a plain click report a `GardenHit` (the first surface the camera sees, as `seenHit` finds it: not glass, not an overlay, not a hidden cutaway block) with its point, whether it is the apartment floor and the world-space normal's height. `classifyHit` (`garden-pick.ts`) turns it into `indoor` (the apartment floor), `ground` (a flat surface at most 0.5 m up) or `roof` (any other flat surface: a roof, terrace or balcony), and a facade or ceiling (normal tilted more than about 45 degrees from vertical) gives no spot: the card says "Pick a floor, ground or roof spot". main.ts traces that spot with `createGardenJob` as a small disc (`discSpots`: the point and six more 0.3 m around it at the same height, indoor ones dropped when outside the plan's outline; `meanSun` averages their minutes so one ray path past a frame does not make the strip jump; the request's `tag` keeps different points of one scene apart in the cache) and, for outdoor spots only, loads the climate with `loadClimate`. Any scene change (new building, plan edit, heights, trees) clears the spot, since its height and shade belonged to the old scene; leaving the tab, Esc or the card's close button clear it too. A roof spot is the picked building's own when it lies inside one of its footprints, else a neighbour's (`whereText`). The temperature strip tints a month cool when its typical low is at or under 1 degC. `garden-card.ts` ranks the plants with `rankPlants` (the chosen month or the whole year) and shows the good and ok ones, with the poor ones under "Why not others?"; `garden-text.ts` holds the sentences, month runs and strip figures so they are unit tested. The Garden section of the left panel has its own copy of "Hide floors above" (the same state as the 3D tab's), because the roof can only be clicked with the floors above shown; a quiet line under it says so while the floors are hidden and the building has roof spots. The tab has one month control, in the plant picker; the spot card follows it.

The plant map ("Find a place for...", `garden-find-panel.ts`, state in main.ts): picking a plant runs a second `createGardenJob` (so a clicked spot's trace and the area trace never abort each other) over `gardenSpots` (indoor, ground, roof), cached by the job's key, so changing plant or month only calls `scoreSpots` again (outdoor spots with the NASA POWER climate, indoor ones without, since they ignore the weather; with no climate they are left unscored and uncoloured). `kindsFor` skips the kinds a plant cannot stand on, `stepOf` maps ratings to good (2), ok (1) and poor (0, not drawn), and `scene.setGardenMap` draws one flat quad per coloured spot, one mesh per kind: the roof's mesh hides while floors above are hidden (it would hang in the air) and none of them take clicks, so a click still names the surface and opens the spot card. `kindStats` and `findSummary` turn the scores into the sentence (best kinds with a compass direction of their centre from the building's centre, "Only fair", "Nowhere suitable", with a reason such as "not enough direct sun" when at least 60% of that kind's spots fail the same way: `scoreSpots` returns `mainIssue` for poor spots), and `bestSpot` (highest score, then most sun) feeds "Show the best spot", which selects it as if clicked. A scene change retraces the area; leaving the tab clears the plant.

## Testing

- `npm test` runs the unit tests (pure geometry, parsing, network fallbacks with an injected `fetch`).
- `npm run shots` drives the real app in headless Chromium (SwiftShader WebGL), answering Overpass from
  `fixtures/overpass-milan-duomo.json`, and writes PNGs to check visually.
- `dev/editor.html` and `dev/apartment.html` exercise the editor and the apartment rendering in isolation.

`garden-spots.ts` makes the spots a garden analysis traces: the apartment floor on a 0.5 m grid (`indoor`, at most 600), the ground ring around the building from `groundSamples` (2 m cells, at most 2400) and the roof of the selection from `roofSamples` (1 m cells, at most 900); longer lists are thinned to a regular coarser grid (every f-th row and column, f the smallest whole number that fits), and each spot records the `cell` it stands for so a map can draw it as a square. Each sits `POT_HEIGHT` (0.4 m, a pot on the floor or a sill) above its surface, and `pointSpot` makes one for a clicked point. `traceMonthly` (`garden-trace.ts`) sends a ray toward the sun from each spot on the 21st of every month in 15-minute slots for a clicked spot and 30-minute slots for the area map (`yearSlots`) and returns twelve mean daily direct-sun minutes per spot, the `sunMinutes` of a `Spot`. The sun map worker runs it as message `garden` (100 spots per turn with progress, so a newer request can stop it), and `garden-job.ts` debounces and caches it per (scene version, building and floor, place, year) like the suitability job, returning `SunnySpot`s ready for `rankPlants` and `scoreSpots`. The Garden tab creates it. The ray test stops at the first triangle in the way (`shapecast`, not `raycastFirst`), about 40% faster with identical results (tested against `seesSun`). The Milan example's 2947 spots take about 4 s in Chromium's worker (about 6 s with a full-size software-rendered viewport competing for the same cores; 20 s before this change).

## Neighbourhood size

Details in the 3D panel holds a Small / Medium / Large menu (150 / 300 / 500 m; kept in `localStorage`,
`sunpatch.neighborhood`). The radius (`hoodRadius` in `main.ts`) is the only thing that decides which polygons the scene
holds, so it is also what the shadow casters, the BVH and every sun-map, panel and garden trace see. `show` keeps all parsed
polygons in `site.full` and gives the scene those within the radius of the origin (the selection always stays). A new size
re-runs `show` on `site.full` when the loaded Overpass data still covers the circle (`covers`; shrinking always does),
otherwise `refine` fetches the bigger circle with the selection kept. Either way `setBuildings` bumps the scene version, so
the sun map, panels and garden recompute. `dataExtent(radius)` sizes the ground plane and the shadow frustum (about 1.12 x
the radius) and the sun distance; there is no fog. Trees stay within 300 m (`TREE_RADIUS_M`) or the radius if smaller.

## Languages (English, Italian)

`src/i18n.ts` holds `t(key, params)` (`{name}` interpolation, one/other plurals picked by the `n` param with
`Intl.PluralRules`), `fmtNumber` / `fmtTime` / `fmtDay` (locale `en-GB` or `it-IT`) and the language choice: `localStorage`
`sunpatch.lang`, else `navigator.languages` (`it*` is Italian), else English; it sets `<html lang>`. The dictionary is split
in typed sections, one file each in `src/i18n/` (`defineStrings({ en, it })` fails to compile when a key is missing in one
language), merged in `src/i18n/index.ts`; a missing `it` key falls back to `en`, and `i18n.test.ts` checks both languages
have the same keys and params. Switching (`lang-switch.ts`, in the panel header) stores the choice and reloads the page,
because most text is built once at load; the open building, tab and date/time survive through `session.ts`
(`sessionStorage`, read once after the reload), and plans and options are already in `localStorage`. A native
`<input type="date">` is shown in the browser's own format, which the page language cannot change.

Month names come from `fmtMonth` (Intl). Plants show `nameIt` in Italian (`plantName`), and the plant search matches either
name (`plantMatches`, accent- and case-insensitive). The Italian garden sentences leave the plant name out where English uses
it (Italian needs an article that depends on the plant's gender), so the parity test lets `it` drop a `{name}` param.
