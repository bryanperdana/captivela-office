/**
 * electron-builder configuration (moved out of package.json "build" so the
 * auto-update feed URL can be injected at build time instead of living in
 * the repo).
 *
 * CAPTIVELA_OFFICE_UPDATE_URL — public base URL of the update channel (the generic
 * provider prefix that serves latest.yml / latest-mac.yml). Required for
 * release builds; CI provides it as a repository secret. For local release
 * builds put it in apps/shell/electron-builder.env (gitignored) — the
 * electron-builder CLI loads that file automatically.
 *
 * When the variable is unset (forks, PR smoke builds, plain local packaging)
 * the publish config is omitted: electron-builder then bakes no
 * app-update.yml into the app and in-app auto-update stays disabled.
 *
 * CAPTIVELA_OFFICE_RELEASE_SIGNING — set to "1" for a release build that must be
 * signed, hardened and notarized. Unset (the default) produces an unsigned
 * local package: the BYOK build talks only to the user's own endpoint, so a
 * contributor packaging it on their own Mac needs no Apple Developer identity,
 * and electron-builder must not fail looking for one.
 */

const { existsSync } = require('node:fs')
const { join } = require('node:path')
const { verifyWindowsPackageInputs } = require('../../tools/windows-package-inputs.cjs')

const updateUrl = process.env.CAPTIVELA_OFFICE_UPDATE_URL || process.env.GENOFFICE_UPDATE_URL
const releaseSigning = process.env.CAPTIVELA_OFFICE_RELEASE_SIGNING === '1'

// The module trees are electron-vite outputs produced by build:all; a missing
// one means that module's build did not run or failed. electron-builder only
// logs "file source doesn't exist" for an absent extraResources source and
// still exits 0, so without this the installer launches normally and is simply
// missing that editor — it surfaces only when a user opens the tab.
//
// Runs from the beforePack hook, not at module load: gen-third-party-notices
// requires this config to read extraResources, and the dist:* scripts run
// notices before build:all, when the out dirs legitimately don't exist yet.
function assertModuleTreesPresent() {
  for (const rel of ['../docs/out', '../sheets/out', '../slides/out', '../pdf/out']) {
    if (!existsSync(join(__dirname, rel))) {
      throw new Error(
        `electron-builder extraResources source missing: ${rel} (run npm run build:all first)`,
      )
    }
  }
}

