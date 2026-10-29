// Records the README demo: docs/demo.mp4, docs/demo.gif and docs/screenshot-*.png.
// Usage: npm run demo   (Chromium from `npm run shots:install`)
// Requires system ffmpeg (/usr/bin/ffmpeg, or set FFMPEG=/path/to/ffmpeg).
// Offline except for the map tiles: Overpass and Nominatim are answered from fixtures/.
// SwiftShader WebGL is slow, so nothing is recorded in real time: every frame is a page.screenshot()
// taken after a small deterministic step (a click, a time-slider tick, a mouse drag), then assembled by ffmpeg.
// Set DEMO_STOP=<segment> (map | plan | sun | walk) to stop early while iterating; media is not written then.
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, copyFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const FFMPEG = process.env.FFMPEG ?? '/usr/bin/ffmpeg'
const STOP = process.env.DEMO_STOP
const FPS = 15
const HOLD_SCALE = 1.4 // stretches every hold of 2+ frames so the clip is long enough to read
const root = new URL('../', import.meta.url)
const docs = new URL('docs/', root).pathname
const fixture = (name) => readFileSync(new URL(`fixtures/${name}`, root), 'utf8')
mkdirSync(docs, { recursive: true })
const framesDir = mkdtempSync(join(tmpdir(), 'sun-demo-'))

