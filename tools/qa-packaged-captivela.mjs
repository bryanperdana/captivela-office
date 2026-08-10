#!/usr/bin/env node

/* global document, getComputedStyle */
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

const newDocument = page.getByText(/AI Docs|New Document|Dokumen Baru/i).first()
let docs = null
if (await newDocument.count()) {
  await newDocument.click()
  await page.waitForTimeout(1800)
  const currentPages = context.pages()
  const modulePage = currentPages.find((candidate) =>
    candidate.url().includes('/modules/docs/renderer/index.html'),
  )
  if (modulePage) {
    docs = await modulePage.evaluate(() => {
      const text = document.body.innerText
      return {
        title: document.title,
        bodyText: text.slice(0, 3000),
        forbidden: ['GenOffice', 'Genspark', 'GenTeam'].filter((term) => text.includes(term)),
        chrome: Boolean(document.querySelector('.captivela-app-chrome')),
        chromeFont: getComputedStyle(
          document.querySelector('.ribbon-tabs') ?? document.querySelector('.captivela-app-chrome'),
        ).fontFamily,
        documentFont: document.querySelector('.doc-page')
          ? getComputedStyle(document.querySelector('.doc-page')).fontFamily
          : null,
      }
    })
    await modulePage.screenshot({ path: resolve(output, '03-docs.png'), fullPage: true })
  }
}

console.log(JSON.stringify({ before, home, docs, consoleMessages, pageErrors, output }, null, 2))
await browser.close()
