#!/usr/bin/env node

import { readFile, readdir, stat } from 'node:fs/promises'
import { extname, relative, resolve, sep } from 'node:path'
import process from 'node:process'

const root = resolve(import.meta.dirname, '..')
const config = JSON.parse(
  await readFile(resolve(import.meta.dirname, 'captivela-brand-allowlist.json'), 'utf8'),
)

const sourceRoots = ['apps', 'packages', 'tools']
const optionalBuiltRoots = [
  'apps/shell/out',
  'apps/docs/out',
  'apps/sheets/out',
  'apps/slides/out',
  'apps/pdf/out',
]
const sourceExtensions = new Set([
  '.cjs',
  '.css',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.mjs',
  '.scss',
  '.ts',
  '.tsx',
])
const builtExtensions = new Set(['.css', '.html', '.js', '.json', '.plist', '.yml', '.yaml'])
const forbidden = [
  { label: 'GenOffice product name', pattern: /\bGenOffice\b/gi },
  { label: 'Genspark product name', pattern: /\bGenspark\b/gi },
  { label: 'GenTeam product name', pattern: /\bGenTeam\b/gi },
  { label: 'upstream logo filename', pattern: /genoffice-logo/gi },
  { label: 'upstream public URL', pattern: /https?:\/\/(?:www\.)?genspark\.ai\/[\w./?=&%-]*/gi },
  { label: 'legacy public environment prefix', pattern: /\bGENOFFICE_[A-Z0-9_]+\b/g },
]

const pathExclusions = config.pathExclusions ?? []
const lineAllowPatterns = (config.lineAllowPatterns ?? []).map((value) => new RegExp(value, 'i'))
const fileAllowPatterns = (config.fileAllowPatterns ?? []).map((value) => new RegExp(value, 'i'))

function normalizePath(path) {
  return path.split(sep).join('/')
}

function pathExcluded(path) {
  const normalized = normalizePath(path)
  return pathExclusions.some((entry) =>
    entry.endsWith('/') ? normalized.includes(entry) : normalized === entry || normalized.endsWith(`/${entry}`),
  )
}

function lineAllowed(path, line) {
  return fileAllowPatterns.some((pattern) => pattern.test(path)) || lineAllowPatterns.some((pattern) => pattern.test(line))
}

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function collect(directory, extensions, output = []) {
  if (!(await exists(directory))) return output
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = resolve(directory, entry.name)
    const rel = normalizePath(relative(root, absolute))
    if (pathExcluded(rel)) continue
    if (entry.isDirectory()) {
      await collect(absolute, extensions, output)
      continue
    }
    if (entry.isFile() && extensions.has(extname(entry.name).toLowerCase())) output.push(absolute)
  }
  return output
}

const sourceFiles = []
for (const directory of sourceRoots) await collect(resolve(root, directory), sourceExtensions, sourceFiles)
const builtFiles = []
for (const directory of optionalBuiltRoots) await collect(resolve(root, directory), builtExtensions, builtFiles)
const files = [...new Set([...sourceFiles, ...builtFiles])]
const violations = []

for (const absolute of files) {
  const path = normalizePath(relative(root, absolute))
  let text
  try {
    text = await readFile(absolute, 'utf8')
  } catch {
    continue
  }
  const lines = text.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (lineAllowed(path, line)) continue
    for (const rule of forbidden) {
      rule.pattern.lastIndex = 0
      if (rule.pattern.test(line)) {
        violations.push({ path, line: index + 1, label: rule.label, text: line.trim() })
      }
    }
  }
}

if (violations.length > 0) {
  console.error(`Captivela branding audit failed: ${violations.length} violation(s).`)
  for (const violation of violations) {
    console.error(`${violation.path}:${violation.line} [${violation.label}] ${violation.text}`)
  }
  process.exitCode = 1
} else {
  console.log(`Captivela branding audit passed (${sourceFiles.length} source files, ${builtFiles.length} built files scanned).`)
}
