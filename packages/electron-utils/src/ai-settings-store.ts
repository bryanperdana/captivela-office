/**
 * Single owner of AI settings on disk, shared by every app's main process so
 * the JSON read/write/migrate logic exists once instead of per app.
 *
 * Two files:
 *   ai-settings.json — non-secret configuration (provider, model, base URL,
 *                      custom instructions). API keys are always written as "".
 *   ai-secrets.json  — API keys, encrypted with Electron `safeStorage`
 *                      (macOS Keychain-backed).
 *
 * `safeStorage` is main-process only, so it is injected as a `SecretCipher`
 * rather than imported: this module stays pure TypeScript over node:fs and is
 * directly testable with a fake cipher.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  defaultAiSettings,
  resolveAiSettings,
  sanitizeAiSettingsForRenderer,
  type AiProviderId,
  type AiSettings,
  type LegacyAiSettings,
} from '@genoffice/ai-provider'

/** The subset of Electron's `safeStorage` this module needs. */
export interface SecretCipher {
  isEncryptionAvailable(): boolean
  encryptString(plainText: string): Buffer
  decryptString(encrypted: Buffer): string
}

interface SecretsFile {
  version: 1
  /** false only on a platform with no OS keychain; see `write` for the warning path */
  encrypted: boolean
  keys: Partial<Record<AiProviderId, string>>
}

export interface AiSettingsStoreOptions {
  /** Path of ai-settings.json (usually userData/ai-settings.json). */
  settingsPath: string
  /** Defaults to ai-secrets.json beside the settings file. */
  secretsPath?: string
  /** Electron's `safeStorage`; null disables encryption (tests, headless tools). */
  cipher?: SecretCipher | null
  onWarn?: (message: string) => void
}

export interface AiSettingsStore {
  /** Full settings including API keys. Main process only — never send this to a renderer. */
  read(): AiSettings
  /** Settings with keys replaced by `apiKeyPresent` flags; this is what `ai:get-settings` returns. */
  readForRenderer(): AiSettings
  /**
   * Persist validated settings. A blank `apiKey` means "leave the stored key
   * alone" — the renderer never receives keys, so it cannot echo one back, and
   * an empty field must not silently wipe a working configuration. Use
   * `clearApiKey` to remove one.
   */
  write(settings: AiSettings): void
  /** Stored key for a provider (''), read fresh so an external edit is picked up. */
  apiKeyFor(provider: AiProviderId): string
  clearApiKey(provider: AiProviderId): void
  /** True when keys are encrypted at rest. */
  isEncryptionAvailable(): boolean
}

function readJsonFile<T>(path: string, fallback: T): T {
  try {
    if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf-8')) as T
  } catch {
    /* corrupted state file: fall back to defaults rather than failing startup */
  }
  return fallback
}

/**
 * Write via a temp file + rename so a crash mid-write cannot leave a truncated
 * settings file, and with 0600 so the secrets file is not group/world readable.
 */
function writeJsonFile(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 })
  renameSync(tmp, path)
}

