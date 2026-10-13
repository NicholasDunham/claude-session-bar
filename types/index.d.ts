export type Limit = { label: string; percent: number; resetsAt: number | null }

export type Snapshot = {
  repo: string
  branch: string | null
  worktree: string | null
  /** Uncommitted changes in the working tree. */
  isDirty: boolean
  /** Which palette suits the Claude Code theme. */
  tone: 'dark' | 'light'
  model: string
  contextWindow: number | null
  contextPercent: number | null
  limits: Limit[]
  costUsd: number | null
}

export type Lines = { added: number; removed: number }
export type ContextTrack = { tokens: number | null; delta: number | null }
export type CostTrack = { usd: number | null; delta: number | null }

declare module 'claude-code' {
  interface PluginState {
    'session-bar': {
      snapshot: Snapshot | null
      effort: string | null
      lines: Lines
      context: ContextTrack
      cost: CostTrack
      hitRatio: number | null
      now: number
    }
  }
}
