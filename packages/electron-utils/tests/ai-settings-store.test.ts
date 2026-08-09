import { mkdtempSync, readFileSync, rmSync, existsSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAiSettingsStore, type SecretCipher } from '../src/ai-settings-store'

/** Stand-in for Electron `safeStorage`: reversible, and obviously not plaintext. */
function fakeCipher(available = true): SecretCipher {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plain) => Buffer.from(`enc:${plain}`, 'utf-8'),
    decryptString: (buf) => {
      const text = buf.toString('utf-8')
      if (!text.startsWith('enc:')) throw new Error('not encrypted by this cipher')
      return text.slice(4)
    },
  }
}

let dir: string
let settingsPath: string
let secretsPath: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'byok-settings-'))
  settingsPath = join(dir, 'ai-settings.json')
  secretsPath = join(dir, 'ai-secrets.json')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const store = (cipher: SecretCipher | null = fakeCipher(), onWarn = vi.fn()) =>
  createAiSettingsStore({ settingsPath, cipher, onWarn })

describe('createAiSettingsStore', () => {
  it('returns BYOK defaults when nothing is on disk', () => {
    const settings = store().read()
    expect(settings.provider).toBe('openai')
    expect(settings.providers.openai.apiKey).toBe('')
    expect(existsSync(settingsPath)).toBe(false)
  })

  it('keeps the API key out of ai-settings.json and encrypts it in ai-secrets.json', () => {
    const s = store()
    const settings = s.read()
    settings.providers.openai.apiKey = 'sk-live-secret'
    settings.providers.openai.model = 'gpt-4o'
    s.write(settings)

    const onDisk = readFileSync(settingsPath, 'utf-8')
    expect(onDisk).not.toContain('sk-live-secret')
    expect(JSON.parse(onDisk).providers.openai.apiKey).toBe('')
    expect(JSON.parse(onDisk).providers.openai.model).toBe('gpt-4o')

    const secrets = JSON.parse(readFileSync(secretsPath, 'utf-8'))
    expect(secrets.encrypted).toBe(true)
    expect(readFileSync(secretsPath, 'utf-8')).not.toContain('sk-live-secret')
    expect(Buffer.from(secrets.keys.openai, 'base64').toString()).toBe('enc:sk-live-secret')

    expect(s.read().providers.openai.apiKey).toBe('sk-live-secret')
    expect(s.apiKeyFor('openai')).toBe('sk-live-secret')
  })

  it('writes both files owner-readable only', () => {
    const s = store()
    const settings = s.read()
    settings.providers.openai.apiKey = 'sk-live-secret'
    s.write(settings)
    expect(statSync(settingsPath).mode & 0o777).toBe(0o600)
    expect(statSync(secretsPath).mode & 0o777).toBe(0o600)
  })

  it('migrates a plaintext key out of ai-settings.json on first read', () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({
        provider: 'openai',
        providers: { openai: { apiKey: 'sk-plaintext-legacy', model: 'gpt-4o', baseUrl: '' } },
      }),
    )
    const onWarn = vi.fn()
    const s = store(fakeCipher(), onWarn)

    const settings = s.read()
    expect(settings.providers.openai.apiKey).toBe('sk-plaintext-legacy')
    expect(readFileSync(settingsPath, 'utf-8')).not.toContain('sk-plaintext-legacy')
    expect(existsSync(secretsPath)).toBe(true)
    expect(readFileSync(secretsPath, 'utf-8')).not.toContain('sk-plaintext-legacy')
    expect(onWarn).toHaveBeenCalledWith(expect.stringContaining('migrated 1 plaintext API key'))

    // idempotent: a second read has nothing left to migrate
    onWarn.mockClear()
    expect(s.read().providers.openai.apiKey).toBe('sk-plaintext-legacy')
    expect(onWarn).not.toHaveBeenCalled()
  })

  it('migrates the pre-provider legacy shape too', () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({ baseUrl: 'https://api.example.com/v1', apiKey: 'sk-old', model: 'gpt-4o' }),
    )
    const settings = store().read()
    expect(settings.providers.custom.apiKey).toBe('sk-old')
    expect(readFileSync(settingsPath, 'utf-8')).not.toContain('sk-old')
  })

  it('keeps the already-secured key when a stale plaintext copy is also present', () => {
    const s = store()
    const settings = s.read()
    settings.providers.openai.apiKey = 'sk-current'
    s.write(settings)
    // simulate an older build rewriting the plaintext field
    const raw = JSON.parse(readFileSync(settingsPath, 'utf-8'))
    raw.providers.openai.apiKey = 'sk-stale'
    writeFileSync(settingsPath, JSON.stringify(raw))
    expect(s.read().providers.openai.apiKey).toBe('sk-current')
  })

  it('treats a blank key on write as "leave the stored key alone"', () => {
    const s = store()
    const settings = s.read()
    settings.providers.openai.apiKey = 'sk-live-secret'
    s.write(settings)

    // what the renderer round-trips: no key, changed model
    const fromRenderer = s.readForRenderer()
    fromRenderer.providers.openai.model = 'gpt-4.1'
    s.write(fromRenderer)

    expect(s.apiKeyFor('openai')).toBe('sk-live-secret')
    expect(s.read().providers.openai.model).toBe('gpt-4.1')
  })

  it('clears a key only when asked explicitly', () => {
    const s = store()
    const settings = s.read()
    settings.providers.openai.apiKey = 'sk-live-secret'
    settings.providers.openrouter.apiKey = 'sk-or-other'
    s.write(settings)
    s.clearApiKey('openai')
    expect(s.apiKeyFor('openai')).toBe('')
    expect(s.apiKeyFor('openrouter')).toBe('sk-or-other')
  })

  it('removes the secrets file once the last key is cleared', () => {
    const s = store()
    const settings = s.read()
    settings.providers.openai.apiKey = 'sk-live-secret'
    s.write(settings)
    s.clearApiKey('openai')
    expect(existsSync(secretsPath)).toBe(false)
  })

  it('hands the renderer presence flags instead of keys', () => {
    const s = store()
    const settings = s.read()
    settings.providers.openai.apiKey = 'sk-live-secret'
    s.write(settings)
    const forRenderer = s.readForRenderer()
    expect(forRenderer.providers.openai.apiKey).toBe('')
    expect(forRenderer.apiKeyPresent?.openai).toBe(true)
    expect(forRenderer.apiKeyPresent?.ollama).toBe(false)
    expect(JSON.stringify(forRenderer)).not.toContain('sk-live-secret')
  })

  it('persists custom instructions', () => {
    const s = store()
    const settings = s.read()
    settings.globalInstructions = 'Always use British spelling.'
    settings.perAppInstructions = { slides: 'Six words per line.' }
    s.write(settings)
    const reread = s.read()
    expect(reread.globalInstructions).toBe('Always use British spelling.')
    expect(reread.perAppInstructions).toEqual({ slides: 'Six words per line.' })
  })

  it('falls back to an unencrypted 0600 secrets file when the OS keychain is unavailable', () => {
    const onWarn = vi.fn()
    const s = store(fakeCipher(false), onWarn)
    const settings = s.read()
    settings.providers.openai.apiKey = 'sk-live-secret'
    s.write(settings)

    expect(readFileSync(settingsPath, 'utf-8')).not.toContain('sk-live-secret')
    expect(JSON.parse(readFileSync(secretsPath, 'utf-8')).encrypted).toBe(false)
    expect(s.apiKeyFor('openai')).toBe('sk-live-secret')
    expect(statSync(secretsPath).mode & 0o777).toBe(0o600)
    expect(onWarn).toHaveBeenCalledWith(expect.stringContaining('OS encryption is unavailable'))
    expect(s.isEncryptionAvailable()).toBe(false)
  })

  it('drops a key it cannot decrypt instead of sending ciphertext upstream', () => {
    writeFileSync(
      secretsPath,
      JSON.stringify({ version: 1, encrypted: true, keys: { openai: Buffer.from('garbage').toString('base64') } }),
    )
    const onWarn = vi.fn()
    const s = store(fakeCipher(), onWarn)
    expect(s.apiKeyFor('openai')).toBe('')
    expect(s.read().providers.openai.apiKey).toBe('')
    expect(onWarn).toHaveBeenCalledWith(expect.stringContaining('could not decrypt'))
  })

  it('falls back to defaults on a corrupted settings file', () => {
    writeFileSync(settingsPath, '{ not json')
    expect(store().read().provider).toBe('openai')
  })
})
