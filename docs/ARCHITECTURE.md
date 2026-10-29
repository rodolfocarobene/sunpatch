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
```

`src/main.ts` owns the app state (current view, picked site, current plan) and wires the modules together.

## Modules

| File | Role |
|---|---|
| `main.ts` | App state and wiring: views (Map / Plan / 3D), picking, OSM refinement, plan loading. |
| `ui.ts`, `chip.ts`, `style.css` | Left panel (views, building info, location, date/time, play), status chip. |
| `example.ts` | The `?example=milan` sample: lazy-loads the Milan fixture and builds the apartment plan from the building outline. |
| `map.ts`, `geocode.ts` | MapLibre map, Nominatim search (house-number ranking: a bare street is labelled and drawn as a line, never snapped to a building), found-building highlight, tile buildings accessor. |
| `tiles.ts` | Vector-tile features → `Building` for the instant preview. |
| `overpass.ts` | Overpass query with mirror fallback, per-endpoint timeout, in-memory cache. |
| `block.ts` | The selection model: merges the polygons of one building (parts, relation rings, address, overlap) into the selected `Building` with `members` and `sources`. |
| `osm.ts` | Projection, Overpass parsing (ways, multipolygon relations, ring stitching), heights, picking helpers. |
| `trees.ts` | Trees: green areas and mapped trees from Overpass, seeded Poisson-ish scatter (clear of buildings, capped at 1500 within 300 m), two `InstancedMesh`es that cast shadows. |
| `footprint.ts` | Extrudes footprints into three.js geometry. |
| `sun.ts` | Sun direction vector from SunCalc, compass names. |
| `plan.ts` | The `Plan` data model (outline, walls, windows, viewpoint, building edits) and helpers. |
| `editor.ts`, `editor-draw.ts`, `editor-geom.ts`, `editor.css` | 2D plan editor: tools, snapping, undo, import/export, autosave, validation. |
| `apartment.ts` | Plan → geometry: blocks below/above, rest of the storey, facade walls with window openings, interior walls, glass. |
| `edits.ts` | Building fixes: carving cuts per height range and adding prisms (`polygon-clipping`). |
| `scene.ts` | three.js scene: buildings, lights, shadows, cutaway, sun disc, sky, two-pass apartment rendering, walk mode. |
| `walk.ts`, `walk-geom.ts` | First-person controls and HUD; collision, start position and look direction. |

## The selection model

One real building is often several OSM polygons (an outline plus `building:part`s with their own heights, the
outer rings of a multipolygon, a footprint mapped twice). `selectBuilding` in `src/block.ts` turns the clicked
polygon into one selected `Building`:

- `outer`/`holes` are the union of the footprints (the plan editor snaps to it and "Whole floor" uses it);
  `height`/`minHeight`/`levels` summarise the pieces (tallest piece, lowest start).
- `members` are the pieces that are drawn, each with its own footprint and heights; `sources` lists every polygon
  merged in, including an outline that is only the footprint of its parts (not drawn).
- Merge rules: same relation; same `addr:street` + `addr:housenumber`; parts lying in an outline; overlapping
  outlines; a stray part joins the neighbour it shares the longest wall (4 m or more) with. Buildings that merely
  touch are not merged (a Milan perimeter block would become one selection); different addresses never merge.
- `id` is the id of the largest outline, so it does not depend on which polygon was clicked. Plans saved under any
  merged polygon's id are still found (`savedPlanFor` in `main.ts`).
- `apartment.ts` cuts every member around the one apartment outline; whatever of any member lies above the ceiling
  slab goes to the cutaway group.
- A lone polygon is returned unchanged, with no `members`/`sources`.

## The plan model

A `Plan` (see `src/plan.ts`) describes one apartment on one floor:

- `outline` is the **outer face** of the facade walls (outer ring plus holes such as courtyards). Facade walls are
  built inward from it, `FACADE_THICKNESS` thick.
- Windows reference an outline edge (`ring`, `edge`) and a position `t` along it, so they move with the outline.
- `edits` are building-level prisms (`add` or `cut`) with absolute heights above the ground.
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
  casting shadows into the rooms.
- Interior brightness from bounced light is approximated with an emissive term proportional to daylight.

## Testing

- `npm test` runs the unit tests (pure geometry, parsing, network fallbacks with an injected `fetch`).
- `npm run shots` drives the real app in headless Chromium (SwiftShader WebGL), answering Overpass from
  `fixtures/overpass-milan-duomo.json`, and writes PNGs to check visually.
- `dev/editor.html` and `dev/apartment.html` exercise the editor and the apartment rendering in isolation.
