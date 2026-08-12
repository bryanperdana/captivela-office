import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { open, rename, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  AtomicFileSaveError,
  atomicWriteFile,
  atomicWriteFileWithWriter,
  promoteFileAtomically,
} from '../src/index'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, open: vi.fn(actual.open), rename: vi.fn(actual.rename) }
})

const locked = (code: 'EPERM' | 'EACCES' | 'EBUSY' = 'EPERM') =>
  Object.assign(new Error(`${code}: target is locked`), { code })

let directory: string | undefined

beforeEach(async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  vi.mocked(open).mockReset().mockImplementation(actual.open)
  vi.mocked(rename).mockReset().mockImplementation(actual.rename)
})

afterEach(() => {
  if (directory) rmSync(directory, { recursive: true, force: true })
  directory = undefined
})

describe('atomic file writes', () => {
  it('reopens a completed temp with write access before fsync for Windows', async () => {
    directory = mkdtempSync(join(tmpdir(), 'atomic-file-'))
    const target = join(directory, 'document.bin')

    await atomicWriteFile(target, Buffer.from('new'))

    expect(open).toHaveBeenCalledWith(expect.stringContaining('.tmp'), 'r+')
  })

  it('writes through a sibling temp file and leaves only the promoted target', async () => {
    directory = mkdtempSync(join(tmpdir(), 'atomic-file-'))
    const target = join(directory, 'document.bin')

    await atomicWriteFile(target, Buffer.from('new'))

    expect(readFileSync(target, 'utf8')).toBe('new')
    expect(readdirSync(directory)).toEqual(['document.bin'])
  })

  it('retries a transient Windows rename lock before promoting', async () => {
    directory = mkdtempSync(join(tmpdir(), 'atomic-file-'))
    const target = join(directory, 'document.bin')
    writeFileSync(target, 'old')
    const actualRename =
      await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    vi.mocked(rename).mockRejectedValueOnce(locked()).mockImplementation(actualRename.rename)

    await atomicWriteFile(target, Buffer.from('new'), { retryDelayMs: 0 })

    expect(readFileSync(target, 'utf8')).toBe('new')
    expect(rename).toHaveBeenCalledTimes(2)
  })

  it('may fall back in place for a complete buffer after bounded retries', async () => {
    directory = mkdtempSync(join(tmpdir(), 'atomic-file-'))
    const target = join(directory, 'document.bin')
    writeFileSync(target, 'old')
    vi.mocked(rename).mockRejectedValue(locked('EBUSY'))

    await atomicWriteFile(target, Buffer.from('new'), { maxRetries: 2, retryDelayMs: 0 })

    expect(readFileSync(target, 'utf8')).toBe('new')
    expect(rename).toHaveBeenCalledTimes(3)
    expect(readdirSync(directory)).toEqual(['document.bin'])
  })

  it('preserves the original and cleans the temp when streaming production fails', async () => {
    directory = mkdtempSync(join(tmpdir(), 'atomic-file-'))
    const target = join(directory, 'deck.pptx')
    writeFileSync(target, 'original')

    await expect(
      atomicWriteFileWithWriter(target, async (temporaryPath) => {
        expect(dirname(temporaryPath)).toBe(directory)
        await writeFile(temporaryPath, 'partial')
        throw new Error('stream failed')
      }),
    ).rejects.toMatchObject({
      name: 'AtomicFileSaveError',
      operation: 'write-temp',
      targetPath: target,
    })

    expect(readFileSync(target, 'utf8')).toBe('original')
    expect(readdirSync(directory)).toEqual(['deck.pptx'])
  })

  it('never falls back in place for a streaming promotion failure', async () => {
    directory = mkdtempSync(join(tmpdir(), 'atomic-file-'))
    const target = join(directory, 'deck.pptx')
    const temporaryPath = join(directory, '.deck.pptx.test.tmp')
    writeFileSync(target, 'original')
    writeFileSync(temporaryPath, 'replacement')
    vi.mocked(rename).mockRejectedValue(locked('EACCES'))

    const failure = await promoteFileAtomically(temporaryPath, target, {
      maxRetries: 1,
      retryDelayMs: 0,
    }).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(AtomicFileSaveError)
    expect(failure).toMatchObject({
      operation: 'promote',
      code: 'EACCES',
      retryable: true,
      attempts: 2,
      targetPath: target,
      temporaryPath,
    })
    expect(readFileSync(target, 'utf8')).toBe('original')
    expect(readdirSync(directory)).toEqual(['deck.pptx'])
  })
})
