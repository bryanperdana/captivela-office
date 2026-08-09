import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export const CAPTIVELA_PRODUCT_NAME = 'Captivela Office'
export const CAPTIVELA_DOCUMENTS_DIRNAME = CAPTIVELA_PRODUCT_NAME
export const CAPTIVELA_DEV_USER_DATA_DIRNAME = `${CAPTIVELA_PRODUCT_NAME} Dev`
export const LEGACY_DOCUMENTS_DIRNAME = 'GenOffice'

export interface ProductEnvironment {
  CAPTIVELA_OFFICE_USER_DATA?: string
  CAPTIVELA_OFFICE_LANG?: string
  CAPTIVELA_OFFICE_UPDATE_URL?: string
  CAPTIVELA_OFFICE_FAKE_UPDATE?: string
  GENOFFICE_USER_DATA?: string
  GENOFFICE_LANG?: string
  GENOFFICE_UPDATE_URL?: string
  GENOFFICE_FAKE_UPDATE?: string
}

export function readProductEnvironment(
  environment: ProductEnvironment,
  currentName: keyof ProductEnvironment,
  legacyName: keyof ProductEnvironment,
): string | undefined {
  return environment[currentName] || environment[legacyName] || undefined
}

export function productDocumentsDir(documentsRoot: string): string {
  return join(documentsRoot, CAPTIVELA_DOCUMENTS_DIRNAME)
}

export function legacyDocumentsDir(documentsRoot: string): string {
  return join(documentsRoot, LEGACY_DOCUMENTS_DIRNAME)
}

export function productDevUserDataDir(appDataRoot: string): string {
  return join(appDataRoot, CAPTIVELA_DEV_USER_DATA_DIRNAME)
}

/**
 * Copies a legacy directory into the Captivela location only when the target is
 * absent or empty. The legacy directory is deliberately never removed. Existing
 * target files always win, making the operation idempotent and non-destructive.
 */
export function migrateLegacyDirectory(target: string, legacyCandidates: string[]): boolean {
  const targetHasContent = existsSync(target) && readdirSync(target).length > 0
  if (targetHasContent) return false

  const legacy = legacyCandidates.find(
    (candidate) => candidate !== target && existsSync(candidate) && readdirSync(candidate).length > 0,
  )
  if (!legacy) {
    mkdirSync(target, { recursive: true })
    return false
  }

  mkdirSync(target, { recursive: true })
  cpSync(legacy, target, { recursive: true, force: false, errorOnExist: false })
  return true
}

export function ensureProductDocumentsDir(documentsRoot: string): string {
  const target = productDocumentsDir(documentsRoot)
  migrateLegacyDirectory(target, [legacyDocumentsDir(documentsRoot)])
  return target
}
