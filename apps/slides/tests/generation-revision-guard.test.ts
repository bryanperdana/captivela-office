import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: { getFocusedWindow: () => null },
}))
vi.mock('../src/main/fonts', () => ({
  createSystemFontMetrics: () => ({}),
}))

import type { Session } from '../src/main/session-state'
import { pushHistory, sessionGenerationId } from '../src/main/session-state'
import {
  assertGenerationRevision,
  captureGenerationRevision,
} from '../src/main/ai-generation/revision-guard'

function session(): Session {
  return {
    path: '',
    fitWidthPx: 1280,
    undoStack: [],
    redoStack: [],
    opened: {
      deck: { slides: [], size: { cx: 1, cy: 1 } },
      archive: { entries: new Map() },
    },
  } as unknown as Session
}

describe('generation revision guard', () => {
  it('accepts a token while the deck is unchanged', () => {
    const current = session()
    expect(() => assertGenerationRevision(current, captureGenerationRevision(current))).not.toThrow()
  })

  it('rejects an artifact after any user mutation intent', () => {
    const current = session()
    const token = captureGenerationRevision(current)
    pushHistory(current)
    expect(() => assertGenerationRevision(current, token)).toThrow(/stale generated artifact/)
  })

  it('assigns a stable nonce per logical session even when revisions coincide', () => {
    const first = session()
    const second = session()
    expect(sessionGenerationId(first)).toBe(sessionGenerationId(first))
    expect(sessionGenerationId(first)).not.toBe(sessionGenerationId(second))
  })

  it('rejects malformed tokens', () => {
    const current = session()
    expect(() => assertGenerationRevision(current, { expectedRevision: -1 })).toThrow(/invalid/)
    expect(() => assertGenerationRevision(current, { expectedRevision: 1.5 })).toThrow(/invalid/)
  })
})
