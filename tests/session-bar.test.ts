import type { On, RenderElement, RenderPropsOf } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'

import { filledCells, hitRatio, human, lineDelta, meterLayout, modelName, untilReset } from '../hooks/format'

const NOW = Date.parse('2026-10-13T12:00:00Z')
const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 160 } as unknown as RenderPropsOf['AbovePrompt'],
} as const

// Stands in for the engine beneath the mod: the session, git, files, clock.
function stubEngine(on: On) {
  on('ui.render', ($, e) => h($.ui.resolve(e).Box, {}) as RenderElement)
  on('session.cwd', () => ({ value: '/work/claude-mods' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: {
    startedAt: NOW,
    context: { tokens: 420_000, window: 1_000_000, percent: 42 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 63, resetsAt: new Date(NOW + (2 * 3600 + 5 * 60) * 1000).toISOString() },
    ],
    cost: { usd: 3.456 },
  } }))
  on('clock.now', () => ({ value: NOW }))
  on('clock.every', () => ({ value: undefined }))
  on('env.get', () => ({ value: '/home/me' }))
  on('process.run', (_$, e) => {
    const args = e.argv.join(' ')
    const stdout = args.includes('--show-toplevel')
      ? '/work/claude-mods\n/work/claude-mods/.git'
      : args.includes('symbolic-ref')
        ? 'main'
        : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
}

describe('format', () => {
  test('helpers match the shell script', async () => {
    expect(human(128_900)).toBe('128.9k')
    expect(human(1_000_000)).toBe('1M')
    expect(filledCells(0)).toBe(0)
    expect(filledCells(1)).toBe(1)
    expect(filledCells(42)).toBe(4)
    expect(filledCells(150)).toBe(10)
    expect(untilReset(NOW + 3 * 86400_000 + 14 * 3600_000, NOW)).toBe('3d14h')
    expect(untilReset(NOW + 12 * 60_000, NOW)).toBe('12m')
    expect(untilReset(NOW - 1, NOW)).toBe('now')
    expect(lineDelta('a\nb\nc', 'a\nB\nc\nd')).toEqual({ added: 2, removed: 1 })
    expect(lineDelta('', 'x\ny\n')).toEqual({ added: 2, removed: 0 })
    expect(modelName('claude-opus-5-5')).toBe('Opus 5.5')
    expect(modelName('claude-sonnet-5-5[1m]')).toBe('Sonnet 5.5')
    expect(modelName('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
    expect(modelName('opus')).toBe('opus')
    // wide: three columns with long bars; medium: shorter bars; narrow: stacked
    const three = ['Ctx', '5h', '7d']
    expect(meterLayout(160, three)).toEqual({ isRow: true, barCells: 24, labelCells: 3 })
    expect(meterLayout(100, three)).toEqual({ isRow: true, barCells: 14, labelCells: 3 })
    expect(meterLayout(70, three)).toEqual({ isRow: false, barCells: 30, labelCells: 3 })
    expect(meterLayout(30, three)).toEqual({ isRow: false, barCells: 14, labelCells: 3 })
    expect(meterLayout(160, [...three, 'spend'])).toEqual({ isRow: true, barCells: 19, labelCells: 5 })
    expect(meterLayout(160, ['Ctx'])).toEqual({ isRow: false, barCells: 30, labelCells: 3 })
    expect(hitRatio({ input_tokens: 10, cache_read_input_tokens: 90, cache_creation_input_tokens: 0 })).toBe(0.9)
  })
})

test('band stays empty before the session has started', async ($, on) => {
  stubEngine(on)
  const ui = await $.ui.mount({ plugin: 'session-bar', surface: 'desktop', ...BAND })
  expect(await ui.find({ type: 'Text', text: /Ctx/ })).toBeUndefined()
  await ui.unmount()
})

test('band draws the session line on terminal and desktop', async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: '/work/claude-mods', surface: 'desktop', isInteractive: true } as never)
  await $.turn.complete({
    answer: '',
    durationMs: 1000,
    isAborted: false,
    turnId: 't1',
    reason: 'answer',
    usage: { model: 'opus', input_tokens: 7, output_tokens: 50, cache_read_input_tokens: 93, cache_creation_input_tokens: 0 },
  } as never)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'session-bar', surface, ...BAND })
    const ctx = (await ui.find({ key: 'ctx' }))?.text ?? ''
    expect(ctx).toContain('Ctx')
    // 42% of a 24-cell bar (160 columns, three meters side by side)
    expect((await ui.find({ key: 'ctx-bar' }))?.props.width).toBe(24)
    if (surface === 'terminal') {
      expect(ctx).toContain('█'.repeat(24))
    } else {
      const svg = String((await ui.find({ type: 'Svg' }))?.props.source)
      expect(svg).toContain('width="384"') // 24 cells
      expect(svg).toContain('<rect width="161.3"') // 42% of it
    }
    expect(ctx).toContain('42%')
    expect((await ui.find({ key: 'limit-5h' }))?.text).toMatch(/63%\s*2h05m/)
    const where = (await ui.find({ key: 'where' }))?.text ?? ''
    expect(where).toContain('claude-mods:main')
    expect(where).toContain('Opus 5.5 (1M)')
    const spend = (await ui.find({ key: 'spend' }))?.text ?? ''
    expect(spend).toContain('$3.46')
    expect(spend).toContain('cache 93%')
    expect((await ui.find({ key: 'meters' }))?.props.flexDirection).toBe('row')
    await ui.unmount()
  }
})
