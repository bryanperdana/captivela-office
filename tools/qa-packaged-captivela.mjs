#!/usr/bin/env node

/* global document, getComputedStyle, window */
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'

const endpoint = process.env.CAPTIVELA_CDP ?? 'http://127.0.0.1:9333'
const output = resolve(
  process.env.CAPTIVELA_QA_OUTPUT ??
    `${process.env.HOME}/Documents/Hermes-Output/apps/captivela-office/qa/packaged`,
)
await mkdir(output, { recursive: true })

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
    async ({ apiKey, baseUrl }) => {
      const settings = await window.slidesApi.getAiSettings()
      const provider = 'custom'
      const saved = await window.slidesApi.setAiSettings({
        ...settings,
        provider,
        providers: {
          ...settings.providers,
          [provider]: { apiKey, model: 'captivela-qa-image', baseUrl },
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
        rendererApiKey: reread.providers[provider]?.apiKey ?? null,
        hasStoredApiKey: reread.providers[provider]?.hasStoredApiKey ?? false,
        imageCheck,
      }
    },
    {
      apiKey: process.env.CAPTIVELA_QA_SYNTHETIC_KEY,
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
