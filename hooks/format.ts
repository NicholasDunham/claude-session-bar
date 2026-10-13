// Pure helpers shared by the hooks module and its tests.

import { barGradient, barTrack, gradientAt, type Tone } from './palette'

// How many of a bar's cells are filled; any usage shows at least one.
export const filledCells = (percent: number, width = 10): number => {
  const p = Math.max(0, Math.floor(percent))
  let filled = Math.floor((p * width + 50) / 100)
  if (p > 0 && filled === 0) filled = 1
  return Math.min(filled, width)
}

// Fixed widths of a meter's parts, in cells: the percentage and the gaps
// between the parts. The label column is as wide as the longest label shown;
// each meter's note has a width of its own (the context meter's holds a pill
// and the cache rate, a limit's a reset time). Meters sit METER_GAP apart,
// a separator in the middle cell.
export const PERCENT_CELLS = 4
export const LIMIT_NOTE_CELLS = 6
export const CONTEXT_NOTE_CELLS = 14
export const METER_GAP = 3
const MIN_BAR = 8
const MAX_BAR_ROW = 24
const MAX_BAR_STACKED = 30

export type MeterShape = { label: string; noteCells: number }

// Side by side when every meter gets at least a 10-cell bar, else stacked;
// either way the bars are as long as the room allows, and all the same length.
export const meterLayout = (
  columns: number,
  meters: readonly MeterShape[],
): { isRow: boolean; barCells: number; labelCells: number } => {
  const labelCells = Math.max(0, ...meters.map(m => m.label.length))
  const fixed = (m: MeterShape) => labelCells + PERCENT_CELLS + m.noteCells + 3
  const count = meters.length
  const clamp = (n: number, max: number) => Math.max(MIN_BAR, Math.min(max, Math.floor(n)))
  if (count > 1) {
    const room = columns - (count - 1) * METER_GAP - meters.reduce((sum, m) => sum + fixed(m), 0)
    if (room / count >= MIN_BAR) return { isRow: true, barCells: clamp(room / count, MAX_BAR_ROW), labelCells }
  }
  const widest = Math.max(0, ...meters.map(fixed))
  return { isRow: false, barCells: clamp(columns - widest, MAX_BAR_STACKED), labelCells }
}

// One corner radius for every rounded shape (bars and pills), in CSS pixels,
// so their curves match. A bar is exactly twice as tall: fully round ends.
export const RADIUS_PX = 6
export const BAR_PX = RADIUS_PX * 2
// The desktop app lays a cell out at 8px, so a bar drawn at 8px a cell fills
// its slot exactly. Were a cell ever narrower, the bar would be scaled down
// evenly, never stretched, so its ends would stay round.
const PX_PER_CELL = 8

const stopsXml = (stops: readonly string[]) =>
  stops.map((c, i) => `<stop offset="${stops.length === 1 ? 0 : i / (stops.length - 1)}" stop-color="${c}"/>`).join('')

// A rounded bar for surfaces with SVG: the fixed gradient spans the whole
// bar and the fill uncovers it from the left; the rest is the muted track.
export const barSvg = (percent: number, cells: number, tone: Tone): string => {
  const p = Math.max(0, Math.min(100, percent))
  const w = Math.round(cells * PX_PER_CELL)
  const fill = p > 0 ? Math.max(BAR_PX, (w * p) / 100) : 0
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${BAR_PX}" viewBox="0 0 ${w} ${BAR_PX}">` +
    `<defs><linearGradient id="g" x1="0" x2="${w}" y1="0" y2="0" gradientUnits="userSpaceOnUse">${stopsXml(barGradient(tone))}</linearGradient></defs>` +
    `<rect width="${w}" height="${BAR_PX}" rx="${RADIUS_PX}" fill="${barTrack(tone)}"/>` +
    (fill > 0 ? `<rect width="${fill.toFixed(1)}" height="${BAR_PX}" rx="${RADIUS_PX}" fill="url(#g)"/>` : '') +
    `</svg>`
  )
}

