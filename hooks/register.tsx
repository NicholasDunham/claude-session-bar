import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement } from 'claude-code'

import type { ContextTrack, CostTrack, Limit, Lines, Snapshot } from '../types'
import {
  BAR_PX,
  barCellColors,
  barSvg,
  basename,
  CONTEXT_NOTE_CELLS,
  dollars,
  growthLabel,
  hitRatio,
  human,
  LIMIT_NOTE_CELLS,
  limitLabel,
  lineDelta,
  METER_GAP,
  meterLayout,
  modelName,
  PERCENT_CELLS,
  PILL_PX,
  pillSvg,
  plusDollars,
  untilReset,
} from './format'
import {
  branchHex,
  costHex,
  effortHex,
  growthHex,
  hitHex,
  levelHex,
  modelHex,
  palette,
  type Tone,
} from './palette'

const snapshot = atom({ plugin: 'session-bar', key: 'snapshot' } as const, null)
const effort = atom({ plugin: 'session-bar', key: 'effort' } as const, null)
const lines = atom({ plugin: 'session-bar', key: 'lines' } as const, { added: 0, removed: 0 } as Lines)
const context = atom({ plugin: 'session-bar', key: 'context' } as const, { tokens: null, delta: null } as ContextTrack)
const cost = atom({ plugin: 'session-bar', key: 'cost' } as const, { usd: null, delta: null } as CostTrack)
const hit = atom({ plugin: 'session-bar', key: 'hitRatio' } as const, null)
const now = atom({ plugin: 'session-bar', key: 'now' } as const, 0)

// Nerd Font glyphs, drawn only in a terminal and only when the person says
// their font has them: round ends for pills and bars, and a bolt.
// Cells the terminal keeps at the band's right end for its [-] mark.
const ENGINE_MARK_CELLS = 5

const NF = { left: '', right: '', bolt: '' }

async function git($: EngineInterface, cwd: string, args: string[]): Promise<string | null> {
  try {
    const r = await $.process.run(['git', '-C', cwd, '--no-optional-locks', ...args], { timeoutMs: 2000 })
    return r.exitCode === 0 ? r.stdout.trim() : null
  } catch {
    return null
  }
}

// Repo name (the main checkout's, even inside a worktree), branch, worktree,
// and whether the working tree has uncommitted changes.
async function readRepo($: EngineInterface, cwd: string) {
  const paths = await git($, cwd, ['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-common-dir'])
  if (!paths) return { repo: basename(cwd), branch: null, worktree: null, isDirty: false }
  const [top = cwd, common = ''] = paths.split('\n')
  const mainRoot = common.replace(/\/\.git\/?$/, '')
  const [branch, status] = await Promise.all([
    git($, cwd, ['symbolic-ref', '--short', 'HEAD']).then(b => b ?? git($, cwd, ['rev-parse', '--short', 'HEAD'])),
    git($, cwd, ['status', '--porcelain', '--untracked-files=normal']),
  ])
  const isWorktree = mainRoot !== '' && mainRoot !== top
  return {
    repo: basename(mainRoot || top),
    branch,
    worktree: isWorktree ? basename(top) : null,
    isDirty: status !== null && status !== '',
  }
}

