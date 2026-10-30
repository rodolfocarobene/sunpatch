# Sunpatch

See where the sun comes into your home: pick your building on a map, sketch your apartment and its windows,
then walk inside in 3D and watch the sun patches move across the floor for any day of the year.

[![Demo: pick a building, sketch the apartment, watch the sun move and step inside](docs/demo.gif)](docs/demo.mp4)

*Click the animation for the full video (45 s).*

Sunpatch runs entirely in the browser. Building footprints and heights come from
[OpenStreetMap](https://www.openstreetmap.org/), the sun position from [SunCalc](https://github.com/mourner/suncalc),
and the 3D scene is rendered with [three.js](https://threejs.org/). No account or API key is needed.

## Features

- **Find your building** on an OpenStreetMap map, by address search or by clicking it. The 3D view opens at once
  from the map's own building data, and the detailed OpenStreetMap buildings load in the background.
- **Real neighbourhood shadows**: every building within about 300 m is modelled, so the blocks across the street
  shade your windows just like in reality.
- **Sketch your apartment** in a top-down plan editor: choose the floor, draw the outline (it snaps to the
  building's walls), add interior walls and place windows with their width, sill and height.
- **Fix the building** where OpenStreetMap is incomplete: add a missing balcony or a protruding wall, or cut away a
  recess. Fixes cast shadows like the rest of the building.
- **Watch the sun move**: pick a date and a time, or press Play to run through the day. A cutaway view hides the
  floors above so you can look into your rooms from outside.
- **Solar panels** in their own **Panels** tab: place panels on a facade, roof or the ground and read, in one
  sentence, how much energy each makes a year and how that compares with an unshaded panel, with the shading and
  the month-by-month figures one click away.
- **Panel suitability**: a map of where panels would do best, on the facade, the roof and the ground around the
  building, in kWh a year for each kW of panels, with local weather. Click a spot and place a panel there.
- **Sun map**: switch it on and the floor is coloured by the hours of direct sun it gets on the chosen date, from
  slate (none) through amber to pale yellow (6 hours or more). Click any spot for its hours, the share of the
  day's daylight and the times, drawn on a day strip like the time slider's.
- **Walk inside** in first person at eye height, see the sun disc through the windows and step the time while you
  look around.
- Plans are saved in the browser automatically and can be exported and imported as JSON.

| | |
|---|---|
| ![Pick a building on the map](docs/screenshot-map.png) | ![Sketch the floor plan and windows](docs/screenshot-plan.png) |
| Pick a building on the map | Sketch the floor plan and windows |
| ![3D cutaway with neighbourhood shadows](docs/screenshot-cutaway.png) | ![First-person view with sun through the windows](docs/screenshot-walk.png) |
| 3D cutaway with neighbourhood shadows | Walk inside and see the sun patches |

## Quick start

You need [Node.js](https://nodejs.org/) 22.12 or newer.

```sh
git clone https://github.com/rodolfocarobene/sunpatch.git
cd sunpatch
npm install
npm run dev
```

Then open the address Vite prints (normally <http://localhost:5173>). That is the landing page; the app is at
`/app/`, and `/app/?example=milan` opens a bundled sample apartment in 3D without any map click or network request
for buildings.

To build a static site, run `npm run build` (add `-- --base=./` to host it under a sub-path, as GitHub Pages does).
The output in `dist/` can be served by any static host; the app is at `dist/app/`.

## How to use it

1. **Map**: search an address or move the map, then click your building. The app switches to the 3D view.
   Your building is every outline that touches the one you clicked, so it may include neighbours of other
   heights. In 3D, **Shift-click** a building to add it to the selection or take it out.
   To work on another building, click it in 3D (it lights up when you point at it), or click a grey neighbour in Plan with the Select tool.
   Your plan is saved first.
   **Heights.** Many OpenStreetMap buildings have no height, and Sunpatch then assumes 9 m. Those are drawn with
   faint diagonal stripes (switch it off with *Mark guessed heights*), and pointing at a building tells you where its
   height came from. To correct one, right-click it in 3D (or press *Edit height* under the selected building's name),
   enter its height in floors (3 m each) or in metres, and press *Set*. This works for neighbours as well as your own
   building; *Reset to the data* undoes it. The shadows, the sun map and the panel results follow at once, and the
   heights are saved with your plan (they are part of its export).
2. **Plan**: set the floor (0 is the ground floor) and check the floor height, which is estimated from the
   OpenStreetMap data. Then:
   - **Outline**: click the corners of your apartment; double-click or click the first point to close it.
     **Whole floor** resets it to the full footprint.
   - **Wall**: two clicks per interior wall; hold Shift for right angles.
   - **Window**: click on an outline edge. With **Select** you can drag a window along its wall and edit its size.
   - **Building fix**: draw a shape, choose Add or Cut, and set its heights or use a preset such as
     *Balcony slab on this floor*. To change how tall a whole building is, right-click it in 3D instead (below).
   - **Panel** (`P`): click to place a solar panel anywhere, inside or outside the outline. Near a wall it snaps and
     faces outward (vertical); elsewhere it faces south at 30 degrees. Drag to move, drag the white dot to turn,
     and set tilt, facing, height and modules in the box (presets: *Balcony railing*, *Roof stand*, *Ground*).
     Panels show in 3D, cast shadows, and count in the sun map. Snapping only uses the building's outside walls,
     never an apartment wall inside it.
   - Select a panel to see a one-sentence summary under its properties, with **Open in Panels** for the full card.
   - The camera symbol shows where **Walk inside** will put you. Drag it to move it and drag its white dot to
     turn it.
3. **3D**: drag to orbit, scroll to zoom, right-drag to pan. The bar at the bottom holds the date (Winter,
   Equinox, Summer and Today chips, or any date), the time slider with its daylight strip, **Play** and where the
   sun is. Keep **Hide floors above** on to see inside.
   Tick **Sun map** to colour the floor by hours of direct sun on that date. The legend is one line from 0 h to
   6 h+; *Share of daylight* opens the percentages. Click a spot on the floor to read its hours and times, for
   example *3 h 10 min of direct sun, 42% of daylight, 16:00 to 19:10*; click elsewhere or press `Esc` to close it.
   Changing the date recomputes the map (a few seconds, in the background); moving the time slider does not.
   The map stays on while you walk.
   The left panel names the building on one line, for example *Relation 36488 · 9 m · 3 levels*, with its OSM
   link. **Location and accuracy** is folded away.
   Panels are drawn and cast shadows here too, but the solar controls live in the Panels tab.
4. **Panels**: the same 3D scene and camera as the 3D tab, with the solar tools in the left panel (the date and
   time do not matter here: everything is a year).
   - **Panel suitability**: tick it to colour the outside of the building and its surroundings by the yearly energy a
   panel would make there, in kWh a year for each kW of panels. The colours stretch over the range found around your building, and the legend
   gives that range, for example *650 … 1,400 kWh a year per kW*. The facade is sampled every metre (panels
   vertical, facing out), the roof of each part of the building at its own height, and the ground within 18 m on a
   2 m grid; roofs and ground use a 30 degree stand facing south (north in the southern hemisphere). It takes a
   few seconds to a minute for a big building (a progress bar shows), runs only when ticked, and is kept for
   the same scene and place. Click a spot for its figure with local weather, the ideal clear-sky one and the loss to
   shading, and press **Place a panel here** to add a panel with the matching preset to your plan, selected so its
   card opens. The camera stays where you left it; if the building is out of view the legend offers **Frame the
   building**. The floors above stay visible while the map shows (the legend says so), and it is exclusive with **Sun map**. Esc closes the popover. It switches off when you leave the tab.
   - **Your panels**: a list with each panel's yearly energy and the total, for example *3 panels, ~1,050 kWh a
     year with local weather*. A panel inside the building is listed as excluded and not counted in the total. Click a row, or a panel in the view, to open its card. Add panels with **Place a panel
     here** or with the Panel tool in Plan.
   - **The card** leads with one sentence, for example *About 568 kWh a year with local weather, 76% of the ideal.
     Shading costs under 1%.*, and a yardstick: what an unshaded panel of the same size, tilted 30 degrees and facing
     south, would make at this place. A panel inside the building, or one that loses 95% or more to shading, gets a
     warning instead. **Details** holds the ideal clear-sky figure, the bars by month, the direct-sun hours, the loss
     to shading, the month by hour chart (hover a cell for the figure) and the *Assumptions* (module efficiency 21%,
     system losses 14%; kWp is the panel's rated power, and 1 kWp is about 5 m² of panels). It is an estimate: direct sun is
     traced in 3D, diffuse light is approximated and not shaded.
5. **Garden**: the same 3D scene and camera again, to see what would grow at a spot. Click the apartment floor
   (an indoor spot), the ground, a roof or a terrace (outdoor spots); a ring marks the spot. The card traces the direct
   sun there for the 21st of each month and shows it as twelve bars, then lists the plants of a built-in catalogue
   of about 30 best first, with a rating (good, OK), the months it grows, the month to sow an annual crop, and one
   sentence of reason. Pick a month to rate the plants for that month only. The poor ones are kept behind **Why not
   others?**, each with its reason. Outdoor spots also show the typical night and day temperature by month and need
   the local climate from NASA POWER; if it cannot load, the card says so and offers **Retry** instead of ratings.
   Indoors the card assumes a heated home at 18-24 degrees C all year, which real rooms may not match. A click on a
   wall (a facade) makes no spot and the card says to pick a floor, ground or roof spot. To click the roof, untick **Hide floors
   above**. Esc or the close button removes the spot. Plant figures are typical values for a common variety, not checked plant by plant,
   and only direct sun is counted.
6. **Walk inside** (or double-click the apartment floor): drag to look, WASD or arrow keys to walk, Shift to go
   faster, `[` and `]` to move the time by 15 minutes, `P` to play or pause, `Esc` to leave. The same date and
   time bar stays at the bottom, with the key hints above it, and the small panel on
   the left keeps **Hide floors above** (`H`) and **Sun map** (`M`) with its legend; they are the same switches as
   in the 3D panel. Hidden, you see the sky through the ceiling, and the sun still comes in only through the
   windows. Click the floor to read the hours of direct sun at that spot (this turns the sun map on if it is
   off); the first `Esc` closes that box, the next one leaves the walk.

Times are in your browser's time zone, so use the app from the same time zone as the place you are looking at.

## Accuracy and limitations

The sun position and the direct-sun geometry are accurate; how good the result is mostly depends on the
building data.

- Heights come from OpenStreetMap `height` tags when present, otherwise from the number of floors × 3 m,
  otherwise a 9 m default. The selected building's info box says which one was used, and buildings whose height is
  a guess are striped in 3D. Wrong heights move shadows by metres, so correct the ones that matter near you
  (right-click a building in 3D). Your own heights are exact only as far as you know them: 3 m a floor is a
  typical value, not a measurement.
- Roofs are flat, and trees, awnings and most balconies are missing. Use **Building fix** for the ones that matter
  to you.
- The sun map is sampled every 25 cm and every 5 minutes, so hours are good to a few minutes and patch edges to
  about a hand's width. It counts the sun as a point, so the soft edge of a shadow is a sharp line.
- Only direct sunlight is simulated. The general brightness of the rooms is a simple stand-in for light bouncing
  around, not a measurement.
- Distant terrain (hills, mountains) is not modelled yet, so very low sun near sunrise and sunset may be
  reported as reaching you when a ridge would block it.
- The public Overpass servers are sometimes busy. When they fail you keep the map-tile buildings, which have
  heights but no floor counts, and can retry.

## How it works

1. **Picking**: MapLibre GL JS shows OpenFreeMap vector tiles. On a click, the buildings already loaded in the
   tiles are turned into an instant 3D preview. The app then asks the Overpass API for the OpenStreetMap
   buildings within 350 m, trying several mirrors in turn, and swaps them in without moving the camera.
2. **Scene**: footprints are projected to local metres around the selected building (x east, y up, z south)
   and extruded with three.js. Buildings with separately mapped parts (`building:part`) are drawn from their
   parts.
3. **Sun**: SunCalc gives the sun's azimuth and altitude for the chosen place and time. A directional light
   placed in that direction casts shadow maps.
4. **Apartment**: the plan replaces the selected building with the floors below, the floors above, the rest of
   your storey, and your apartment's walls with real window openings. Building fixes are added or carved out
   per height range with `polygon-clipping`.
5. **Sharp patches**: a second, narrow sun light covers only your building with a high-resolution shadow map,
   rendered in a second pass so the room gets centimetre-level sun patches without lighting anything twice.
6. **Sun map**: the floor is sampled every 25 cm, and from each sample a ray goes toward the sun every 5 minutes
   from sunrise to sunset. A ray counts as lit when it reaches the sky past every shadow caster in the scene (a
   BVH from [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) in a Web Worker); window glass lets it
   through.

More detail for contributors is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Development

```sh
npm test          # unit tests (Vitest)
npm run build     # type-check and production build
npm run shots:install   # once: download a headless Chromium into .browsers/
npm run shots -- out/   # render the main flow to PNGs (uses a recorded Overpass response)
npm run demo      # re-record the demo video and screenshots in docs/ (needs ffmpeg)
```

The landing page (`index.html`, `src/landing.css`, media in `public/media/`) and the app (`app/index.html`) are
separate pages of one Vite multi-page build (`vite.config.ts`). `src/example.ts` builds the Milan example from the
bundled fixture; its edits are never autosaved.

`npm run dev` also serves two pages that are handy while working on one part in isolation:
`/dev/editor.html` (plan editor on a test building) and `/dev/apartment.html` (a test apartment; try
`?walk=1&edits=1`).

See [CONTRIBUTING.md](CONTRIBUTING.md) for conventions.

## Roadmap

- Terrain horizon from an elevation model, so hills and mountains block the low sun.
- Time zone of the chosen place instead of the browser's.

## Data and attribution

- Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under the
  [Open Database License](https://opendatacommons.org/licenses/odbl/). This includes the recorded test data in
  `fixtures/`.
- Map tiles by [OpenFreeMap](https://openfreemap.org/), using the [OpenMapTiles](https://openmaptiles.org/) schema.
- Address search by [Nominatim](https://nominatim.org/) and building data by the [Overpass API](https://overpass-api.de/)
  and its mirrors. Please respect their usage policies: the app sends one search per submit and one Overpass
  query per picked building, and caches the results.
- Weather: monthly clear-sky index (panel energy) and air temperatures (Garden tab) from [NASA POWER](https://power.larc.nasa.gov/) climatology
  (25-year averages). One request per place, rounded to 0.1 degrees, cached in the browser for a month, and made
  only once a panel exists, the suitability map is on, or an outdoor Garden spot is picked. The recorded response in `fixtures/nasa-power-milan.json` is used by the tests.

## License

[MIT](LICENSE) © 2026 Rodolfo Carobene
