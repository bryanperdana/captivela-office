const { existsSync, readFileSync, statSync } = require('node:fs')
const { join, resolve } = require('node:path')

const ELF_MACHINE_X86_64 = 0x3e

function assertFile(path, label) {
  if (!existsSync(path)) throw new Error(`Linux package input missing: ${label} (${path})`)
  const stat = statSync(path)
  if (!stat.isFile() || stat.size === 0)
    throw new Error(`Linux package input is empty or not a file: ${label} (${path})`)
  return stat
}

function assertDirectory(path, label) {
  if (!existsSync(path) || !statSync(path).isDirectory())
    throw new Error(`Linux package input missing: ${label} (${path})`)
}

function readElfMachine(path) {
  const bytes = readFileSync(path)
  if (
    bytes.length < 20 ||
    bytes.toString('binary', 0, 4) !== '\x7fELF' ||
    bytes[4] !== 2 ||
    bytes[5] !== 1
  ) {
    throw new Error(`Linux sidecar is not a 64-bit little-endian ELF executable: ${path}`)
  }
  return bytes.readUInt16LE(18)
}

function verifyLinuxPackageInputs(options = {}) {
  const root = resolve(options.root ?? join(__dirname, '..'))
  for (const module of ['docs', 'sheets', 'slides', 'pdf'])
    assertDirectory(join(root, 'apps', module, 'out'), `${module} module output`)

  assertFile(join(root, 'apps', 'shell', 'build', 'THIRD-PARTY-NOTICES.txt'), 'third-party notices')
  assertFile(join(root, 'apps', 'shell', 'build', 'icon.png'), 'Linux icon')

  const sidecar = join(
    root,
    'apps',
    'sheets',
    'native',
    'xlsx-engine',
    'target',
    'release',
    'xlsx-sidecar',
  )
  const stat = assertFile(sidecar, 'Linux x64 XLSX sidecar')
  if ((stat.mode & 0o111) === 0)
    throw new Error(`Linux x64 XLSX sidecar is not executable: ${sidecar}`)

  const machine = readElfMachine(sidecar)
  if (machine !== ELF_MACHINE_X86_64)
    throw new Error(
      `Linux sidecar has wrong ELF machine 0x${machine.toString(16)}; expected x86_64 0x3e`,
    )

  return { root, sidecar, machine: 'x86_64' }
}

if (require.main === module) {
  const result = verifyLinuxPackageInputs({ root: process.argv[2] })
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

module.exports = { ELF_MACHINE_X86_64, readElfMachine, verifyLinuxPackageInputs }
