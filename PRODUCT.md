# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
- **Apartment hunters** comparing flats before renting or buying. They want a quick, trustworthy answer to "does this flat get sun, in which rooms, and when (especially in winter)?" without being experts.
- **Gardeners and balcony-solar people** deciding where plants or small panels will get enough direct sun (see issue #1: plants, solar panels, luminosity map).

## Product Purpose
Sunpatch shows where direct sunlight enters a specific home: pick the building on an OpenStreetMap map, sketch the apartment and its windows, then see the sun patches on the floor in a 3D cutaway or by walking inside, for any date and time. Success is a user who, in a few minutes, can say which rooms get sun and at what times of year.

## Positioning
Shadow tools like Shadowmap and SunTrace3D stop at the facade; Sunpatch models the inside of one apartment (its windows, walls and floor) with real neighbourhood shadows, free, in the browser, with no account.

## Operating Context
- Used on desktop (mouse and keyboard): plan drawing, 3D orbit and first-person walking. Phone support for the app is out of scope; the landing page is responsive.
- Typical session: search address, click building, sketch outline and windows, scrub time on a few key dates (winter/summer solstice).
- Depends on free public services (OpenFreeMap tiles, Nominatim, Overpass) that can be slow or busy.

## Capabilities and Constraints
- Direct sun only; diffuse light is a stand-in. Flat roofs, no terrain yet, heights from OSM (can be wrong). Building fixes (add/cut prisms) patch missing geometry.
- Plans live in the browser's localStorage; export/import JSON.
- Static site on GitHub Pages (`/` landing, `/app/` app), TypeScript + Vite + three.js + MapLibre, no UI framework.

## Brand Commitments
- Name: Sunpatch. MIT licensed, open source (github.com/rodolfocarobene/sunpatch).
- Landing page establishes a warm sunlight palette (amber accent, slate) with light and dark themes.

## Evidence on Hand
- Demo video and screenshots: `docs/demo.mp4`, `docs/screenshot-*.png`; bundled Milan example (`app/?example=milan`).
- No users, testimonials or accuracy studies exist yet; do not invent them.

## Product Principles
1. Answer "when is this room sunny?" fast; every step should move toward that.
2. Be honest about accuracy: show where data comes from and what is not modelled.
3. Free, no account, private by default.
4. Desktop precision over mobile reach for the app.
