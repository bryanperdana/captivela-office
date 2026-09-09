import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BRAND = join(ROOT, 'packages/ui/src/brand')

const files = [
  [
    'assets/captivela-wordmark-blue-2363x715.png',
    '54d734d506ce339cc75768c185a7559b621234c51b2dcea2558fd5adff12f548',
    2363,
    715,
  ],
  [
    'assets/captivela-wordmark-ink-2363x715.png',
    '41cf4a9beafde2715f0f5a5fe4597ce6a595c78e70dc308f2a4d9372fb612624',
    2363,
    715,
  ],
  [
    'assets/captivela-wordmark-white-2363x715.png',
    '6a5ec89ee3a0b28b6a4155bcaf8707eec8f9ebcd79d3e3714310dfa501ee4158',
    2363,
    715,
  ],
  [
    'assets/captivela-wordmark-amber-2363x715.png',
    '2698d23b7e516e95020f229941d6f63625690ce081007ca21444fa4c144d5977',
    2363,
    715,
  ],
  [
    'assets/captivela-platform-icon-c-transparent-1024.png',
    '7bd4fe119015160a31a87c390a96cf6486d9f57764fbe7ec437375031df98bde',
    1024,
    1024,
  ],
]

const fontFiles = [
  [
    'fonts/geist-latin-variable-wght-normal.woff2',
    '19f9c92546aa300c312235e3125af1b81394d8db9a4bc4a425cd5b641d2d54e1',
  ],
  [
    'fonts/geist-latin-ext-variable-wght-normal.woff2',
    '824f485b5d26e2f2da3c2b236132ece1bc8e4e43373452950bb0e40548b4313f',
  ],
  [
    'fonts/geist-mono-latin-variable-wght-normal.woff2',
    '684ad5b531f81d43c1e8c7038262d5db7cdc1f68006e04d6c7769efa8d33c8cc',
  ],
  [
    'fonts/geist-mono-latin-ext-variable-wght-normal.woff2',
    '1a189eb997c3e2ece68373e387afaec9e8617424186c4b1ab3cff7c54ba6223b',
  ],
  ['fonts/OFL-1.1.txt', '71609cbb5c78b5870d712eab73a31d76622635c6ed034ab5cee3b9ecbda8685f'],
]

const errors = []
const sha256 = (data) => createHash('sha256').update(data).digest('hex')

for (const [relative, expectedHash, expectedWidth, expectedHeight] of files) {
  const data = readFileSync(join(BRAND, relative))
  const actualHash = sha256(data)
  const width = data.readUInt32BE(16)
  const height = data.readUInt32BE(20)
  if (actualHash !== expectedHash)
    errors.push(`${relative}: SHA-256 ${actualHash}, expected ${expectedHash}`)
  if (width !== expectedWidth || height !== expectedHeight) {
    errors.push(`${relative}: ${width}x${height}, expected ${expectedWidth}x${expectedHeight}`)
  }
}

for (const [relative, expectedHash] of fontFiles) {
  const actualHash = sha256(readFileSync(join(BRAND, relative)))
  if (actualHash !== expectedHash)
    errors.push(`${relative}: SHA-256 ${actualHash}, expected ${expectedHash}`)
}

const tokens = readFileSync(join(BRAND, 'tokens.css'), 'utf8').toLowerCase()
const requiredTokens = {
  '--captivela-blue': '#0000f1',
  '--captivela-blue-deep': '#0000a8',
  '--captivela-amber': '#e67d22',
  '--captivela-amber-deep': '#a85610',
  '--captivela-ink': '#08080f',
  '--captivela-paper': '#f5f3ee',
  '--captivela-slate': '#3a3d4a',
  '--captivela-muted': '#6e7180',
  '--captivela-radius-icon': '4px',
  '--captivela-radius-control': '6px',
  '--captivela-radius-panel': '8px',
  '--captivela-space-1': '8px',
}
for (const [name, value] of Object.entries(requiredTokens)) {
  if (!tokens.includes(`${name}: ${value}`)) errors.push(`tokens.css: missing ${name}: ${value}`)
}
for (const value of ['rgba(8, 8, 15, 0.13)', 'rgba(245, 243, 238, 0.16)']) {
  if (!tokens.includes(value)) errors.push(`tokens.css: missing ${value}`)
}

const fontsCss = readFileSync(join(BRAND, 'fonts.css'), 'utf8')
if ((fontsCss.match(/@font-face/g) ?? []).length !== 4)
  errors.push('fonts.css: expected four local @font-face rules')
if (/https?:\/\//.test(fontsCss)) errors.push('fonts.css: runtime remote font URL is forbidden')

const components = readFileSync(join(BRAND, 'components.css'), 'utf8')
if (!components.includes('.captivela-app-chrome'))
  errors.push('components.css: missing scoped chrome class')
if (/(^|[},]\s*)(html|body|#root)(\s|,|\{|$)/m.test(components)) {
  errors.push('components.css: application styling must not target global rendered-content roots')
}

const entrypoints = [
  'apps/shell/src/renderer/src/main.tsx',
  'apps/docs/src/renderer/main.tsx',
  'apps/sheets/src/renderer/main.tsx',
  'apps/slides/src/renderer/main.tsx',
  'apps/pdf/src/renderer/main.tsx',
]
for (const file of entrypoints) {
  const text = readFileSync(join(ROOT, file), 'utf8')
  const shared = text.indexOf("import '@genoffice/ui/brand.css'")
  const local = text.search(/import ['"]\.\/[^'"]+\.css['"]/)
  if (shared < 0) errors.push(`${file}: missing @genoffice/ui/brand.css import`)
  if (local >= 0 && shared > local)
    errors.push(`${file}: shared brand CSS must load before local CSS`)
}

const logo = readFileSync(join(BRAND, 'BrandLogo.tsx'), 'utf8')
if (logo.includes('platform-icon'))
  errors.push('BrandLogo must not expose the platform-only standalone C')
for (const variant of ['blue', 'ink', 'white', 'amber']) {
  if (!logo.includes(`${variant}:`)) errors.push(`BrandLogo: missing ${variant} variant`)
}

if (errors.length > 0) {
  console.error(`Captivela brand validation failed (${errors.length}):`)
  for (const error of errors) console.error(`  - ${error}`)
  process.exit(1)
}

console.log(
  `Captivela brand validation passed: ${files.length} assets, ${fontFiles.length} font/license files, ${entrypoints.length} renderer imports, and production token checks.`,
)
