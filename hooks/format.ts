// Pure helpers shared by the hooks module and its tests.

export type Level = 'success' | 'warning' | 'error'

// green < 50, yellow < 80, red otherwise
export const levelColor = (percent: number): Level =>
  percent >= 80 ? 'error' : percent >= 50 ? 'warning' : 'success'

// Cache hits: green >= 80%, yellow >= 50%, red below
export const hitColor = (ratio: number): Level =>
  ratio >= 0.8 ? 'success' : ratio >= 0.5 ? 'warning' : 'error'

// 10-cell bar: how many cells are filled; any usage shows at least one
export const filledCells = (percent: number, width = 10): number => {
  const p = Math.max(0, Math.floor(percent))
  let filled = Math.floor((p * width + 50) / 100)
  if (p > 0 && filled === 0) filled = 1
  return Math.min(filled, width)
}

// Fixed widths of a meter's parts, in cells: percentage, note, and the gaps
// between the parts; the label column is as wide as the longest label shown.
// Meters sit METER_GAP apart.
export const PERCENT_CELLS = 4
export const NOTE_CELLS = 6
export const METER_GAP = 4
const MIN_BAR = 10
const MAX_BAR_ROW = 24
const MAX_BAR_STACKED = 30

// Side by side in equal columns when every meter gets at least a 10-cell
// bar, else stacked; either way the bars are as long as the room allows.
export const meterLayout = (
  columns: number,
  labels: readonly string[],
): { isRow: boolean; barCells: number; labelCells: number } => {
  const labelCells = Math.max(0, ...labels.map(l => l.length))
  const fixed = labelCells + PERCENT_CELLS + NOTE_CELLS + 3
  const count = labels.length
  const clamp = (n: number, max: number) => Math.max(MIN_BAR, Math.min(max, Math.floor(n)))
  if (count > 1) {
    const perMeter = (columns - (count - 1) * METER_GAP) / count
    if (perMeter - fixed >= MIN_BAR) return { isRow: true, barCells: clamp(perMeter - fixed, MAX_BAR_ROW), labelCells }
  }
  return { isRow: false, barCells: clamp(columns - fixed, MAX_BAR_STACKED), labelCells }
}

// Bar colours for the SVG, where theme keys do not reach: the same green,
// amber and red at every level, readable on light and dark backgrounds.
const BAR_COLORS: Record<Level, string> = { success: '#4caf50', warning: '#e0a526', error: '#e5534b' }
export const BAR_PX = 10

// A rounded track with a rounded fill at the exact percentage. The markup is
// a little wider than the slot (16px a cell) so the slot sets the drawn width,
// and only a little, so `none` squeezes the round ends hardly at all.
export const barSvg = (percent: number, cells: number): string => {
  const p = Math.max(0, Math.min(100, percent))
  const w = cells * 16
  const fill = p > 0 ? Math.max(BAR_PX, (w * p) / 100) : 0
  const r = BAR_PX / 2
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${BAR_PX}" viewBox="0 0 ${w} ${BAR_PX}" preserveAspectRatio="none">` +
    `<rect width="${w}" height="${BAR_PX}" rx="${r}" fill="#8a8a8a" fill-opacity="0.35"/>` +
    (fill > 0 ? `<rect width="${fill.toFixed(1)}" height="${BAR_PX}" rx="${r}" fill="${BAR_COLORS[levelColor(p)]}"/>` : '') +
    `</svg>`
  )
}

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