const server = await createServer({ root: root.pathname, server: { port: 5183, strictPort: true }, logLevel: 'error' })
await server.listen()
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
let frameCount = 0
let assembled = false
const marks = {} // frame index where each narrated segment starts, for the GIF cut
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  page.setDefaultTimeout(180000)
  page.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text()) })
  page.on('pageerror', (e) => console.log('pageerror:', e.message))
  let release
  const released = new Promise((done) => { release = done })
  await page.route(/\/api\/interpreter$/, async (r) => {
    await released
    await r.fulfill({ contentType: 'application/json', body: fixture('overpass-milan-duomo.json') })
  })
  await page.route(/nominatim\.openstreetmap\.org\/search/, (r) =>
    r.fulfill({ contentType: 'application/json', body: fixture('nominatim-palazzo-reale.json') }))

  // ---- helpers ---------------------------------------------------------------------------
  async function snap(hold = 1) {
    const buf = await page.screenshot({ type: 'jpeg', quality: 93 })
    for (let i = 0; i < Math.round(hold * HOLD_SCALE); i++) writeFileSync(join(framesDir, `f${String(frameCount++).padStart(5, '0')}.jpg`), buf)
  }
  const still = (name) => page.screenshot({ path: `${docs}screenshot-${name}.png` })
  const setTime = (min) => page.$eval('#time', (el, v) => { el.value = String(v); el.dispatchEvent(new Event('input')) }, min)
  const setDate = (v) => page.$eval('#date', (el, d) => { el.value = d; el.dispatchEvent(new Event('input')) }, v)

  await page.addInitScript(() => {
    addEventListener('DOMContentLoaded', () => {
      const st = document.createElement('style')
      st.textContent = `
        #demo-caption{position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:99999;pointer-events:none;
          font:600 24px/1.2 system-ui,sans-serif;color:#fff;background:rgba(20,24,32,.82);padding:9px 20px;border-radius:999px;
          box-shadow:0 2px 10px rgba(0,0,0,.35);white-space:nowrap}
        #demo-cursor{position:fixed;z-index:99999;pointer-events:none;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;
          background:rgba(255,196,0,.9);border:2px solid #fff;box-shadow:0 0 6px rgba(0,0,0,.6);left:-50px;top:-50px}`
      document.head.appendChild(st)
      const cap = document.createElement('div'); cap.id = 'demo-caption'; cap.hidden = true
      const cur = document.createElement('div'); cur.id = 'demo-cursor'
      document.body.append(cap, cur)
    })
  })
  const caption = (text) => page.evaluate((t) => { const c = document.getElementById('demo-caption'); c.textContent = t; c.hidden = !t }, text)
  const cursor = { x: 640, y: 360 }
  const showCursor = (x, y) => page.evaluate(([a, b]) => {
    let c = document.getElementById('demo-cursor')
    if (!c) { c = document.createElement('div'); c.id = 'demo-cursor'; document.body.appendChild(c) } // the app can rebuild body children
    c.style.left = a + 'px'; c.style.top = b + 'px' }, [x, y])
  const hideCursor = () => showCursor(-50, -50)
  /** Glides the real pointer and the fake cursor to (x, y), one frame per step. */
  async function glide(x, y, steps = 4) {
    const { x: x0, y: y0 } = cursor
    for (let i = 1; i <= steps; i++) {
      const t = i / steps
      const e = t * t * (3 - 2 * t)
      const cx = x0 + (x - x0) * e, cy = y0 + (y - y0) * e
      await page.mouse.move(cx, cy)
      await showCursor(cx, cy)
      await snap()
    }
    cursor.x = x; cursor.y = y
  }
  async function clickAt(x, y, { steps = 4, hold = 2, dbl = false } = {}) {
    await glide(x, y, steps)
    if (dbl) await page.mouse.dblclick(x, y)
    else await page.mouse.click(x, y)
    await page.waitForTimeout(150)
    await snap(hold)
  }
  async function clickEl(locator, opts) {
    const b = await locator.boundingBox()
    await clickAt(b.x + b.width / 2, b.y + b.height / 2, opts)
  }
  const doneChip = () => page.waitForFunction(() => document.querySelector('#statusChip:not([hidden])')?.dataset.kind === 'done', null, { polling: 50, timeout: 180000 })

  const ffmpeg = (...args) => execFileSync(FFMPEG, ['-v', 'error', '-y', ...args], { stdio: 'inherit' })
  const kb = (file) => Math.round(statSync(file).size / 1024)
  /** mp4 of every frame, a shorter GIF of the highlights, and stills squeezed under 600 KB if needed. */
  async function assemble() {
    const mp4 = `${docs}demo.mp4`
    ffmpeg('-framerate', String(FPS), '-i', join(framesDir, 'f%05d.jpg'), '-vf', 'scale=1280:720:in_range=pc:out_range=tv,format=yuv420p',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '24', '-movflags', '+faststart', mp4)
    console.log(`demo.mp4  ${kb(mp4)} KB, ${(frameCount / FPS).toFixed(1)} s`)

    // GIF: each segment is sampled evenly down to a frame budget (a speed-up), then played at 12 fps
    const budget = [['map', 'plan', 60], ['plan', 'sun', 80], ['sun', 'walk', 100], ['walk', 'end', 90]]
    const gifDir = join(framesDir, 'gif')
    mkdirSync(gifDir)
    let n = 0
    for (const [from, to, count] of budget) {
      const a = marks[from], b = marks[to]
      for (let i = 0; i < count; i++) {
        const src = a + Math.floor(((b - a) * i) / count)
        copyFileSync(join(framesDir, `f${String(src).padStart(5, '0')}.jpg`), join(gifDir, `g${String(n++).padStart(4, '0')}.jpg`))
      }
    }
    const gif = `${docs}demo.gif`
    for (const [width, colors] of [[960, 192], [960, 128], [880, 128], [800, 96]]) {
      ffmpeg('-framerate', '12', '-i', join(gifDir, 'g%04d.jpg'), '-vf',
        `scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=${colors}:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
        '-loop', '0', gif)
      console.log(`demo.gif  ${kb(gif)} KB (${width}px, ${colors} colours, ${(n / 12).toFixed(1)} s)`)
      if (statSync(gif).size <= 10 * 1024 * 1024) break
    }
    if (statSync(mp4).size > 8 * 1024 * 1024) console.log('WARNING: demo.mp4 is over 8 MB, raise -crf')

    for (const name of ['map', 'plan', 'cutaway', 'walk']) {
      const png = `${docs}screenshot-${name}.png`
      if (statSync(png).size <= 600 * 1024) { console.log(`screenshot-${name}.png ${kb(png)} KB`); continue }
      const small = join(framesDir, `${name}.png`)
      ffmpeg('-i', png, '-vf', 'split[a][b];[a]palettegen=max_colors=256[p];[b][p]paletteuse=dither=bayer:bayer_scale=5', small)
      copyFileSync(small, png)
      console.log(`screenshot-${name}.png ${kb(png)} KB (quantised)`)
    }
  }

  segments: {
  // ---- 1. map: search, pick -----------------------------------------------------------------
  await page.goto('http://localhost:5183/app/')
  await setDate('2026-12-21')
  await page.waitForTimeout(6000)
  await caption('1 · Find your building')
  marks.map = frameCount
  await snap(14)
  await clickEl(page.locator('#search input'))
  for (const ch of 'Palazzo Reale') {
    await page.keyboard.type(ch)
    await snap(1)
  }
  await snap(3)
  await clickEl(page.locator('#search button'))
  await page.waitForSelector('#results li')
  await snap(10)
  await clickEl(page.locator('#results li'), { steps: 6 })
  for (let i = 0; i < 10; i++) { await page.waitForTimeout(500); await snap() }
  await page.waitForTimeout(2500)
  await hideCursor()
  await snap(14)
  await still('map')
  const useBtn = page.getByRole('button', { name: 'Use this building' })
  await clickEl(useBtn, { steps: 6 })
  await hideCursor()
  // ---- 2. instant 3D, then detailed OSM ----------------------------------------------------
  await setTime(11 * 60) // sun at 11:00 until the time-lapse
  // hold the Overpass answer back a few seconds (wall clock: the app gives up on a request after 15 s)
  const t0 = Date.now()
  do { await page.waitForTimeout(300); await snap(2) } while (Date.now() - t0 < 5000)
  release()
  await doneChip()
  await page.waitForTimeout(600)
  await snap(14)
  if (STOP === 'map') break segments

  // ---- 3. plan: floor, outline, windows, wall ----------------------------------------------
  await caption('2 · Sketch your apartment')
  marks.plan = frameCount
  await clickEl(page.locator('#views [data-view="plan"]'))
  await page.waitForTimeout(500)
  await snap(8)
  const floorInput = page.locator('.editor input[type="number"]').first()
  await clickEl(floorInput)
  await floorInput.fill('1')
  await floorInput.press('Enter')
  await page.waitForTimeout(300)
  await snap(8)

  // Metres in the plan (x east, z south) to screen pixels, read from the live SVG.
  const planGeo = () => page.evaluate(() => {
    const path = document.querySelector('.editor svg path[data-role="outline"]')
    const m = path.getScreenCTM()
    const nums = path.getAttribute('d').split('M').filter(Boolean)[0].match(/-?[\d.]+(?:e-?\d+)?/g).map(Number)
    const ring = []
    for (let i = 0; i < nums.length; i += 2) ring.push({ x: nums[i], z: nums[i + 1] })
    return { ring, k: m.a, ox: m.e, oy: m.f }
  })
  // The long outer edge that faces south-west the most (outward normal near azimuth 225): the sunny facade.
  const { ring } = await planGeo()
  const inside = (p, poly) => {
    let c = false
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      if ((poly[i].z > p.z) !== (poly[j].z > p.z) && p.x < ((poly[j].x - poly[i].x) * (p.z - poly[i].z)) / (poly[j].z - poly[i].z) + poly[i].x) c = !c
    }
    return c
  }
  let facade
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length]
    const len = Math.hypot(b.x - a.x, b.z - a.z)
    const u = { x: (b.x - a.x) / len, z: (b.z - a.z) / len }
    let n = { x: -u.z, z: u.x }
    const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }
    if (inside({ x: mid.x + n.x * 0.5, z: mid.z + n.z * 0.5 }, ring)) { /* n points inward */ } else n = { x: -n.x, z: -n.z }
    const score = len * Math.max(0, -n.x * -0.707 + -n.z * 0.707) // outward = -n, sun direction (west, south)
    if (!facade || score > facade.score) facade = { a, u, n, len, score }
  }
  console.log('facade', facade.a, 'len', facade.len.toFixed(1))
  // apartment frame: s metres along the facade, d metres inward
  const at = (s, d) => ({ x: facade.a.x + facade.u.x * s + facade.n.x * d, z: facade.a.z + facade.u.z * s + facade.n.z * d })
  const center = at(14, 5)
  // zoom the plan around the apartment
  let g = await planGeo()
  const px = (p) => ({ x: g.ox + p.x * g.k, y: g.oy + p.z * g.k })
  await glide(px(center).x, px(center).y, 6)
  await page.mouse.wheel(0, -1000)
  await page.waitForTimeout(400)
  g = await planGeo()
  await snap(6)

  await clickEl(page.getByRole('button', { name: /^Outline\b/ }))
  const corners = [at(8, 0), at(20, 0), at(20, 10), at(8, 10)]
  for (const c of corners) { const q = px(c); await clickAt(q.x, q.y, { steps: 4 }) }
  const q0 = px(corners[0])
  await clickAt(q0.x, q0.y, { steps: 4 })
  await page.waitForTimeout(300)
  await snap(8)

  await clickEl(page.getByRole('button', { name: /^Window\b/ }))
  for (const s of [10.4, 14, 17.6]) {
    const q = px(at(s, 0))
    await clickAt(q.x, q.y, { steps: 4, hold: 2 })
    // French-window sizes (the default 1.2 x 1.4 m gives thin patches)
    for (const [label, v] of [['Width (m)', '2'], ['Sill (m)', '0.3'], ['Height (m)', '2']]) {
      const input = page.getByLabel(label, { exact: true })
      await input.fill(v)
      await input.press('Enter')
    }
    await snap(3)
  }
  await clickEl(page.getByRole('button', { name: /^Wall\b/ }))
  // Walls chain: two clicks make the first wall, Esc ends the chain.
  for (const [s, d] of [[8, 6], [14, 6]]) { const q = px(at(s, d)); await clickAt(q.x, q.y, { steps: 4, hold: 3 }) }
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  await snap(4)
  await clickEl(page.getByRole('button', { name: /^Select\b/ }))
  // drag the automatic camera marker (where "Walk inside" starts) deeper into the room
  const cam = await page.evaluate(() => {
    const t = [...document.querySelectorAll('.editor svg title')].find((e) => e.textContent.startsWith('This is where Walk inside'))
    const r = t.parentNode.querySelector('circle').getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })
  await glide(cam.x, cam.y, 6)
  await page.mouse.down()
  const target = px(at(16.5, 7.5))
  const from = { ...cursor }
  for (let i = 1; i <= 6; i++) {
    const x = from.x + ((target.x - from.x) * i) / 6, y = from.y + ((target.y - from.y) * i) / 6
    await page.mouse.move(x, y)
    await showCursor(x, y)
    await snap()
  }
  await page.mouse.up()
  cursor.x = target.x; cursor.y = target.y
  await snap(4)
  await hideCursor()
  await page.mouse.move(900, 600)
  await page.waitForTimeout(400)
  await snap(10)
  await still('plan')
  if (STOP === 'plan') break segments

  // ---- 4. 3D cutaway time-lapse ------------------------------------------------------------
  await caption('3 · Watch the sun move')
  marks.sun = frameCount
  await clickEl(page.locator('#views [data-view="3d"]'))
  await page.waitForTimeout(1000)
  await snap(4)
  await clickEl(page.locator('#presets button[data-id="winter"]'), { steps: 6, hold: 4 }) // 21 Dec
  await hideCursor()
  await page.waitForTimeout(1500)
  await snap(6)
  // Camera moves are real mouse input (OrbitControls: right-drag pans, wheel zooms, left-drag tilts); there is no API for it.
  const rightDrag = async (x0, y0, x1, y1) => {
    await page.mouse.move(x0, y0)
    await page.mouse.down({ button: 'right' })
    await page.mouse.move(x1, y1, { steps: 8 })
    await page.mouse.up({ button: 'right' })
  }
  // The start view is the app's own framing of the building (SE side, ~35 deg). Move the apartment to the right of
  // the panel, tilt a little and zoom until the sun patches are readable but neighbours and their shadows stay in view.
  await rightDrag(510, 400, 655, 358) // apartment onto the orbit centre (it sits at ~495,397 in the start view), so zooming keeps it in view
  await page.mouse.move(640, 360)
  await page.mouse.down()
  await page.mouse.move(640, 385, { steps: 6 })
  await page.mouse.up()
  await page.mouse.move(640, 360)
  await page.mouse.wheel(0, -2100)
  await page.waitForTimeout(300)
  await page.mouse.wheel(0, -900)
  await page.waitForTimeout(800)
  await setTime(10 * 60 + 30)
  await page.waitForTimeout(1500)
  await snap(10)
  // time-lapse: 21 December, 10:30 -> 14:30 in 5 minute steps
  for (let t = 10 * 60 + 30; t <= 14 * 60 + 30; t += 5) {
    await setTime(t)
    await page.waitForTimeout(250)
    await snap(3)
    if (t === 13 * 60) await still('cutaway')
  }
  await snap(10)
  if (STOP === 'sun') break segments

  // ---- 5. walk inside -----------------------------------------------------------------------
  await caption('4 · Step inside')
  marks.walk = frameCount
  await setTime(12 * 60 + 30)
  await clickEl(page.getByRole('button', { name: 'Walk inside' }))
  await hideCursor()
  await page.waitForTimeout(1500)
  await snap(10)
  const lookDrag = async (dx, dy = 0, steps = 6) => {
    await page.mouse.move(640, 400)
    await page.mouse.down()
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(640 + (dx * i) / steps, 400 + (dy * i) / steps)
      await page.waitForTimeout(100)
      await snap()
    }
    await page.mouse.up()
  }
  await still('walk')
  await lookDrag(80, 0, 4)
  await snap(4)
  await lookDrag(-140, 0, 6)
  await snap(4)
  await lookDrag(60, 0, 3)
  for (let k = 0; k < 3; k++) { // ] steps the sun by 15 minutes
    await page.keyboard.press(']')
    await page.waitForTimeout(250)
    await snap(3)
  }
  // drag the HUD time slider: to the afternoon, then back towards noon
  await page.waitForSelector('#walkHud .timeRange', { state: 'visible' })
  const slider = page.locator('#walkHud .timeRange')
  const sb = await slider.boundingBox()
  const thumbX = (min) => sb.x + 8 + (min / 1435) * (sb.width - 16)
  const sy = sb.y + sb.height / 2
  await glide(thumbX(13 * 60 + 15), sy, 5)
  await page.mouse.down()
  for (let i = 1; i <= 12; i++) {
    const x = thumbX(13 * 60 + 15 + ((15.5 * 60 - 13.25 * 60) * i) / 12)
    await page.mouse.move(x, sy); await showCursor(x, sy)
    await page.waitForTimeout(150)
    await snap(2)
  }
  await snap(4)
  for (let i = 1; i <= 12; i++) {
    const x = thumbX(15.5 * 60 - ((15.5 * 60 - 11.5 * 60) * i) / 12)
    await page.mouse.move(x, sy); await showCursor(x, sy)
    await page.waitForTimeout(150)
    await snap(2)
  }
  await page.mouse.up()
  await hideCursor()
  await snap(8)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(1500)
  await snap(14)
  if (STOP === 'walk') break segments

  // ---- 6. assemble ---------------------------------------------------------------------------
  marks.end = frameCount
  await assemble()
  assembled = true
  }
} finally {
  await browser.close()
  await server.close()
  if (STOP || !assembled) console.log(`frames kept in ${framesDir} (${frameCount})`)
  else rmSync(framesDir, { recursive: true, force: true })
}
