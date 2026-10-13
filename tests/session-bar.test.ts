import type { On, RenderElement, RenderPropsOf } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import {
  barCellColors,
  barSvg,
  CONTEXT_NOTE_CELLS,
  filledCells,
  growthLabel,
  hitRatio,
  human,
  LIMIT_NOTE_CELLS,
  lineDelta,
  meterLayout,
  modelName,
  pillSvg,
  plusDollars,
  untilReset,
} from '../hooks/format'
import { barTrack, effortHex, gradientAt, growthHex, levelHex, modelHex, palette } from '../hooks/palette'

const NOW = Date.parse('2026-10-13T12:00:00Z')
const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 160 } as unknown as RenderPropsOf['AbovePrompt'],
} as const

// Stands in for the engine beneath the mod: the session, git, settings and
// clock. Each usage read reports a bit more context and cost than the last,
// as consecutive turns would.
function stubEngine(on: On, { isDirty = false } = {}) {
  let reads = 0
  on('ui.render', ($, e) => h($.ui.resolve(e).Box, {}) as RenderElement)
  on('session.cwd', () => ({ value: '/work/claude-mods' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => {
    reads += 1
    return {
      value: {
        startedAt: NOW,
        context: { tokens: 400_000 + reads * 20_000, window: 1_000_000, percent: 40 + reads * 2 },
        rateLimits: [
          { kind: 'five_hour', percentUsed: 63, resetsAt: new Date(NOW + (2 * 3600 + 5 * 60) * 1000).toISOString() },
          { kind: 'seven_day', percentUsed: 85, resetsAt: new Date(NOW + 3 * 86400_000).toISOString() },
        ],
        cost: { usd: 3 + reads * 0.25 },
      },
    }
  })
  on('config.list', () => ({ value: [{ key: 'theme', value: 'dark' }] as never }))
  on('clock.now', () => ({ value: NOW }))
  on('clock.every', () => ({ value: undefined }))
  on('process.run', (_$, e) => {
    const args = e.argv.join(' ')
    const stdout = args.includes('--show-toplevel')
      ? '/work/claude-mods\n/work/claude-mods/.git'
      : args.includes('symbolic-ref')
        ? 'main'
        : args.includes('status')
          ? isDirty
            ? ' M hooks/register.tsx'
            : ''
          : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
}

// Two turns, so there is a last turn's growth and cost to show.
async function twoTurns($: Engine) {
  await $.session.start({ cwd: '/work/claude-mods', surface: 'desktop', isInteractive: true } as never)
  for (const turnId of ['t1', 't2']) {
    await $.turn.complete({
      answer: '',
      durationMs: 1000,
      isAborted: false,
      turnId,
      reason: 'answer',
      usage: { model: 'opus', input_tokens: 3, output_tokens: 50, cache_read_input_tokens: 97, cache_creation_input_tokens: 0 },
    } as never)
  }
}

const THREE = [
  { label: 'Ctx', noteCells: CONTEXT_NOTE_CELLS },
  { label: '5h', noteCells: LIMIT_NOTE_CELLS },
  { label: '7d', noteCells: LIMIT_NOTE_CELLS },
]

describe('format', () => {
  test('numbers, times and names', async () => {
    expect(human(128_900)).toBe('128.9k')
    expect(human(1_000_000)).toBe('1M')
    expect(untilReset(NOW + 3 * 86400_000 + 14 * 3600_000, NOW)).toBe('3d14h')
    expect(untilReset(NOW + 12 * 60_000, NOW)).toBe('12m')
    expect(untilReset(NOW - 1, NOW)).toBe('now')
    expect(growthLabel(6.66)).toBe('+6.7%')
    expect(plusDollars(0.25)).toBe('+$0.25')
    expect(modelName('claude-opus-5-5')).toBe('Opus 5.5')
    expect(modelName('claude-sonnet-5-5[1m]')).toBe('Sonnet 5.5')
    expect(modelName('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
    expect(modelName('opus')).toBe('opus')
    expect(lineDelta('a\nb\nc', 'a\nB\nc\nd')).toEqual({ added: 2, removed: 1 })
    expect(lineDelta('', 'x\ny\n')).toEqual({ added: 2, removed: 0 })
    expect(hitRatio({ input_tokens: 10, cache_read_input_tokens: 90, cache_creation_input_tokens: 0 })).toBe(0.9)
  })

  test('layout: side by side when the bars fit, else stacked', async () => {
    expect(meterLayout(160, THREE)).toEqual({ isRow: true, barCells: 24, labelCells: 3 })
    expect(meterLayout(100, THREE)).toEqual({ isRow: true, barCells: 12, labelCells: 3 })
    expect(meterLayout(95, THREE)).toEqual({ isRow: true, barCells: 11, labelCells: 3 }) // the desktop's width
    expect(meterLayout(80, THREE)).toEqual({ isRow: false, barCells: 30, labelCells: 3 })
    expect(meterLayout(30, THREE)).toEqual({ isRow: false, barCells: 8, labelCells: 3 })
    expect(meterLayout(160, [{ label: 'Ctx', noteCells: 14 }])).toEqual({ isRow: false, barCells: 30, labelCells: 3 })
  })

  test('bars', async () => {
    expect(filledCells(0)).toBe(0)
    expect(filledCells(1)).toBe(1)
    expect(filledCells(42)).toBe(4)
    expect(filledCells(150)).toBe(10)
    const p = palette('dark')
    const cells = barCellColors(42, 24, 'dark')
    expect(cells).toHaveLength(24)
    expect(cells.filter(c => c.isFilled)).toHaveLength(10)
    // one fixed gradient the fill uncovers: green first, warmer further on,
    // and the cells it has not reached are the blue track
    expect(cells[0]?.color).toBe(p.green)
    expect(cells[9]?.color).toBe(gradientAt([p.green, p.yellow, p.red], 9 / 23))
    expect(cells[23]?.color).toBe(barTrack('dark'))
    expect(barCellColors(100, 24, 'dark')[23]?.color).toBe(p.red)
    const svg = barSvg(42, 24, 'dark')
    expect(svg).toContain('width="192"') // 24 cells at 8px
    expect(svg).toContain('x2="192"') // the gradient spans the whole bar
    expect(svg).toContain('<rect width="80.6" height="12" rx="6" fill="url(#g)"') // 42% of it uncovered
    expect(svg).toContain(`fill="${barTrack('dark')}"`)
    // pills share the bars' corner radius
    const pill = pillSvg('+2.0%', palette('dark').green, palette('dark').onPill)
    expect(pill.source).toContain('rx="6"')
    expect(pill.source).toContain('>+2.0%</text>')
    expect(pill.width).toBe(52)
  })
})

describe('palette', () => {
  test('colours follow level, effort and model', async () => {
    const p = palette('dark')
    expect(levelHex('dark', 0)).toBe(p.green)
    expect(levelHex('dark', 50)).toBe(p.yellow)
    expect(levelHex('dark', 100)).toBe(p.red)
    expect(growthHex('dark', 0.5)).toBe(p.green)
    expect(growthHex('dark', 12)).toBe(p.red)
    expect(effortHex('dark', 'medium')).toBe(p.green)
    expect(effortHex('dark', 'max')).toBe(p.red)
    expect(modelHex('dark', 'Opus 5.5')).toBe(p.mauve)
    expect(modelHex('light', 'Sonnet 5.5')).toBe(palette('light').blue)
    expect(gradientAt(['#000000', '#ffffff'], 0.5)).toBe('#808080')
  })
})

test('band stays empty before the session has started', async ($, on) => {
  stubEngine(on)
  const ui = await $.ui.mount({ plugin: 'session-bar', surface: 'desktop', ...BAND })
  expect(await ui.find({ type: 'Text', text: /Ctx/ })).toBeUndefined()
  await ui.unmount()
})

test('band draws meters and details on terminal and desktop', async ($, on) => {
  stubEngine(on, { isDirty: true })
  await twoTurns($)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'session-bar', surface, ...BAND })
    const ctx = (await ui.find({ key: 'ctx' }))?.text ?? ''
    expect(ctx).toContain('Ctx')
    expect(ctx).toMatch(/\d+%/)
    expect(ctx).toContain('97%') // cache
    expect((await ui.find({ key: 'limit-5h' }))?.text).toMatch(/63%\s*2h05m/)
    expect((await ui.find({ key: 'limit-7d' }))?.text).toMatch(/85%\s*3d0h/)
    const where = (await ui.find({ key: 'where' }))?.text ?? ''
    expect(where).toContain('claude-mods:main*')
    expect(where).toContain('Opus 5.5 (1M)')
    const spend = (await ui.find({ key: 'spend' }))?.text ?? ''
    expect(spend).toContain('+$0.25')
    expect((await ui.find({ key: 'meters' }))?.props.flexDirection).toBe('row')
    // a separator between each pair of meters, none at the ends
    const row = (await ui.find({ key: 'meters' }))?.text ?? ''
    expect(row.split('·')).toHaveLength(3)
    expect(row.trim().startsWith('Ctx')).toBe(true)
    if (surface === 'terminal') {
      expect(ctx).toContain('+2.0%') // 20k of a 1M window in the last turn
      expect(spend).toContain('$')
      expect(ctx).toContain('█')
      expect(ctx).not.toContain('') // no Nerd Font glyphs unless asked
      expect(ctx).toContain('⚡')
    } else {
      expect(String((await ui.find({ type: 'Svg' }))?.props.source)).toContain('linearGradient')
      expect(JSON.stringify((await ui.find({ key: 'growth' }))?.children)).toContain('+2.0%') // the growth pill
      expect(JSON.stringify((await ui.find({ key: 'session-cost' }))?.children)).toContain('rx=\\"6\\"')
    }
    await ui.unmount()
  }
})

test('Nerd Font glyphs in the terminal only, when the option is on', { options: { nerdFont: true } }, async ($, on) => {
  stubEngine(on)
  await twoTurns($)

  const terminal = await $.ui.mount({ plugin: 'session-bar', surface: 'terminal', ...BAND })
  const ctx = (await terminal.find({ key: 'ctx' }))?.text ?? ''
  expect(ctx).toContain('')
  expect(ctx).toContain('')
  expect((await terminal.find({ key: 'where' }))?.text).toContain('claude-mods:main')
  expect((await terminal.find({ key: 'where' }))?.text).not.toContain('main*')
  await terminal.unmount()

  const desktop = await $.ui.mount({ plugin: 'session-bar', surface: 'desktop', ...BAND })
  expect((await desktop.find({ key: 'ctx' }))?.text).not.toContain('')
  await desktop.unmount()
})