/** @type {import('electron-builder').Configuration} */
const config = {
  appId: 'com.captivela.office',
  productName: 'Captivela Office',
  electronVersion: '41.7.1',
  directories: {
    output: 'release',
  },
  files: ['out/**'],
  extraResources: [
    {
      from: 'build/THIRD-PARTY-NOTICES.txt',
      to: 'THIRD-PARTY-NOTICES.txt',
    },
    {
      from: '../../node_modules/electron/dist/LICENSES.chromium.html',
      to: 'LICENSES.chromium.html',
    },
    {
      from: '../docs/out',
      to: 'modules/docs',
    },
    {
      from: '../sheets/out',
      to: 'modules/sheets',
    },
    {
      from: '../slides/out',
      to: 'modules/slides',
    },
    {
      from: '../pdf/out',
      to: 'modules/pdf',
    },
    // The upstream build also shipped its hosted-service CLI tree here. The
    // BYOK build keeps hosted-service capabilities disabled, so
    // the CLI and its hoisting preflight are gone: nothing in the package
    // would run it.
  ],
  // `mimeType` is read only by the Linux target, where it becomes the
  // desktop entry's MimeType= list; associations without it are dropped
  // there. macOS and Windows ignore the field and key off `ext`.
  fileAssociations: [
    {
      ext: 'docx',
      name: 'Word Document',
      role: 'Editor',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    },
    {
      ext: 'xlsx',
      name: 'Excel Workbook',
      role: 'Editor',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    },
    {
      ext: 'pptx',
      name: 'PowerPoint Presentation',
      role: 'Editor',
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    },
    {
      ext: 'xls',
      name: 'Excel 97-2003 Workbook',
      role: 'Editor',
      mimeType: 'application/vnd.ms-excel',
    },
    {
      ext: 'csv',
      name: 'CSV Document',
      role: 'Editor',
      mimeType: 'text/csv',
    },
    {
      ext: 'pdf',
      name: 'PDF Document',
      role: 'Editor',
      mimeType: 'application/pdf',
    },
  ],
  npmRebuild: false,
  forceCodeSigning: releaseSigning,
  mac: {
    target: ['dmg', 'zip'],
    category: 'public.app-category.productivity',
    // Signing, the hardened runtime and notarization only apply to a release
    // build. `identity: null` is what makes electron-builder skip codesigning
    // outright rather than searching the keychain and failing.
    hardenedRuntime: releaseSigning,
    gatekeeperAssess: false,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    notarize: releaseSigning,
    ...(releaseSigning ? {} : { identity: null }),
    extraResources: [
      {
        from: '../sheets/native/xlsx-engine/target/release/xlsx-sidecar',
        to: 'native/xlsx-sidecar',
      },
    ],
  },
  win: {
    icon: 'build/icon.ico',
    artifactName: 'Captivela Office Setup ${version}.${ext}',
    target: [
      {
        target: 'nsis',
        arch: ['x64'],
      },
    ],
    extraResources: [
      {
        from: '../sheets/native/xlsx-engine/target/x86_64-pc-windows-msvc/release/xlsx-sidecar.exe',
        to: 'native/xlsx-sidecar.exe',
      },
    ],
  },
  // Unlike win (which cross-compiles the sidecar to an explicit target
  // triple), linux takes it from cargo's host-native target/release/ — the
  // same source mac uses. So no `arch` is pinned here: electron-builder
  // defaults to the build host's architecture, which is the only one the
  // sidecar was actually built for. Packaging arm64 on an x64 host, or the
  // reverse, needs a matching `cargo build --target` first.
  linux: {
    // AppImage only: it needs no packaging identity, whereas deb/rpm would
    // require a Debian maintainer and homepage in the repo metadata.
    target: ['AppImage'],
    category: 'Office',
    icon: 'build/icon.png',
    // mac and win name the binary from productName; linux instead derives it
    // from package.json "name", and "@genoffice/shell" sanitizes to the
    // invalid "@genofficeshell". Setting it explicitly also makes the
    // generated captivela-office.desktop match the WM_CLASS Electron reports (it
    // takes that from the executable basename), so the running window links
    // back to its launcher entry.
    executableName: 'captivela-office',
    // Electron takes its X11 app_id from package.json "desktopName"
    // (captivela-office.desktop); syncDesktopName makes electron-builder name the
    // .desktop file and its StartupWMClass from the same value. Without it
    // StartupWMClass falls back to productName ("Captivela Office"), which does not
    // match the "captivela-office" WM_CLASS the window actually reports — and X11
    // compares case-sensitively, so the taskbar shows an unlinked window.
    syncDesktopName: true,
    extraResources: [
      {
        from: '../sheets/native/xlsx-engine/target/release/xlsx-sidecar',
        to: 'native/xlsx-sidecar',
      },
    ],
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    shortcutName: 'Captivela Office',
    uninstallDisplayName: 'Captivela Office',
  },
  beforePack: async (context) => {
    assertModuleTreesPresent()
    if (context.electronPlatformName === 'win32')
      verifyWindowsPackageInputs({ root: join(__dirname, '../..') })
  },
  dmg: {
    sign: releaseSigning,
  },
  // notarize-dmg.js already no-ops without Apple credentials; not registering
  // it at all keeps an unsigned local build from even shelling out to xcrun.
  ...(releaseSigning ? { afterAllArtifactBuild: 'build/notarize-dmg.js' } : {}),
}

if (updateUrl) {
  config.publish = [
    {
      provider: 'generic',
      url: updateUrl.replace(/\/+$/, ''),
      channel: 'latest',
    },
  ]
}

module.exports = config
