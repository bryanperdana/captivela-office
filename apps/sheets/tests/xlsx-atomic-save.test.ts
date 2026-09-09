import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { writeXlsxAtomically } from '../src/gateway/xlsx-gateway'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, rename: vi.fn(actual.rename) }
})

const locked = () => Object.assign(new Error('EPERM: workbook is locked'), { code: 'EPERM' })
let directory: string | undefined

beforeEach(async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  vi.mocked(rename).mockReset().mockImplementation(actual.rename)
})

afterEach(() => {
  if (directory) rmSync(directory, { recursive: true, force: true })
  directory = undefined
})

describe('writeXlsxAtomically', () => {
  it('retries a transient Windows promotion failure', async () => {
    directory = mkdtempSync(join(tmpdir(), 'xlsx-atomic-'))
    const target = join(directory, 'book.xlsx')
    writeFileSync(target, 'original')
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    vi.mocked(rename).mockRejectedValueOnce(locked()).mockImplementation(actual.rename)

    await writeXlsxAtomically(target, Buffer.from('replacement'), {
      maxRetries: 1,
      retryDelayMs: 0,
    })

    expect(readFileSync(target, 'utf8')).toBe('replacement')
    expect(rename).toHaveBeenCalledTimes(2)
    expect(readdirSync(directory)).toEqual(['book.xlsx'])
  })

  it('preserves the original after persistent promotion failure', async () => {
    directory = mkdtempSync(join(tmpdir(), 'xlsx-atomic-'))
    const target = join(directory, 'book.xlsx')
    writeFileSync(target, 'original')
    vi.mocked(rename).mockRejectedValue(locked())

    await expect(
      writeXlsxAtomically(target, Buffer.from('replacement'), {
        maxRetries: 1,
        retryDelayMs: 0,
      }),
    ).rejects.toMatchObject({ operation: 'promote', code: 'EPERM', attempts: 2 })

    expect(readFileSync(target, 'utf8')).toBe('original')
    expect(readdirSync(directory)).toEqual(['book.xlsx'])
  })
})
