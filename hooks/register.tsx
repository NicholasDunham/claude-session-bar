import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement } from 'claude-code'

import type { ContextTrack, Limit, Lines, Snapshot } from '../types'
import {
  BAR_PX,
  barSvg,
  basename,
  filledCells,
  hitRatio,
  human,
  hitColor,
  levelColor,
  limitLabel,
  lineDelta,
  METER_GAP,
  meterLayout,
  modelName,
  NOTE_CELLS,
  PERCENT_CELLS,
  untilReset,
} from './format'

const snapshot = atom({ plugin: 'session-bar', key: 'snapshot' } as const, null)
const effort = atom({ plugin: 'session-bar', key: 'effort' } as const, null)
const lines = atom({ plugin: 'session-bar', key: 'lines' } as const, { added: 0, removed: 0 } as Lines)
const context = atom({ plugin: 'session-bar', key: 'context' } as const, { tokens: null, delta: null } as ContextTrack)
const hit = atom({ plugin: 'session-bar', key: 'hitRatio' } as const, null)
const now = atom({ plugin: 'session-bar', key: 'now' } as const, 0)

async function git($: EngineInterface, cwd: string, args: string[]): Promise<string | null> {
  try {
    const r = await $.process.run(['git', '-C', cwd, '--no-optional-locks', ...args], { timeoutMs: 2000 })
    return r.exitCode === 0 ? r.stdout.trim() : null
  } catch {
    return null
  }
}

// Repo name (the main checkout's, even inside a worktree), branch, worktree.
async function readRepo($: EngineInterface, cwd: string) {
  const paths = await git($, cwd, ['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-common-dir'])
  if (!paths) return { repo: basename(cwd), branch: null, worktree: null }
  const [top = cwd, common = ''] = paths.split('\n')
  const mainRoot = common.replace(/\/\.git\/?$/, '')
  const branch =
    (await git($, cwd, ['symbolic-ref', '--short', 'HEAD'])) ?? (await git($, cwd, ['rev-parse', '--short', 'HEAD']))
  const isWorktree = mainRoot !== '' && mainRoot !== top
  return {
    repo: basename(mainRoot || top),
    branch,
    worktree: isWorktree ? basename(top) : null,
  }
}

async function refresh($: EngineInterface): Promise<void> {
  const cwd = await $.session.cwd()
  const [repo, model, usage, t] = await Promise.all([
    readRepo($, cwd),
    $.session.model(),
    $.session.usage(),
    $.clock.now(),
  ])

  const limits: Limit[] = usage.rateLimits.map(l => ({
    label: limitLabel(l.kind),
    percent: l.percentUsed,
    resetsAt: l.resetsAt ? Date.parse(l.resetsAt) : null,
  }))

  const snap: Snapshot = {
    ...repo,
    model: modelName(model),
    contextWindow: usage.context.window || null,
    contextPercent: usage.context.percent ?? null,
    limits,
    costUsd: usage.cost?.usd ?? null,
  }

  // Remember the previous context size to show the last turn's growth.
  const tokens = usage.context.tokens ?? null
  await update($, context, prev =>
    tokens === null || tokens === prev.tokens
      ? prev
      : { tokens, delta: prev.tokens === null ? prev.delta : tokens - prev.tokens },
  )
  await update($, snapshot, () => snap)
  await update($, now, () => t)
}

