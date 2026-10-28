// Headless visual check: renders the map, a picked OSM building
// (Overpass answered from a fixture, or failing) at 11:00, and a walk through the apartment, saving PNGs to the output dir.
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
  // The map starts on the Duomo square; try a few points until one hits a building.
  async function clickBuilding(page) {
    for (const [dx, dy] of [[60, -60], [0, -40], [40, 0], [-40, 0], [0, 40], [80, 30], [-80, -30]]) {
      await page.mouse.click(640 + dx, 400 + dy)
      await page.waitForTimeout(500)
      if (!(await page.$eval('#app', (el) => el.hidden))) return
    }
  }
  const newPage = async (overpass) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    page.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text()) })
    page.on('pageerror', (e) => console.log('pageerror:', e.message))
    await page.route(/\/api\/interpreter$/, overpass) // the three Overpass mirrors
    await page.goto('http://localhost:5179/app/')
    return page
  }
  const setTime = (page, min) =>
    page.$eval('#time', (el, v) => { el.value = String(v); el.dispatchEvent(new Event('input')) }, min)

  // Normal run: Overpass answers from the fixture once released, so the tile preview is visible first.
  let release
  const released = new Promise((done) => { release = done })
  let page = await newPage(async (r) => {
    await released
    await r.fulfill({ contentType: 'application/json', body: fixture })
  })
  // The app opens on the map.
  await page.waitForTimeout(5000)
  await page.screenshot({ path: `${out}/map.png` })
  await clickBuilding(page)
  await setTime(page, 11 * 60)
  await page.waitForTimeout(1000)
  await page.screenshot({ path: `${out}/osm-scene-instant.png` })
  release()
  await page.waitForFunction(() => document.querySelector('#statusChip:not([hidden])')?.dataset.kind === 'done', null, { polling: 50 })
  await page.screenshot({ path: `${out}/osm-scene.png` })

  // Plan: whole-floor outline on the picked building, windows spread along its outer ring.
  await page.click('#views [data-view="plan"]')
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: 'Window', exact: true }).click()
  const spots = await page.evaluate(() => {
    const path = document.querySelector('.editor svg path[data-role="outline"]')
    const m = path.getScreenCTM()
    const len = path.getTotalLength()
    return [0.05, 0.2, 0.35, 0.5, 0.65, 0.8].map((f) => {
      const p = path.getPointAtLength(f * len)
      return { x: p.x * m.a + p.y * m.c + m.e, y: p.x * m.b + p.y * m.d + m.f }
    })
  })
  for (const { x, y } of spots) await page.mouse.click(x, y)
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${out}/plan.png` })
  await page.click('#views [data-view="3d"]')
  await setTime(page, 11 * 60)
  await page.waitForTimeout(2000)
  await page.screenshot({ path: `${out}/plan-3d.png` })

  // Walk inside: start, turn ~90 degrees by dragging, walk forward, step the time forward.
  await page.getByRole('button', { name: 'Walk inside' }).click()
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${out}/walk-1.png` })
  await page.mouse.move(640, 400)
  await page.mouse.down()
  await page.mouse.move(640 + 393, 400, { steps: 10 })
  await page.mouse.up()
  await page.waitForTimeout(1000)
  await page.screenshot({ path: `${out}/walk-2.png` })
  await page.keyboard.down('w')
  await page.waitForTimeout(1500)
  await page.keyboard.up('w')
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${out}/walk-3.png` })
  for (let i = 0; i < 4; i++) await page.keyboard.press(']')
  await page.waitForTimeout(1000)
  await page.screenshot({ path: `${out}/walk-4.png` })
  await page.close()

  // Dev page: standing 8 m from the south windows, looking down a little (winter and summer, 13:00).
  for (const [name, date] of [['winter', '2026-12-21'], ['summer', '2026-06-21']]) {
    page = await newPage((r) => r.abort())
    await page.goto(`http://localhost:5179/dev/apartment.html?date=${date}&time=13:00&walk=1&at=3,-3`)
    await page.waitForFunction(() => window.__ready)
    await page.waitForTimeout(1500)
    await page.mouse.move(640, 300)
    await page.mouse.down()
    await page.mouse.move(640, 380, { steps: 5 })
    await page.mouse.up()
    await page.waitForTimeout(1500)
    await page.screenshot({ path: `${out}/walk-dev-${name}.png` })
    await page.close()
  }

  // Every Overpass mirror fails: the tile scene stays and the chip offers a retry.
  page = await newPage((r) => r.fulfill({ status: 504, body: 'Gateway Timeout' }))
  await page.click('#views [data-view="map"]')
  await page.waitForTimeout(5000)
  await clickBuilding(page)
  await setTime(page, 11 * 60)
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${out}/osm-scene-tiles-only.png` })
  console.log(`saved to ${out}/`)
} finally {
  await browser.close()
  await server.close()
}
