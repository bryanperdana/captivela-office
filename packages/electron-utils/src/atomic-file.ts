import { randomBytes } from 'node:crypto'
import { open, rename, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

const RETRYABLE_PROMOTION_CODES = new Set(['EPERM', 'EACCES', 'EBUSY'])

export type AtomicFileOperation = 'write-temp' | 'flush-temp' | 'promote' | 'fallback-write'

export interface AtomicFileOptions {
  /** Number of retries after the first promotion attempt. */
  readonly maxRetries?: number
  /** Initial retry delay. Later delays use bounded exponential backoff. */
  readonly retryDelayMs?: number
}

export interface AtomicWriteFileOptions extends AtomicFileOptions {
  /** Complete-buffer writes may trade atomicity for reliability after Windows lock retries. */
  readonly allowInPlaceFallback?: boolean
}

export class AtomicFileSaveError extends Error {
  readonly operation: AtomicFileOperation
  readonly targetPath: string
  readonly temporaryPath: string
  readonly code: string | undefined
  readonly retryable: boolean
  readonly attempts: number

  constructor(input: {
    operation: AtomicFileOperation
    targetPath: string
    temporaryPath: string
    cause: unknown
    attempts?: number
  }) {
    const cause = input.cause
    const causeMessage = cause instanceof Error ? cause.message : String(cause)
    super(`Failed to ${input.operation} ${input.targetPath}: ${causeMessage}`, { cause })
    this.name = 'AtomicFileSaveError'
    this.operation = input.operation
    this.targetPath = input.targetPath
    this.temporaryPath = input.temporaryPath
    this.code = errnoCode(cause)
    this.retryable = RETRYABLE_PROMOTION_CODES.has(this.code ?? '')
    this.attempts = input.attempts ?? 1
  }
}

const sleep = (ms: number): Promise<void> =>
  ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms))

function errnoCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as NodeJS.ErrnoException).code)
    : undefined
}

function siblingTemporaryPath(targetPath: string): string {
  return join(dirname(targetPath), `.${basename(targetPath)}.${randomBytes(8).toString('hex')}.tmp`)
}

async function removeTemporaryFile(path: string): Promise<void> {
  try {
    await rm(path, { force: true })
  } catch {
    // Best effort only: never hide the save error that triggered cleanup.
  }
}

async function flushClosedFile(temporaryPath: string, targetPath: string): Promise<void> {
  try {
    // Windows FlushFileBuffers requires a handle opened with write access.
    // `r+` preserves the completed bytes while making fsync portable.
    const handle = await open(temporaryPath, 'r+')
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  } catch (cause) {
    throw new AtomicFileSaveError({
      operation: 'flush-temp',
      targetPath,
      temporaryPath,
      cause,
    })
  }
}

/**
 * Flush a completed sibling temp file, close its flush handle, then promote it.
 * Promotion retries only transient Windows sharing/permission failures. It never
 * truncates the target as a fallback, so it is safe for streamed output.
 */
export async function promoteFileAtomically(
  temporaryPath: string,
  targetPath: string,
  options: AtomicFileOptions = {},
): Promise<void> {
  const maxRetries = Math.max(0, options.maxRetries ?? 4)
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? 50)
  try {
    await flushClosedFile(temporaryPath, targetPath)
    for (let attempt = 0; ; attempt += 1) {
      try {
        await rename(temporaryPath, targetPath)
        return
      } catch (cause) {
        const retryable = RETRYABLE_PROMOTION_CODES.has(errnoCode(cause) ?? '')
        if (!retryable || attempt >= maxRetries) {
          throw new AtomicFileSaveError({
            operation: 'promote',
            targetPath,
            temporaryPath,
            cause,
            attempts: attempt + 1,
          })
        }
        await sleep(Math.min(retryDelayMs * 2 ** attempt, 1_000))
      }
    }
  } catch (error) {
    await removeTemporaryFile(temporaryPath)
    throw error
  }
}

/**
 * Produce a file at a unique sibling path, then safely promote it. The writer
 * must resolve only after all streams/handles it opened have been closed.
 */
export async function atomicWriteFileWithWriter(
  targetPath: string,
  writer: (temporaryPath: string) => Promise<void>,
  options: AtomicFileOptions = {},
): Promise<void> {
  const temporaryPath = siblingTemporaryPath(targetPath)
  try {
    await writer(temporaryPath)
  } catch (cause) {
    await removeTemporaryFile(temporaryPath)
    throw new AtomicFileSaveError({
      operation: 'write-temp',
      targetPath,
      temporaryPath,
      cause,
    })
  }
  await promoteFileAtomically(temporaryPath, targetPath, options)
}

async function writeCompleteBuffer(
  path: string,
  data: Uint8Array,
  flag: 'w' | 'wx',
): Promise<void> {
  const handle = await open(path, flag)
  try {
    await handle.writeFile(data)
    await handle.sync()
  } finally {
    await handle.close()
  }
}

/**
 * Atomic complete-buffer write. After bounded retryable Windows promotion
 * failures, it may use a flushed in-place write because the full replacement is
 * still available in memory. Streaming callers must use atomicWriteFileWithWriter.
 */
export async function atomicWriteFile(
  targetPath: string,
  data: Uint8Array,
  options: AtomicWriteFileOptions = {},
): Promise<void> {
  const temporaryPath = siblingTemporaryPath(targetPath)
  try {
    await writeCompleteBuffer(temporaryPath, data, 'wx')
  } catch (cause) {
    await removeTemporaryFile(temporaryPath)
    throw new AtomicFileSaveError({
      operation: 'write-temp',
      targetPath,
      temporaryPath,
      cause,
    })
  }

  try {
    await promoteFileAtomically(temporaryPath, targetPath, options)
  } catch (error) {
    const allowFallback = options.allowInPlaceFallback ?? true
    if (!(error instanceof AtomicFileSaveError) || !error.retryable || !allowFallback) throw error
    try {
      await writeCompleteBuffer(targetPath, data, 'w')
    } catch (cause) {
      throw new AtomicFileSaveError({
        operation: 'fallback-write',
        targetPath,
        temporaryPath,
        cause,
      })
    }
  }
}
