import type { Session } from '../session-state'
import { sessionRevision } from '../session-state'

export interface GenerationRevisionToken {
  expectedRevision: number
}

export function captureGenerationRevision(session: Session): GenerationRevisionToken {
  return { expectedRevision: sessionRevision(session) }
}

export function assertGenerationRevision(
  session: Session,
  token: GenerationRevisionToken,
): void {
  if (!Number.isInteger(token.expectedRevision) || token.expectedRevision < 0)
    throw new Error('invalid generation revision token')
  const actual = sessionRevision(session)
  if (actual !== token.expectedRevision)
    throw new Error(`stale generated artifact: expected deck revision ${token.expectedRevision}, current ${actual}`)
}