// Light themes get the deeper palette; anything else (dark, auto, unknown)
// the pastel one.
async function readTone($: EngineInterface): Promise<Tone> {
  try {
    const theme = (await $.config.list()).find(row => row.key === 'theme')?.value
    return typeof theme === 'string' && theme.startsWith('light') ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

async function refresh($: EngineInterface): Promise<void> {
  const cwd = await $.session.cwd()
  const [repo, model, usage, tone, t] = await Promise.all([
    readRepo($, cwd),
    $.session.model(),
    $.session.usage(),
    readTone($),
    $.clock.now(),
  ])

  const limits: Limit[] = usage.rateLimits.map(l => ({
    label: limitLabel(l.kind),
    percent: l.percentUsed,
    resetsAt: l.resetsAt ? Date.parse(l.resetsAt) : null,
  }))

  const snap: Snapshot = {
    ...repo,
    tone,
    model: modelName(model),
    contextWindow: usage.context.window || null,
    contextPercent: usage.context.percent ?? null,
    limits,
    costUsd: usage.cost?.usd ?? null,
  }

  // Remember the previous context size and cost to show the last turn's share.
  const tokens = usage.context.tokens ?? null
  await update($, context, prev =>
    tokens === null || tokens === prev.tokens
      ? prev
      : { tokens, delta: prev.tokens === null ? prev.delta : tokens - prev.tokens },
  )
  const usd = snap.costUsd
  await update($, cost, prev =>
    usd === null || usd === prev.usd ? prev : { usd, delta: prev.usd === null ? prev.delta : usd - prev.usd },
  )
  await update($, snapshot, () => snap)
  await update($, now, () => t)
}

async function addLines($: EngineInterface, delta: Lines): Promise<void> {
  if (delta.added === 0 && delta.removed === 0) return
  await update($, lines, l => ({ added: l.added + delta.added, removed: l.removed + delta.removed }))
}

export const register: Register = (on, options) => {
  const nerdFont = options.nerdFont === true

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await refresh($)
    // Keeps reset countdowns, the branch and its state current between turns.
    $.clock.every(60_000, () => void refresh($).catch(() => {}))
    return result
  })

  // Effort is reported per request; keep the main loop's.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined && e.effort !== undefined) {
      const level = String(e.effort)
      await update($, effort, () => level)
    }
    return yield* next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) {
      const ratio = e.usage ? hitRatio(e.usage) : null
      if (ratio !== null) await update($, hit, () => ratio)
      await refresh($)
    }
    return result
  })

  // Lines changed this session, from the edits Claude makes.
  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true) {
      await addLines($, lineDelta(e.old_string, e.new_string))
    }
    return ran
  }).catch(($, e, next) => next(e)) // never block an edit over line counting

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    let before = ''
    try {
      if (await $.fs.exists(e.file_path)) before = await $.fs.read(e.file_path)
    } catch {
      // unreadable or too large: count the write as all new lines
    }
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true) {
      await addLines($, lineDelta(before, e.content))
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const snap = await read($, snapshot)
    if (e.props.hasSurvey || snap === null) return next(e)

    const [lvl, changed, ctx, spent, ratio, t] = await Promise.all([
      read($, effort),
      read($, lines),
      read($, context),
      read($, cost),
      read($, hit),
      read($, now),
    ])
    const elements = $.ui.resolve(e)
    const { Box, Text } = elements
    // Every surface but the terminal has Svg; the terminal never asks for it.
    const Svg = 'Svg' in elements ? elements.Svg : Box
    const isTerminal = e.surface === 'terminal'
    const glyphs = isTerminal && nerdFont
    const tone = snap.tone
    const p = palette(tone)

    // A rounded chip of colour behind short text. In a terminal: Nerd Font
    // ends when there are some, square ends otherwise. Elsewhere: an SVG with
    // the same corner radius as the bars.
    const pill = (key: string, text: string, bg: string) => {
      if (!isTerminal) {
        const { source, width } = pillSvg(text, bg, p.onPill)
        return (
          <Box key={key} flexShrink={0}>
            <Svg source={source} alt={text} width={width} height={PILL_PX} />
          </Box>
        )
      }
      return glyphs ? (
        <Text key={key}>
          <Text color={bg}>{NF.left}</Text>
          <Text color={p.onPill} backgroundColor={bg} bold>
            {text}
          </Text>
          <Text color={bg}>{NF.right}</Text>
        </Text>
      ) : (
        <Text key={key} color={p.onPill} backgroundColor={bg} bold>
          {` ${text} `}
        </Text>
      )
    }

    const bolt = (color: string) => <Text color={color}>{glyphs ? `${NF.bolt} ` : '⚡'}</Text>

    // The context meter's note: how much the last turn added, as a share of
    // the window, and how much of the prompt the cache served.
    const growth =
      ctx.delta !== null && ctx.delta > 0 && snap.contextWindow !== null
        ? (ctx.delta / snap.contextWindow) * 100
        : null
    const contextNote = (
      <Box key="ctx-note" flexDirection="row" alignItems="center" columnGap={1}>
        {growth !== null && pill('growth', growthLabel(growth), growthHex(tone, growth))}
        {ratio !== null && (
          <Text key="hit">
            {bolt(hitHex(tone, ratio))}
            <Text color={hitHex(tone, ratio)}>{Math.round(ratio * 100)}%</Text>
          </Text>
        )}
      </Box>
    )

    const meterData = [
      ...(snap.contextPercent !== null
        ? [{ key: 'ctx', label: 'Ctx', percent: snap.contextPercent, note: contextNote, noteCells: CONTEXT_NOTE_CELLS }]
        : []),
      ...snap.limits.map(l => ({
        key: `limit-${l.label}`,
        label: l.label,
        percent: l.percent,
        note:
          l.resetsAt !== null ? (
            <Text key="reset" color="inactive">
              {untilReset(l.resetsAt, t)}
            </Text>
          ) : null,
        noteCells: LIMIT_NOTE_CELLS,
      })),
    ]

    // Meters side by side when they fit, else stacked. Every part has a fixed
    // width, so bars start and end together whatever the font, and the bars
    // grow to use the room there is.
    // bodyColumns leaves out the five cells the terminal keeps for its [-]
    // mark; no other surface draws one, so there the meters may use them too.
    const columns = (e.props.bodyColumns || 80) + (isTerminal ? 0 : ENGINE_MARK_CELLS)
    const layout = meterLayout(columns, meterData)

    // A terminal bar is one block per cell along the level's gradient, with
    // round ends from a Nerd Font when there is one; elsewhere an SVG fills
    // the slot (a block character is wider than a cell in the desktop's font).
    const bar = (m: (typeof meterData)[number]) => {
      if (!isTerminal) {
        return (
          <Svg
            source={barSvg(m.percent, layout.barCells, tone)}
            alt={`${m.label} ${Math.round(m.percent)}%`}
            height={BAR_PX}
          />
        )
      }
      const cells = barCellColors(m.percent, layout.barCells, tone)
      return (
        <Text>
          {cells.map((c, i) => {
            const glyph = glyphs && i === 0 ? NF.left : glyphs && i === cells.length - 1 ? NF.right : '█'
            return (
              <Text key={`${m.key}-cell-${i}`} color={c.color}>
                {glyph}
              </Text>
            )
          })}
        </Text>
      )
    }

    const meter = (m: (typeof meterData)[number]) => (
      <Box
        key={m.key}
        flexDirection="row"
        alignItems="center"
        flexShrink={0}
        columnGap={1}
      >
        <Box width={layout.labelCells} flexShrink={0}>
          <Text bold>{m.label}</Text>
        </Box>
        <Box key={`${m.key}-bar`} width={layout.barCells} flexShrink={0} alignItems="center">
          {bar(m)}
        </Box>
        {/* Left-aligned, one cell after the bar; wide enough for 100%. */}
        <Box width={PERCENT_CELLS} flexShrink={0}>
          <Text bold color={levelHex(tone, m.percent)}>{`${Math.round(m.percent)}%`}</Text>
        </Box>
        {/* A terminal keeps each note's full width so the next meter never
            moves; the desktop's font draws notes narrower than their cells,
            so there a note takes only its own width. */}
        <Box width={isTerminal ? m.noteCells : undefined} flexShrink={0} overflow="hidden">
          {m.note}
        </Box>
      </Box>
    )
    const meters = meterData.map(meter)

    // Secondary row: where and which model on the left; what changed and what
    // it cost on the right. Secondary text is the theme's "inactive" grey,
    // which stays readable; "subtle" is for decoration only (separators).
    const where = [
      <Text key="repo">
        <Text color={p.blue}>{snap.repo}</Text>
        {snap.branch !== null && (
          <Text>
            <Text color="subtle">:</Text>
            <Text color={branchHex(tone, snap.isDirty)}>
              {snap.branch}
              {snap.isDirty ? '*' : ''}
            </Text>
          </Text>
        )}
        {snap.worktree !== null && <Text color="inactive"> (wt: {snap.worktree})</Text>}
      </Text>,
      <Text key="model">
        <Text color={modelHex(tone, snap.model)}>{snap.model}</Text>
        {lvl !== null && (
          <Text>
            <Text color="inactive">/</Text>
            <Text color={effortHex(tone, lvl)}>{lvl}</Text>
          </Text>
        )}
        {snap.contextWindow !== null && <Text color="inactive"> ({human(snap.contextWindow)})</Text>}
      </Text>,
    ]
    const spend = [
      (changed.added > 0 || changed.removed > 0) && (
        <Text key="lines">
          <Text color={p.green}>+{changed.added}</Text> <Text color={p.red}>−{changed.removed}</Text>
        </Text>
      ),
      snap.costUsd !== null && (
        <Box key="cost" flexDirection="row" alignItems="center" columnGap={1}>
          {pill('session-cost', dollars(snap.costUsd), costHex(tone, snap.costUsd))}
          {spent.delta !== null && spent.delta > 0 && <Text color="inactive">{plusDollars(spent.delta)}</Text>}
        </Box>
      ),
    ].filter(d => d !== false)

    // Items with a faint dot between each pair.
    const separated = (key: string, items: RenderElement[]) =>
      items.flatMap((item, i) =>
        i === 0
          ? [item]
          : [
              <Text key={`${key}-sep-${i}`} color="subtle">
                ·
              </Text>,
              item,
            ],
      )

    const group = (key: string, items: RenderElement[]) => (
      <Box key={key} flexShrink={0} alignItems="center" columnGap={1}>
        {separated(key, items)}
      </Box>
    )

    return (
      <Box flexDirection="column" rowGap={0}>
        {meters.length > 0 && (
          // Side by side, the meters spread across the row: the first starts
          // at the left edge, the last ends at the right, and the spare room
          // goes around the separators.
          <Box
            key="meters"
            flexDirection={layout.isRow ? 'row' : 'column'}
            justifyContent={layout.isRow ? 'space-between' : 'flex-start'}
            columnGap={(METER_GAP - 1) / 2}
          >
            {layout.isRow ? separated('meter', meters) : meters}
          </Box>
        )}
        <Box key="details" flexWrap="wrap" justifyContent="space-between" columnGap={METER_GAP}>
          {group('where', where)}
          {spend.length > 0 && group('spend', spend)}
        </Box>
      </Box>
    )
  })
}
