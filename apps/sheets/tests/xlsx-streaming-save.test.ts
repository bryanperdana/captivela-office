import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import JSZip from 'jszip'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, rename: vi.fn(actual.rename) }
})

import type { ArchiveEntry } from '../src/gateway/xlsx-package-io'
import { assertManifestPreserved, saveWorkbookViaSidecar } from '../src/gateway/xlsx-package-io'
import { XlsxSidecarClient } from '../src/main/xlsx-sidecar-client'
import { buildEditFixture } from './fixture-builder'

const locked = () => Object.assign(new Error('EPERM: workbook is locked'), { code: 'EPERM' })

describe('saveWorkbookViaSidecar', () => {
  let directory: string
  let client: XlsxSidecarClient

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'xlsx-streaming-save-'))
    client = new XlsxSidecarClient(sidecarBinaryPath())
  })

  beforeEach(async () => {
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    vi.mocked(rename).mockReset().mockImplementation(actual.rename)
  })

  afterAll(async () => {
    client.stop()
    await rm(directory, { recursive: true, force: true })
  })

  it('saves a cell edit while raw-copying every untouched entry byte-for-byte', async () => {
    const sourcePath = join(directory, 'source.xlsx')
    const targetPath = join(directory, 'saved.xlsx')
    const sourceBuffer = await buildEditFixture()
    await writeFile(sourcePath, sourceBuffer)

    const result = await saveWorkbookViaSidecar({
      client,
      sourcePath,
      targetPath,
      edits: [
        {
          sheetName: 'Data',
          row: 0,
          column: 0,
          writeValue: true,
          cell: { value: 'World' },
        },
      ],
    })

    expect(result.touchedEntries).toEqual(['xl/workbook.xml', 'xl/worksheets/sheet1.xml'])
    expect(result.removedEntries).toEqual([])
    expect(result.addedEntries).toEqual([])

    const sourceZip = await JSZip.loadAsync(sourceBuffer)
    const savedZip = await JSZip.loadAsync(await readFile(targetPath))
    expect(Object.keys(savedZip.files).sort()).toEqual(Object.keys(sourceZip.files).sort())

    const savedSheet = await savedZip.file('xl/worksheets/sheet1.xml')?.async('text')
    expect(savedSheet).toContain('<is><t xml:space="preserve">World</t></is>')
    const savedWorkbook = await savedZip.file('xl/workbook.xml')?.async('text')
    expect(savedWorkbook).toContain('fullCalcOnLoad="1"')

    for (const path of Object.keys(sourceZip.files)) {
      if (sourceZip.files[path]?.dir) continue
      if (path === 'xl/worksheets/sheet1.xml' || path === 'xl/workbook.xml') continue
      const [sourceBytes, savedBytes] = await Promise.all([
        sourceZip.file(path)?.async('nodebuffer'),
        savedZip.file(path)?.async('nodebuffer'),
      ])
      expect(savedBytes?.equals(sourceBytes ?? Buffer.of())).toBe(true)
    }
  })

  it('reopens its own output: a second edit chains on the saved file', async () => {
    const firstPath = join(directory, 'chain-1.xlsx')
    const secondPath = join(directory, 'chain-2.xlsx')
    await writeFile(firstPath, await buildEditFixture())

    await saveWorkbookViaSidecar({
      client,
      sourcePath: firstPath,
      targetPath: secondPath,
      edits: [{ sheetName: 'Data', row: 4, column: 0, writeValue: true, cell: { value: 41 } }],
    })
    await saveWorkbookViaSidecar({
      client,
      sourcePath: secondPath,
      targetPath: secondPath,
      edits: [{ sheetName: 'Data', row: 5, column: 0, writeValue: true, cell: { value: 42 } }],
    })

    const savedZip = await JSZip.loadAsync(await readFile(secondPath))
    const sheet = await savedZip.file('xl/worksheets/sheet1.xml')?.async('text')
    expect(sheet).toContain('<c r="A5"><v>41</v></c>')
    expect(sheet).toContain('<c r="A6"><v>42</v></c>')
  })

  it('retries a transient Windows promotion failure', async () => {
    const sourcePath = join(directory, 'retry-source.xlsx')
    const targetPath = join(directory, 'retry-target.xlsx')
    await writeFile(sourcePath, await buildEditFixture())
    await writeFile(targetPath, 'original target')
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    vi.mocked(rename).mockRejectedValueOnce(locked()).mockImplementation(actual.rename)

    await saveWorkbookViaSidecar({
      client,
      sourcePath,
      targetPath,
      edits: [{ sheetName: 'Data', row: 0, column: 0, writeValue: true, cell: { value: 'saved' } }],
    })

    expect(rename).toHaveBeenCalledTimes(2)
    expect((await readFile(targetPath)).subarray(0, 2).toString()).toBe('PK')
  })

  it('preserves the original after a persistent Windows promotion failure', async () => {
    const sourcePath = join(directory, 'locked-source.xlsx')
    const targetPath = join(directory, 'locked-target.xlsx')
    await writeFile(sourcePath, await buildEditFixture())
    await writeFile(targetPath, 'original target')
    vi.mocked(rename).mockRejectedValue(locked())

    await expect(
      saveWorkbookViaSidecar({
        client,
        sourcePath,
        targetPath,
        edits: [
          { sheetName: 'Data', row: 0, column: 0, writeValue: true, cell: { value: 'saved' } },
        ],
      }),
    ).rejects.toMatchObject({ operation: 'promote', code: 'EPERM', attempts: 5 })

    expect(await readFile(targetPath, 'utf8')).toBe('original target')
  })
})

