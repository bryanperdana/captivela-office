const { existsSync, readFileSync, statSync } = require('node:fs')
const { join, resolve } = require('node:path')

const WINDOWS_AMD64_MACHINE = 0x8664

function assertFile(path, label) {
  if (!existsSync(path)) throw new Error(`Windows package input missing: ${label} (${path})`)
  const stat = statSync(path)
  if (!stat.isFile() || stat.size === 0)
    throw new Error(`Windows package input is empty or not a file: ${label} (${path})`)
}

function assertDirectory(path, label) {
  if (!existsSync(path) || !statSync(path).isDirectory())
    throw new Error(`Windows package input missing: ${label} (${path})`)
}

function readPeMachine(path) {
  const bytes = readFileSync(path)
  if (bytes.length < 64 || bytes[0] !== 0x4d || bytes[1] !== 0x5a)
    throw new Error(`Windows sidecar is not a PE executable: ${path}`)
  const peOffset = bytes.readUInt32LE(0x3c)
  if (peOffset + 6 > bytes.length || bytes.toString('ascii', peOffset, peOffset + 4) !== 'PE\0\0')
    throw new Error(`Windows sidecar has an invalid PE header: ${path}`)
  return bytes.readUInt16LE(peOffset + 4)
}

function verifyWindowsPackageInputs(options = {}) {
  const root = resolve(options.root ?? join(__dirname, '..'))
  const modules = ['docs', 'sheets', 'slides', 'pdf']
  for (const module of modules)
    assertDirectory(join(root, 'apps', module, 'out'), `${module} module output`)

  assertFile(join(root, 'apps', 'shell', 'build', 'THIRD-PARTY-NOTICES.txt'), 'third-party notices')
  assertFile(join(root, 'apps', 'shell', 'build', 'icon.ico'), 'Windows icon')

  const sidecar = join(
    root,
    'apps',
    'sheets',
    'native',
    'xlsx-engine',
    'target',
    'x86_64-pc-windows-msvc',
    'release',
    'xlsx-sidecar.exe',
  )
  assertFile(sidecar, 'Windows x64 XLSX sidecar')
  const machine = readPeMachine(sidecar)
  if (machine !== WINDOWS_AMD64_MACHINE)
    throw new Error(
      `Windows sidecar has wrong PE machine 0x${machine.toString(16)}; expected AMD64 0x8664`,
    )

  return { root, sidecar, machine: 'x86_64' }
}

if (require.main === module) {
  const result = verifyWindowsPackageInputs({ root: process.argv[2] })
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

module.exports = { WINDOWS_AMD64_MACHINE, readPeMachine, verifyWindowsPackageInputs }
