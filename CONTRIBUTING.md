# Contributing

Thanks for your interest! Issues and pull requests are welcome.

## Setup

```sh
npm install
npm run dev
```

Node.js 22.12 or newer is required. The landing page is `/` and the app is `/app/` (`/app/?example=milan` for the
built-in sample). For visual checks, run `npm run shots:install` once to download a headless
Chromium into `.browsers/` (git-ignored).

## Before opening a pull request

- `npm test` and `npm run build` must pass.
- For changes that affect what you see, run `npm run shots -- out/` and look at the images. Mention in the pull
  request what you checked.
- Keep pull requests focused; small commits with short imperative subjects (under 72 characters) are preferred.

## Conventions

- TypeScript, plain DOM and SVG, no UI framework. Keep modules small and match the style of the surrounding code.
- Put geometry and parsing in pure functions with Vitest tests next to them (`foo.ts` + `foo.test.ts`).
- Scene coordinates are local metres: x = east, y = up, z = south (north is −z). See
  [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- Pin exact dependency versions in `package.json`.
- Be gentle with the free services the app uses (Overpass, Nominatim, OpenFreeMap): no request loops, no
  autocomplete against Nominatim, cache what you can. Tests must not hit the network.
- Never commit API keys or other secrets; the app needs none.

## Data

Test data in `fixtures/` comes from OpenStreetMap and is © OpenStreetMap contributors, under the ODbL.