// A rounded pill for surfaces with SVG: short text on a colour, the same
// corner radius as the bars. `textLength` holds the text to the width the
// pill was sized for, whatever font the surface draws it in.
const PILL_FONT_PX = 13
const PILL_CHAR_PX = 7.6
const PILL_PAD_PX = 7
export const PILL_PX = 20
export const pillSvg = (text: string, bg: string, fg: string): { source: string; width: number } => {
  const textWidth = Math.round(text.length * PILL_CHAR_PX)
  const width = textWidth + PILL_PAD_PX * 2
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  return {
    width,
    source:
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${PILL_PX}" viewBox="0 0 ${width} ${PILL_PX}">` +
      `<rect width="${width}" height="${PILL_PX}" rx="${RADIUS_PX}" fill="${bg}"/>` +
      `<text x="${width / 2}" y="${PILL_PX / 2}" dominant-baseline="central" text-anchor="middle" ` +
      `font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif" font-size="${PILL_FONT_PX}" ` +
      `font-weight="600" font-variant-numeric="tabular-nums" fill="${fg}" ` +
      `textLength="${textWidth}" lengthAdjust="spacingAndGlyphs">${escaped}</text>` +
      `</svg>`,
  }
}

// The terminal's bar, cell by cell, the same way: each filled cell takes the
// gradient's colour at its place along the whole bar; the rest are the track.
export const barCellColors = (percent: number, cells: number, tone: Tone): { color: string; isFilled: boolean }[] => {
  const stops = barGradient(tone)
  const filled = filledCells(percent, cells)
  return Array.from({ length: cells }, (_, i) =>
    i < filled
      ? { color: gradientAt(stops, cells > 1 ? i / (cells - 1) : 0), isFilled: true }
      : { color: barTrack(tone), isFilled: false },
  )
}

// One turn's context growth as a share of the window: +6.7%
export const growthLabel = (percent: number): string => `+${percent.toFixed(1)}%`

// $4.46, and a turn's share of it: +$0.25
export const dollars = (usd: number): string => `$${usd.toFixed(2)}`
export const plusDollars = (usd: number): string => `+$${usd.toFixed(2)}`

// 128900 -> 128.9k, 1000000 -> 1M
export const human = (n: number): string => {
  const trim = (s: string) => s.replace(/\.0$/, '')
  if (n >= 1_000_000) return `${trim((n / 1_000_000).toFixed(1))}M`
  if (n >= 1_000) return `${trim((n / 1_000).toFixed(1))}k`
  return String(n)
}

// ms until a reset -> 4h21m / 3d14h / 12m / now
export const untilReset = (resetsAt: number, now: number): string => {
  const s = Math.floor((resetsAt - now) / 1000)
  if (s <= 0) return 'now'
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}d${h}h`
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}m`
  return `${m}m`
}

const LIMIT_LABELS: Record<string, string> = {
  five_hour: '5h',
  seven_day: '7d',
  spend_limit: 'spend',
}
export const limitLabel = (kind: string): string => LIMIT_LABELS[kind] ?? kind

// Lines added and removed between two texts, counted as a multiset diff of
// lines: close to what a unified diff reports for typical edits.
export const lineDelta = (before: string, after: string): { added: number; removed: number } => {
  const split = (t: string) => (t === '' ? [] : t.replace(/\n$/, '').split('\n'))
  const counts = new Map<string, number>()
  for (const line of split(before)) counts.set(line, (counts.get(line) ?? 0) + 1)
  let added = 0
  for (const line of split(after)) {
    const c = counts.get(line) ?? 0
    if (c > 0) counts.set(line, c - 1)
    else added += 1
  }
  let removed = 0
  for (const c of counts.values()) removed += c
  return { added, removed }
}

// Share of prompt tokens served from the cache
export const hitRatio = (u: {
  input_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}): number | null => {
  const total = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
  return total > 0 ? u.cache_read_input_tokens / total : null
}

export const basename = (p: string): string => p.replace(/\/+$/, '').split('/').pop() ?? p

// claude-opus-5-5 -> Opus 5.5, claude-sonnet-5-5[1m] -> Sonnet 5.5; anything
// that is not a claude-* id (an alias, a display name) is shown as given.
export const modelName = (id: string): string => {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(?:\[[^\]]*\])?$/.exec(id)
  if (!m) return id
  const [, family = '', major = '', minor] = m
  return `${family[0]?.toUpperCase()}${family.slice(1)} ${major}${minor ? `.${minor}` : ''}`
}
