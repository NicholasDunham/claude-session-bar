// Colours. Raw hex rather than theme keys so the bars, pills and the
// terminal's per-cell gradients look the same on every surface. Two sets,
// picked by the Claude Code theme: pastels for dark themes, deeper tones of
// the same hues for light ones (Catppuccin Mocha and Latte).

export type Tone = 'dark' | 'light'

type Palette = {
  green: string
  yellow: string
  peach: string
  red: string
  sky: string
  blue: string
  lavender: string
  mauve: string
  teal: string
  pink: string
  /** What the empty part of a bar is mixed toward. */
  track: string
  /** Text on a pill. */
  onPill: string
}

const PALETTES: Record<Tone, Palette> = {
  dark: {
    green: '#a6e3a1',
    yellow: '#f9e2af',
    peach: '#fab387',
    red: '#f38ba8',
    sky: '#89dceb',
    blue: '#89b4fa',
    lavender: '#b4befe',
    mauve: '#cba6f7',
    teal: '#94e2d5',
    pink: '#f5c2e7',
    track: '#313244',
    onPill: '#1e1e2e',
  },
  light: {
    green: '#40a02b',
    yellow: '#df8e1d',
    peach: '#fe640b',
    red: '#d20f39',
    sky: '#04a5e5',
    blue: '#1e66f5',
    lavender: '#7287fd',
    mauve: '#8839ef',
    teal: '#179299',
    pink: '#ea76cb',
    track: '#ccd0da',
    onPill: '#eff1f5',
  },
}

export const palette = (tone: Tone): Palette => PALETTES[tone]

// Bars: one fixed gradient across the whole bar, green at the start, yellow
// halfway, red at the end. The fill uncovers it from the left, so a fuller bar
// shows more of it and ends in a warmer colour.
export const barGradient = (tone: Tone): string[] => {
  const p = PALETTES[tone]
  return [p.green, p.yellow, p.red]
}

// The part of a bar the fill has not reached: a muted blue.
export const barTrack = (tone: Tone): string => mix(PALETTES[tone].blue, PALETTES[tone].track, tone === 'dark' ? 0.72 : 0.55)

// The colour of a meter's percentage: the gradient where the fill ends.
export const levelHex = (tone: Tone, percent: number): string =>
  gradientAt(barGradient(tone), Math.max(0, Math.min(100, percent)) / 100)

// Context growth in one turn, as a share of the window.
export const growthHex = (tone: Tone, percent: number): string => {
  const p = PALETTES[tone]
  return percent >= 10 ? p.red : percent >= 5 ? p.peach : percent >= 2 ? p.yellow : p.green
}

// Session cost, in dollars.
export const costHex = (tone: Tone, usd: number): string => {
  const p = PALETTES[tone]
  return usd >= 20 ? p.red : usd >= 5 ? p.peach : usd >= 1 ? p.yellow : p.green
}

// Cache hits: green from 80%, yellow from 50%, red below.
export const hitHex = (tone: Tone, ratio: number): string => {
  const p = PALETTES[tone]
  return ratio >= 0.8 ? p.green : ratio >= 0.5 ? p.yellow : p.red
}

// Effort, coolest to hottest.
export const effortHex = (tone: Tone, level: string): string => {
  const p = PALETTES[tone]
  const byLevel: Record<string, string> = { low: p.sky, medium: p.green, high: p.yellow, xhigh: p.peach, max: p.red }
  return byLevel[level] ?? p.lavender
}

// Model family, by the first word of its name (Opus 5.5 -> Opus).
export const modelHex = (tone: Tone, name: string): string => {
  const p = PALETTES[tone]
  const byFamily: Record<string, string> = { Opus: p.mauve, Sonnet: p.blue, Haiku: p.teal, Fable: p.pink }
  return byFamily[name.split(' ')[0] ?? ''] ?? p.lavender
}

// Branch: green when the working tree is clean, yellow when it has changes.
export const branchHex = (tone: Tone, isDirty: boolean): string =>
  isDirty ? PALETTES[tone].yellow : PALETTES[tone].green

const parse = (hex: string): [number, number, number] => {
  const n = Number.parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const toHex = (rgb: number[]): string =>
  `#${rgb.map(c => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, '0')).join('')}`

// `a` moved a share `t` (0 to 1) of the way toward `b`.
export const mix = (a: string, b: string, t: number): string => {
  const [x, y] = [parse(a), parse(b)]
  return toHex(x.map((c, i) => c + ((y[i] ?? c) - c) * t))
}

// The colour at position `t` (0 to 1) along a gradient of stops.
export const gradientAt = (stops: readonly string[], t: number): string => {
  if (stops.length === 1) return stops[0] ?? '#000000'
  const scaled = Math.max(0, Math.min(1, t)) * (stops.length - 1)
  const i = Math.min(Math.floor(scaled), stops.length - 2)
  return mix(stops[i] ?? '#000000', stops[i + 1] ?? '#000000', scaled - i)
}