async function addLines($: EngineInterface, delta: Lines): Promise<void> {
  if (delta.added === 0 && delta.removed === 0) return
  await update($, lines, l => ({ added: l.added + delta.added, removed: l.removed + delta.removed }))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await refresh($)
    // Keeps reset countdowns and the branch current between turns.
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

    const [lvl, changed, ctx, ratio, t] = await Promise.all([
      read($, effort),
      read($, lines),
      read($, context),
      read($, hit),
      read($, now),
    ])
    const elements = $.ui.resolve(e)
    const { Box, Text } = elements
    // Every surface but the terminal has Svg; the terminal never asks for it.
    const Svg = 'Svg' in elements ? elements.Svg : Box

    const meterData = [
      ...(snap.contextPercent !== null
        ? [{ key: 'ctx', label: 'Ctx', percent: snap.contextPercent, note: ctx.delta !== null && ctx.delta > 0 ? `+${human(ctx.delta)}` : null }]
        : []),
      ...snap.limits.map(l => ({
        key: `limit-${l.label}`,
        label: l.label,
        percent: l.percent,
        note: l.resetsAt !== null ? untilReset(l.resetsAt, t) : null,
      })),
    ]

    // Primary rows: meters side by side in equal columns when they fit, else
    // stacked. Every part has a fixed width, so bars start and end together
    // whatever the font, and the bars grow to use the room there is.
    const columns = e.props.bodyColumns || 80
    const layout = meterLayout(columns, meterData.map(m => m.label))

    const meter = (m: (typeof meterData)[number]) => {
      const filled = filledCells(m.percent, layout.barCells)
      return (
        <Box
          key={m.key}
          flexDirection="row"
          alignItems="center"
          flexGrow={layout.isRow ? 1 : 0}
          width={layout.isRow ? 0 : undefined}
          columnGap={1}
        >
          <Box width={layout.labelCells} flexShrink={0}>
            <Text bold>{m.label}</Text>
          </Box>
          {/* A block character is one cell in a terminal; in the desktop's
              font it is wider, so there the bar is an SVG that fills the
              slot, which keeps its width in cells either way. */}
          <Box key={`${m.key}-bar`} width={layout.barCells} flexShrink={0} alignItems="center">
            {e.surface === 'terminal' ? (
              <Text>
                <Text color={levelColor(m.percent)}>{'█'.repeat(filled)}</Text>
                <Text color="subtle">{'█'.repeat(layout.barCells - filled)}</Text>
              </Text>
            ) : (
              <Svg source={barSvg(m.percent, layout.barCells)} alt={`${m.label} ${Math.round(m.percent)}%`} height={BAR_PX} />
            )}
          </Box>
          <Box width={PERCENT_CELLS} flexShrink={0} justifyContent="flex-end">
            <Text bold color={levelColor(m.percent)}>{`${Math.round(m.percent)}%`}</Text>
          </Box>
          <Box width={NOTE_CELLS} flexShrink={0} overflow="hidden">
            {m.note !== null && (
              <Text color="inactive" wrap="truncate-end">
                {m.note}
              </Text>
            )}
          </Box>
        </Box>
      )
    }
    const meters = meterData.map(meter)

    // Secondary text is the theme's "inactive" grey, which stays readable;
    // "subtle" is for decoration only (empty bar cells, separators).
    // Secondary row: where and which model on the left; what changed, what it
    // cost and how well the cache is doing on the right.
    const where = [
      <Text key="repo">
        <Text color="suggestion">{snap.repo}</Text>
        {snap.branch !== null && (
          <Text>
            <Text color="subtle">:</Text>
            <Text color="success">{snap.branch}</Text>
          </Text>
        )}
        {snap.worktree !== null && <Text color="inactive"> (wt: {snap.worktree})</Text>}
      </Text>,
      <Text key="model">
        <Text color="claude">{snap.model}</Text>
        {lvl !== null && <Text color="warning">/{lvl}</Text>}
        {snap.contextWindow !== null && <Text color="inactive"> ({human(snap.contextWindow)})</Text>}
      </Text>,
    ]
    const spend = [
      (changed.added > 0 || changed.removed > 0) && (
        <Text key="lines">
          <Text color="success">+{changed.added}</Text> <Text color="error">−{changed.removed}</Text>
        </Text>
      ),
      snap.costUsd !== null && (
        <Text key="cost" color="inactive">
          ${snap.costUsd.toFixed(2)}
        </Text>
      ),
      ratio !== null && (
        <Text key="hit">
          <Text color="inactive">cache </Text>
          <Text color={hitColor(ratio)}>{Math.round(ratio * 100)}%</Text>
        </Text>
      ),
    ].filter(d => d !== false)

    const group = (key: string, items: RenderElement[]) => (
      <Box key={key} flexShrink={0} columnGap={1}>
        {items.flatMap((item, i) =>
          i === 0
            ? [item]
            : [
                <Text key={`${key}-sep-${i}`} color="subtle">
                  ·
                </Text>,
                item,
              ],
        )}
      </Box>
    )

    return (
      <Box flexDirection="column" rowGap={0}>
        {meters.length > 0 && (
          <Box key="meters" flexDirection={layout.isRow ? 'row' : 'column'} columnGap={METER_GAP}>
            {meters}
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
