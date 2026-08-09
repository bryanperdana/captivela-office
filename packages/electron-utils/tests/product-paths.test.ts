import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  CAPTIVELA_DEV_USER_DATA_DIRNAME,
  ensureProductDocumentsDir,
  legacyDocumentsDir,
  migrateLegacyDirectory,
  productDevUserDataDir,
  productDocumentsDir,
  readProductEnvironment,
} from '../src/product-paths'

const temporaryDirectories: string[] = []

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'captivela-paths-'))
  temporaryDirectories.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })))
})

describe('product paths', () => {
  it('uses Captivela Office for new visible paths', () => {
    expect(productDocumentsDir('/Documents')).toBe('/Documents/Captivela Office')
    expect(productDevUserDataDir('/Library/Application Support')).toBe(
      '/Library/Application Support/Captivela Office Dev',
    )
    expect(CAPTIVELA_DEV_USER_DATA_DIRNAME).toBe('Captivela Office Dev')
  })

  it('prefers Captivela environment variables and accepts the legacy alias', () => {
    expect(
      readProductEnvironment(
        {
          CAPTIVELA_OFFICE_LANG: 'id',
          GENOFFICE_LANG: 'en',
        },
        'CAPTIVELA_OFFICE_LANG',
        'GENOFFICE_LANG',
      ),
    ).toBe('id')
    expect(
      readProductEnvironment(
        { GENOFFICE_LANG: 'en' },
        'CAPTIVELA_OFFICE_LANG',
        'GENOFFICE_LANG',
      ),
    ).toBe('en')
  })

  it('copies legacy documents without deleting the source', async () => {
    const root = await temporaryRoot()
    const legacy = legacyDocumentsDir(root)
    mkdirSync(legacy, { recursive: true })
    writeFileSync(join(legacy, 'draft.txt'), 'legacy draft')

    const target = ensureProductDocumentsDir(root)

    expect(readFileSync(join(target, 'draft.txt'), 'utf8')).toBe('legacy draft')
    expect(readFileSync(join(legacy, 'draft.txt'), 'utf8')).toBe('legacy draft')
  })

  it('is idempotent and never overwrites an existing Captivela directory', async () => {
    const root = await temporaryRoot()
    const target = productDocumentsDir(root)
    const legacy = legacyDocumentsDir(root)
    mkdirSync(target, { recursive: true })
    mkdirSync(legacy, { recursive: true })
    writeFileSync(join(target, 'draft.txt'), 'current')
    writeFileSync(join(legacy, 'draft.txt'), 'legacy')

    expect(migrateLegacyDirectory(target, [legacy])).toBe(false)
    expect(readFileSync(join(target, 'draft.txt'), 'utf8')).toBe('current')
    expect(existsSync(join(legacy, 'draft.txt'))).toBe(true)
  })
})
