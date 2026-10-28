// Headless visual check: renders the test scene, the map, and a picked OSM building
// (Overpass answered from a fixture) at 11:00, saving PNGs to the output dir.
// Usage: npm run shots -- [outDir]   (Chromium from `npm run shots:install`)
import { readFileSync, mkdirSync } from 'node:fs'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const out = process.argv[2] ?? 'shots'
const fixture = readFileSync(new URL('../fixtures/overpass-milan-duomo.json', import.meta.url), 'utf8')
mkdirSync(out, { recursive: true })

const server = await createServer({ server: { port: 5179, strictPort: true }, logLevel: 'error' })
await server.listen()
// SwiftShader gives headless Chromium a software WebGL implementation.
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  page.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text()) })
  page.on('pageerror', (e) => console.log('pageerror:', e.message))
  await page.route('**/overpass-api.de/**', (r) => r.fulfill({ contentType: 'application/json', body: fixture }))
  await page.goto('http://localhost:5179/')

  const setTime = (min) =>
    page.$eval('#time', (el, v) => { el.value = String(v); el.dispatchEvent(new Event('input')) }, min)
  await setTime(11 * 60)
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${out}/test-scene.png` })

  await page.click('#viewToggle')
  await page.waitForTimeout(5000)
  await page.screenshot({ path: `${out}/map.png` })

  // The map starts on the Duomo square; try a few points until one hits a building.
  for (const [dx, dy] of [[60, -60], [0, -40], [40, 0], [-40, 0], [0, 40], [80, 30], [-80, -30]]) {
    await page.mouse.click(640 + dx, 400 + dy)
    await page.waitForTimeout(1500)
    if (!(await page.$eval('#app', (el) => el.hidden))) break
  }
  await setTime(11 * 60)
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${out}/osm-scene.png` })
  console.log(`saved to ${out}/`)
} finally {
  await browser.close()
  await server.close()
}
