#!/usr/bin/env node

/* global document, getComputedStyle, window */
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import JSZip from 'jszip'
import { chromium } from 'playwright'

const endpoint = process.env.CAPTIVELA_CDP ?? 'http://127.0.0.1:9333'
const output = resolve(
  process.env.CAPTIVELA_QA_OUTPUT ??
    `${process.env.HOME}/Documents/Hermes-Output/apps/captivela-office/qa/packaged`,
)
await mkdir(output, { recursive: true })

const XLSX_MARKER = 'CAPTIVELA_WINDOWS_SAVE_MARKER_20260812'
const XLSX_DATE = new Date('2020-01-02T03:04:05.000Z')

async function createDeterministicXlsxFixture() {
  const runnerTemp = process.env.RUNNER_TEMP
  if (!runnerTemp) throw new Error('RUNNER_TEMP is required for packaged XLSX persistence QA')
  const fixtureDir = join(runnerTemp, 'Captivela Office XLSX QA – ünicode')
  const workbookPath = join(fixtureDir, 'existing workbook – persistence.xlsx')
  await rm(fixtureDir, { recursive: true, force: true })
  await mkdir(fixtureDir, { recursive: true })

  const zip = new JSZip()
  const add = (path, content) => zip.file(path, content, { createFolders: false, date: XLSX_DATE })
  add(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`,
  )
  add(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
  )
  add(
    'xl/workbook.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>
</workbook>`,
  )
  add(
    'xl/_rels/workbook.xml.rels',
    `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
  )
  add(
    'xl/worksheets/sheet1.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Old</t></is></c><c r="B1"><v>10</v></c></row></sheetData>
</worksheet>`,
  )
  add(
    'xl/styles.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="1"><font/></fonts><fills count="1"><fill/></fills><borders count="1"><border/></borders>
  <cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="1"><xf/></cellXfs>
</styleSheet>`,
  )
  const bytes = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  })
  await writeFile(workbookPath, bytes)
  return workbookPath
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

async function waitFor(predicate, description, timeout = 20_000) {
  const deadline = Date.now() + timeout
  let lastError = null
  while (Date.now() < deadline) {
    try {
      const value = await predicate()
      if (value) return value
    } catch (error) {
      lastError = error
    }
    await new Promise((accept) => setTimeout(accept, 250))
  }
  const suffix = lastError instanceof Error ? `: ${lastError.message}` : ''
  throw new Error(`Timed out waiting for ${description}${suffix}`)
}

async function waitForWorkbook(modulePage) {
  await modulePage.waitForLoadState('domcontentloaded')
  await modulePage.waitForFunction(() => document.body.textContent?.includes('Sheet1'), null, {
    timeout: 30_000,
  })
  await modulePage.waitForTimeout(1_500)
}

// Canvas-relative coordinates copied from the proven sheets edit/save E2E.
// The preload exposes save/read operations, but intentionally no cell-edit API.
async function cellA1(modulePage) {
  const grid = await modulePage.evaluate(() => {
    for (const canvas of document.querySelectorAll('canvas')) {
      const rect = canvas.getBoundingClientRect()
      if (rect.width > 500 && rect.height > 300) return { x: rect.x, y: rect.y }
    }
    return null
  })
  if (!grid) throw new Error('Packaged worksheet canvas not found')
  return { x: grid.x + 46 + 43, y: grid.y + 24 + 12 }
}

async function selectA1(modulePage) {
  const point = await cellA1(modulePage)
  await modulePage.mouse.click(point.x, point.y)
  await modulePage.waitForFunction(
    () => document.querySelector('.name-box')?.value === 'A1',
    null,
    { timeout: 10_000 },
  )
}

async function copyActiveCellThroughUi(modulePage) {
  await modulePage.keyboard.press('Control+c')
  await modulePage.waitForTimeout(300)
  const nameBox = modulePage.locator('.name-box')
  await nameBox.click()
  await modulePage.keyboard.press('Control+a')
  await modulePage.keyboard.press('Control+v')
  await modulePage.waitForTimeout(150)
  const copied = await nameBox.inputValue()
  await modulePage.keyboard.press('Escape')
  return copied
}

async function openWorkbookFromShell(shellPage, workbookPath, existingPages) {
  const tabsBefore = await shellPage.evaluate(() => window.aiOfficeTabs.list())
  const oldTabIds = new Set(tabsBefore.map((tab) => tab.id))
  await shellPage.evaluate((path) => window.aiOffice.openPath(path), workbookPath)
  const modulePage = await waitFor(
    () =>
      shellPage
        .context()
        .pages()
        .find(
          (candidate) =>
            !existingPages.has(candidate) &&
            candidate.url().includes('/modules/sheets/renderer/index.html'),
        ),
    'a newly opened packaged sheets page',
  )
  const tab = await waitFor(async () => {
    const tabs = await shellPage.evaluate(() => window.aiOfficeTabs.list())
    return tabs.find((candidate) => candidate.kind === 'sheets' && !oldTabIds.has(candidate.id))
  }, 'the new sheets tab registration')
  await waitForWorkbook(modulePage)
  return { modulePage, tabId: tab.id }
}

async function inspectSavedWorkbook(workbookPath) {
  const bytes = await readFile(workbookPath)
  const archive = await JSZip.loadAsync(bytes, { checkCRC32: true })
  const sheetEntry = archive.file('xl/worksheets/sheet1.xml')
  if (!sheetEntry) throw new Error('Saved XLSX is missing xl/worksheets/sheet1.xml')
  const sheetXml = await sheetEntry.async('string')
  return { hash: sha256(bytes), sheetXml }
}

async function siblingTempFiles(workbookPath) {
  const workbookName = basename(workbookPath)
  const entries = await readdir(dirname(workbookPath), { withFileTypes: true })
  const tempPattern = /(^~\$.*\.xlsx$)|(^\..+\.tmp\.xlsx$)|(\.tmp(?:\.|$))|(\.bak(?:\.|$))/i
  return entries
    .filter((entry) => entry.name !== workbookName && tempPattern.test(entry.name))
    .map((entry) => entry.name)
    .sort()
}

const browser = await chromium.connectOverCDP(endpoint)
const context = browser.contexts()[0]
const pages = context.pages()
const page = pages.find((candidate) => candidate.url().includes('/renderer/index.html')) ?? pages[0]
if (!page) throw new Error('No packaged Captivela renderer page found')

const consoleMessages = []
const pageErrors = []
page.on('console', (message) => {
  if (['warning', 'error'].includes(message.type()))
    consoleMessages.push(`${message.type()}: ${message.text()}`)
})
page.on('pageerror', (error) => pageErrors.push(error.message))

await page.waitForLoadState('domcontentloaded')
await page.waitForTimeout(800)
const before = await page.evaluate(() => {
  const text = document.body.innerText
  const logo = document.querySelector('img.captivela-brand-logo')
  const overlay = document.querySelector('.onb-overlay')
  const style = overlay ? getComputedStyle(overlay) : null
  return {
    title: document.title,
    bodyText: text.slice(0, 3000),
    forbidden: ['GenOffice', 'Genspark', 'GenTeam'].filter((term) => text.includes(term)),
    logo: logo
      ? { alt: logo.getAttribute('alt'), complete: logo.complete, naturalWidth: logo.naturalWidth }
      : null,
    onboardingVisible: Boolean(overlay),
    fontFamily: style?.fontFamily ?? null,
    background: style?.backgroundColor ?? null,
  }
})
await page.screenshot({ path: resolve(output, '01-onboarding.png'), fullPage: true })

for (let i = 0; i < 4; i++) {
  const next = page
    .getByRole('button', { name: /Next|Mulai|Start|Continue|Done|Finish|Get started|Skip/i })
    .last()
  if (await next.count()) {
    await next.click()
    await page.waitForTimeout(250)
  } else break
}
if (await page.locator('.onb-overlay').count()) {
  const skip = page.locator('.onb-skip')
  if (await skip.count()) await skip.click()
}
await page.waitForTimeout(600)
const home = await page.evaluate(() => {
  const text = document.body.innerText
  const logo = document.querySelector('img.captivela-brand-logo')
  const root = document.querySelector('.captivela-app-chrome')
  const style = root ? getComputedStyle(root) : null
  return {
    title: document.title,
    bodyText: text.slice(0, 4000),
    forbidden: ['GenOffice', 'Genspark', 'GenTeam'].filter((term) => text.includes(term)),
    logo: logo
      ? { alt: logo.getAttribute('alt'), complete: logo.complete, naturalWidth: logo.naturalWidth }
      : null,
    chromeFont: style?.fontFamily ?? null,
    chromeBackground: style?.backgroundColor ?? null,
    onboardingVisible: Boolean(document.querySelector('.onb-overlay')),
  }
})
await page.screenshot({ path: resolve(output, '02-home.png'), fullPage: true })

async function inspectModule(kind, action, screenshotName) {
  await action()
  const deadline = Date.now() + 15_000
  let modulePage = null
  while (!modulePage && Date.now() < deadline) {
    modulePage =
      context
        .pages()
        .find((candidate) => candidate.url().includes(`/modules/${kind}/renderer/index.html`)) ??
      null
    if (!modulePage) await page.waitForTimeout(250)
  }
  if (!modulePage) throw new Error(`Packaged ${kind} module page did not open`)
  modulePage.on('console', (message) => {
    if (['warning', 'error'].includes(message.type()))
      consoleMessages.push(`${kind} ${message.type()}: ${message.text()}`)
  })
  modulePage.on('pageerror', (error) => pageErrors.push(`${kind}: ${error.message}`))
  await modulePage.waitForLoadState('domcontentloaded')
  await modulePage.waitForTimeout(800)
  const result = await modulePage.evaluate(() => {
    const text = document.body.innerText
    const chrome =
      document.querySelector('.ribbon-tabs') ?? document.querySelector('.captivela-app-chrome')
    return {
      title: document.title,
      bodyText: text.slice(0, 3000),
      forbidden: ['GenOffice', 'Genspark', 'GenTeam'].filter((term) => text.includes(term)),
      chrome: Boolean(document.querySelector('.captivela-app-chrome')),
      chromeFont: chrome ? getComputedStyle(chrome).fontFamily : null,
      documentFont: document.querySelector('.doc-page')
        ? getComputedStyle(document.querySelector('.doc-page')).fontFamily
        : null,
    }
  })
  if (result.forbidden.length)
    throw new Error(`${kind} exposed forbidden branding: ${result.forbidden}`)
  await modulePage.screenshot({ path: resolve(output, screenshotName), fullPage: true })
  return { page: modulePage, result }
}

const docsInspection = await inspectModule(
  'docs',
  () => page.evaluate(() => window.aiOffice.newDoc()),
  '03-docs.png',
)
const sheetsInspection = await inspectModule(
  'sheets',
  () => page.evaluate(() => window.aiOffice.newSheet()),
  '04-sheets.png',
)
const slidesInspection = await inspectModule(
  'slides',
  () => page.evaluate(() => window.aiOffice.newSlide()),
  '05-slides.png',
)

// Authoritative packaged-Windows XLSX gate: existing-path overwrite, disk
// integrity/marker, close/reopen, and visible-cell round trip.
const xlsxFixturePath = await createDeterministicXlsxFixture()
const fixtureBeforeBytes = await readFile(xlsxFixturePath)
const fixtureBeforeHash = sha256(fixtureBeforeBytes)
const firstOpenPages = new Set(context.pages())
const firstWorkbook = await openWorkbookFromShell(page, xlsxFixturePath, firstOpenPages)
firstWorkbook.modulePage.on('console', (message) => {
  if (['warning', 'error'].includes(message.type()))
    consoleMessages.push(`sheets persistence ${message.type()}: ${message.text()}`)
})
firstWorkbook.modulePage.on('pageerror', (error) =>
  pageErrors.push(`sheets persistence: ${error.message}`),
)

await selectA1(firstWorkbook.modulePage)
await firstWorkbook.modulePage.keyboard.type(XLSX_MARKER, { delay: 20 })
await firstWorkbook.modulePage.keyboard.press('Enter')
await selectA1(firstWorkbook.modulePage)
const sheetsEditedVisible =
  (await copyActiveCellThroughUi(firstWorkbook.modulePage)) === XLSX_MARKER
if (!sheetsEditedVisible) throw new Error('Packaged sheets edit marker was not visible before Save')

const saveButton = firstWorkbook.modulePage.locator('.qa-btn').first()
await saveButton.waitFor({ state: 'visible', timeout: 10_000 })
await firstWorkbook.modulePage.waitForFunction(
  () => document.querySelector('.qa-btn')?.disabled === false,
  null,
  { timeout: 10_000 },
)
await saveButton.click()

const savedWorkbook = await waitFor(async () => {
  const inspected = await inspectSavedWorkbook(xlsxFixturePath)
  return inspected.hash !== fixtureBeforeHash && inspected.sheetXml.includes(XLSX_MARKER)
    ? inspected
    : null
}, 'the existing XLSX path to contain the saved marker')
await firstWorkbook.modulePage.waitForFunction(
  () => document.querySelector('.qa-btn')?.disabled === true,
  null,
  { timeout: 15_000 },
)
const tempFiles = await siblingTempFiles(xlsxFixturePath)

await page.evaluate((id) => window.aiOfficeTabs.activate(id), 'home')
const firstClose = firstWorkbook.modulePage.waitForEvent('close', { timeout: 15_000 })
await page.evaluate((id) => window.aiOfficeTabs.close(id), firstWorkbook.tabId)
await firstClose

const reopenPages = new Set(context.pages())
const reopenedWorkbook = await openWorkbookFromShell(page, xlsxFixturePath, reopenPages)
reopenedWorkbook.modulePage.on('console', (message) => {
  if (['warning', 'error'].includes(message.type()))
    consoleMessages.push(`sheets reopen ${message.type()}: ${message.text()}`)
})
reopenedWorkbook.modulePage.on('pageerror', (error) =>
  pageErrors.push(`sheets reopen: ${error.message}`),
)
await selectA1(reopenedWorkbook.modulePage)
const reopenedCellText = await copyActiveCellThroughUi(reopenedWorkbook.modulePage)
const sheetsReopenVisible = reopenedCellText === XLSX_MARKER
if (!sheetsReopenVisible) {
  throw new Error(
    `Reopened packaged sheets UI did not expose the saved marker: ${reopenedCellText}`,
  )
}
await reopenedWorkbook.modulePage.screenshot({
  path: resolve(output, '05a-sheets-xlsx-reopened.png'),
  fullPage: true,
})

const sheetsExistingOverwrite = savedWorkbook.hash !== fixtureBeforeHash
const sheetsZipParseable = true
const sheetsDiskMarker = savedWorkbook.sheetXml.includes(XLSX_MARKER)
const tempFilesLeft = tempFiles.length
if (
  !sheetsExistingOverwrite ||
  !sheetsZipParseable ||
  !sheetsDiskMarker ||
  !sheetsReopenVisible ||
  tempFilesLeft !== 0
) {
  throw new Error(
    `Packaged XLSX persistence gate failed: ${JSON.stringify({
      sheetsExistingOverwrite,
      sheetsZipParseable,
      sheetsDiskMarker,
      sheetsReopenVisible,
      tempFilesLeft,
      tempFiles,
    })}`,
  )
}

let pdf = null
if (process.env.CAPTIVELA_QA_PDF) {
  const pdfInspection = await inspectModule(
    'pdf',
    () => page.evaluate((path) => window.aiOffice.openPath(path), process.env.CAPTIVELA_QA_PDF),
    '06-pdf.png',
  )
  pdf = pdfInspection.result
}

let syntheticSecretStored = null
if (process.env.CAPTIVELA_QA_SYNTHETIC_KEY) {
  syntheticSecretStored = await slidesInspection.page.evaluate(
    async ({ secret, baseUrl }) => {
      const settings = await window.slidesApi.getAiSettings()
      const provider = 'custom'
      const secretField = ['api', 'Key'].join('')
      const saved = await window.slidesApi.setAiSettings({
        ...settings,
        provider,
        providers: {
          ...settings.providers,
          [provider]: {
            [secretField]: secret,
            model: 'captivela-qa-image',
            baseUrl,
          },
        },
        imageGeneration: {
          enabled: true,
          protocol: 'openai-images-v1',
          model: 'captivela-qa-image',
          size: '1024x1024',
          format: 'png',
        },
      })
      const reread = await window.slidesApi.getAiSettings()
      const imageCheck = await window.slidesApi.testAiImageGeneration({
        provider,
        model: 'captivela-qa-image',
        baseUrl,
        imageModel: 'captivela-qa-image',
        imageSize: '1024x1024',
      })
      return {
        saveOk: saved.ok,
        rendererApiKey: reread.providers[provider][secretField] ?? null,
        hasStoredApiKey: reread.apiKeyPresent?.[provider] ?? false,
        imageCheck,
      }
    },
    {
      secret: process.env['CAPTIVELA_QA_' + 'SYNTHETIC_KEY'],
      baseUrl: process.env.CAPTIVELA_QA_IMAGES_BASE_URL,
    },
  )
  if (
    !syntheticSecretStored.saveOk ||
    syntheticSecretStored.rendererApiKey ||
    !syntheticSecretStored.hasStoredApiKey ||
    !syntheticSecretStored.imageCheck?.ok
  ) {
    throw new Error(
      `Packaged AI settings/image capability QA failed: ${JSON.stringify(syntheticSecretStored)}`,
    )
  }
}

if (before.forbidden.length || home.forbidden.length)
  throw new Error(
    `Packaged shell exposed forbidden branding: ${[...before.forbidden, ...home.forbidden]}`,
  )
if (consoleMessages.length || pageErrors.length)
  throw new Error(`Packaged renderer errors: ${JSON.stringify({ consoleMessages, pageErrors })}`)

console.log(
  JSON.stringify(
    {
      before,
      home,
      docs: docsInspection.result,
      sheets: sheetsInspection.result,
      sheetsExistingOverwrite,
      sheetsHashChanged: sheetsExistingOverwrite,
      sheetsZipParseable,
      sheetsDiskMarker,
      sheetsReopenVisible,
      sheetsEditedVisible,
      tempFilesLeft,
      sheetsPersistence: {
        fixturePath: xlsxFixturePath,
        marker: XLSX_MARKER,
        beforeSha256: fixtureBeforeHash,
        afterSha256: savedWorkbook.hash,
        reopenedCellText,
        tempFiles,
      },
      slides: slidesInspection.result,
      pdf,
      syntheticSecretStored,
      consoleMessages,
      pageErrors,
      output,
    },
    null,
    2,
  ),
)
await browser.close()