export function createAiSettingsStore(options: AiSettingsStoreOptions): AiSettingsStore {
  const { settingsPath } = options
  const secretsPath = options.secretsPath ?? join(dirname(settingsPath), 'ai-secrets.json')
  const cipher = options.cipher ?? null
  const warn = options.onWarn ?? ((message: string) => console.warn(`[ai-settings] ${message}`))
  let warnedAboutPlaintext = false

  const encryptionAvailable = (): boolean => {
    try {
      return cipher?.isEncryptionAvailable() ?? false
    } catch {
      return false
    }
  }

  function readSecrets(): SecretsFile {
    const raw = readJsonFile<Partial<SecretsFile>>(secretsPath, {})
    const keys: Partial<Record<AiProviderId, string>> = {}
    const encrypted = raw.encrypted !== false
    for (const [id, stored] of Object.entries(raw.keys ?? {})) {
      if (typeof stored !== 'string' || !stored) continue
      if (!encrypted) {
        keys[id as AiProviderId] = stored
        continue
      }
      try {
        keys[id as AiProviderId] = cipher!.decryptString(Buffer.from(stored, 'base64'))
      } catch {
        // A key encrypted under a different OS user/keychain cannot be read
        // back; drop it so the app prompts for a new one instead of sending
        // ciphertext as the Authorization header.
        warn(`could not decrypt the stored ${id} API key; re-enter it in Settings`)
      }
    }
    return { version: 1, encrypted, keys }
  }

  function writeSecrets(keys: Partial<Record<AiProviderId, string>>): void {
    const usable = Object.entries(keys).filter(([, value]) => Boolean(value))
    if (usable.length === 0) {
      if (existsSync(secretsPath)) {
        try {
          unlinkSync(secretsPath)
        } catch {
          writeJsonFile(secretsPath, { version: 1, encrypted: encryptionAvailable(), keys: {} })
        }
      }
      return
    }
    if (encryptionAvailable()) {
      const encoded: Record<string, string> = {}
      for (const [id, value] of usable) {
        encoded[id] = cipher!.encryptString(value as string).toString('base64')
      }
      writeJsonFile(secretsPath, { version: 1, encrypted: true, keys: encoded } satisfies SecretsFile)
      return
    }
    // No OS keychain (some Linux desktops, or Electron not yet ready). The key
    // still stays out of ai-settings.json and the file is 0600, but it is not
    // encrypted at rest — say so once rather than failing the save.
    if (!warnedAboutPlaintext) {
      warnedAboutPlaintext = true
      warn(
        `OS encryption is unavailable; API keys are stored unencrypted in ${secretsPath} (owner-readable only)`,
      )
    }
    writeJsonFile(secretsPath, {
      version: 1,
      encrypted: false,
      keys: Object.fromEntries(usable),
    } satisfies SecretsFile)
  }

  /**
   * Move any plaintext key still living in ai-settings.json into secure
   * storage. The plaintext copy is removed only after the secure write returns,
   * so an interrupted migration is retried on the next read instead of losing
   * the key.
   */
  function migratePlaintextKeys(
    settings: AiSettings,
    secrets: SecretsFile,
  ): Partial<Record<AiProviderId, string>> {
    const plaintext = Object.entries(settings.providers).filter(([, config]) => config.apiKey)
    if (plaintext.length === 0) return secrets.keys
    const merged = { ...secrets.keys }
    for (const [id, config] of plaintext) {
      // an already-migrated key wins: it is the one the user last saved
      if (!merged[id as AiProviderId]) merged[id as AiProviderId] = config.apiKey
    }
    writeSecrets(merged)
    writeJsonFile(settingsPath, withoutSecrets(settings))
    warn(`migrated ${plaintext.length} plaintext API key(s) out of ${settingsPath}`)
    return merged
  }

  /** The on-disk shape of ai-settings.json: no keys, no renderer-only UX state. */
  function withoutSecrets(settings: AiSettings): AiSettings {
    const providers = {} as AiSettings['providers']
    for (const [id, config] of Object.entries(settings.providers)) {
      providers[id as AiProviderId] = { ...config, apiKey: '' }
    }
    const copy: AiSettings = { ...settings, providers }
    delete copy.apiKeyPresent
    return copy
  }

  function read(): AiSettings {
    const stored = readJsonFile<Partial<AiSettings> & LegacyAiSettings>(settingsPath, {})
    const settings = resolveAiSettings(stored, defaultAiSettings())
    const keys = migratePlaintextKeys(settings, readSecrets())
    for (const [id, key] of Object.entries(keys)) {
      const config = settings.providers[id as AiProviderId]
      if (config && key) config.apiKey = key
    }
    return settings
  }

  return {
    read,
    readForRenderer: () => sanitizeAiSettingsForRenderer(read()),
    write(settings) {
      const secrets = readSecrets()
      const keys = { ...secrets.keys }
      for (const [id, config] of Object.entries(settings.providers)) {
        if (config.apiKey) keys[id as AiProviderId] = config.apiKey
      }
      writeSecrets(keys)
      writeJsonFile(settingsPath, withoutSecrets(settings))
    },
    apiKeyFor: (provider) => readSecrets().keys[provider] ?? '',
    clearApiKey(provider) {
      const keys = { ...readSecrets().keys }
      delete keys[provider]
      writeSecrets(keys)
    },
    isEncryptionAvailable: encryptionAvailable,
  }
}
