import SunCalc from 'suncalc'
import type { SunDirection } from './sun'
import { sunDirection } from './sun'

const MILAN = { lat: 45.4642, lon: 9.19 }

export function createUI(onSun: (sun: SunDirection) => void): void {
  const now = new Date()
  const panel = document.createElement('div')
  panel.id = 'panel'
  panel.innerHTML = `
    <label>Latitude <input id="lat" type="number" step="0.0001" min="-90" max="90" value="${MILAN.lat}"></label>
    <label>Longitude <input id="lon" type="number" step="0.0001" min="-180" max="180" value="${MILAN.lon}"></label>
    <label>Date <input id="date" type="date" value="${toDateValue(now)}"></label>
    <label>Time <span id="timeLabel"></span>
      <input id="time" type="range" min="0" max="1435" step="5" value="${now.getHours() * 60 + Math.floor(now.getMinutes() / 5) * 5}">
    </label>
    <button id="play" type="button">Play</button>
    <small>Times are the local time of your browser.</small>
    <pre id="readout"></pre>`
  document.body.appendChild(panel)

  const $ = <T extends HTMLElement>(id: string) => panel.querySelector<T>('#' + id)!
  const lat = $<HTMLInputElement>('lat')
  const lon = $<HTMLInputElement>('lon')
  const date = $<HTMLInputElement>('date')
  const time = $<HTMLInputElement>('time')
  const play = $<HTMLButtonElement>('play')

  function currentDate(): Date | null {
    if (!date.value) return null
    const [y, m, d] = date.value.split('-').map(Number)
    const minutes = Number(time.value)
    return new Date(y, m - 1, d, Math.floor(minutes / 60), minutes % 60)
  }

  function refresh() {
    const when = currentDate()
    const la = lat.valueAsNumber
    const lo = lon.valueAsNumber
    $('timeLabel').textContent = formatMinutes(Number(time.value))
    if (!when || Number.isNaN(la) || Number.isNaN(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) {
      $('readout').textContent = 'Invalid latitude, longitude or date'
      return
    }
    const sun = sunDirection(when, la, lo)
    onSun(sun)
    const times = SunCalc.getTimes(when, la, lo)
    $('readout').textContent =
      `Azimuth   ${sun.azimuthDeg.toFixed(1)} deg (from N, clockwise)\n` +
      `Altitude  ${sun.altitudeDeg.toFixed(1)} deg\n` +
      `Sunrise   ${formatTime(times.sunrise)}\n` +
      `Sunset    ${formatTime(times.sunset)}`
  }

  let timer: number | undefined
  play.addEventListener('click', () => {
    if (timer !== undefined) {
      stop()
      return
    }
    play.textContent = 'Pause'
    timer = window.setInterval(() => {
      const next = Number(time.value) + 5
      time.value = String(next > 1435 ? 0 : next)
      refresh()
    }, 50)
  })
  function stop() {
    window.clearInterval(timer)
    timer = undefined
    play.textContent = 'Play'
  }

  for (const el of [lat, lon, date, time]) el.addEventListener('input', refresh)
  time.addEventListener('input', stop)
  refresh()
}

function toDateValue(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function formatMinutes(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
}

function formatTime(d: Date | null): string {
  return d && !Number.isNaN(d.getTime())
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : 'n/a (no event)'
}