describe('assertManifestPreserved', () => {
  const entry = (name: string, crc32 = 1, size = 10): ArchiveEntry => ({
    name,
    crc32,
    compressedSize: size,
    uncompressedSize: size,
  })
  const plan = (
    replaced: string[] = [],
    added: string[] = [],
    removedEntries: string[] = [],
  ): Parameters<typeof assertManifestPreserved>[0] => ({
    replaced: new Map(replaced.map((name) => [name, ''])),
    added: new Map(added.map((name) => [name, ''])),
    removedEntries,
  })

  it('accepts identical untouched entries and declared changes', () => {
    expect(() =>
      assertManifestPreserved(
        plan(['b.xml'], ['c.xml'], ['d.xml']),
        [entry('a.xml'), entry('b.xml'), entry('d.xml')],
        [entry('a.xml'), entry('b.xml', 99, 12), entry('c.xml', 7)],
      ),
    ).not.toThrow()
  })

  it('rejects an undeclared content change', () => {
    expect(() => assertManifestPreserved(plan(), [entry('a.xml', 1)], [entry('a.xml', 2)])).toThrow(
      'unexpectedly modify a.xml',
    )
  })

  it('rejects dropped, surviving-despite-removal, and surprise entries', () => {
    expect(() => assertManifestPreserved(plan(), [entry('a.xml')], [])).toThrow('drop a.xml')
    expect(() =>
      assertManifestPreserved(plan([], [], ['a.xml']), [entry('a.xml')], [entry('a.xml')]),
    ).toThrow('should have removed a.xml')
    expect(() =>
      assertManifestPreserved(plan(), [entry('a.xml')], [entry('a.xml'), entry('extra.xml')]),
    ).toThrow('unexpectedly create extra.xml')
  })

  it('rejects a missing declared addition', () => {
    expect(() =>
      assertManifestPreserved(plan([], ['new.xml']), [entry('a.xml')], [entry('a.xml')]),
    ).toThrow('should have created new.xml')
  })
})

function sidecarBinaryPath(): string {
  const executable = process.platform === 'win32' ? 'xlsx-sidecar.exe' : 'xlsx-sidecar'
  return fileURLToPath(
    new URL(`../native/xlsx-engine/target/release/${executable}`, import.meta.url),
  )
}
