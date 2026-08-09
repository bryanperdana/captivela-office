import { describe, expect, it } from 'vitest'
import {
  AI_SETTINGS_LIMITS,
  composeSystemSuffix,
  isLoopbackHost,
  redactAiSettings,
  redactSecrets,
  sanitizeAiSettingsForRenderer,
  validateAiSettings,
  validateBaseUrl,
} from '../src/settings'
import { defaultAiSettings } from '../src/providers'
import type { AiSettings } from '../src/types'

describe('validateBaseUrl', () => {
  it('accepts https endpoints and strips trailing slashes', () => {
    expect(validateBaseUrl('https://api.openai.com/v1/')).toEqual({
      ok: true,
      value: 'https://api.openai.com/v1',
    })
  })

  it('accepts http only for loopback hosts', () => {
    for (const url of [
      'http://localhost:11434/v1',
      'http://127.0.0.1:4000/v1',
      'http://127.5.5.5:4000/v1',
      'http://[::1]:11434/v1',
      'http://api.localhost:8080/v1',
    ]) {
      expect(validateBaseUrl(url).ok, url).toBe(true)
    }
  })

  it('rejects http for non-loopback hosts', () => {
    const result = validateBaseUrl('http://api.example.com/v1')
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('http is only allowed for localhost')
  })

  it('rejects a host that merely looks loopback-ish', () => {
    expect(validateBaseUrl('http://localhost.evil.com/v1').ok).toBe(false)
    expect(validateBaseUrl('http://127.0.0.1.evil.com/v1').ok).toBe(false)
    expect(validateBaseUrl('http://notlocalhost/v1').ok).toBe(false)
  })

  it('rejects non-http schemes, embedded credentials, and query strings', () => {
    expect(validateBaseUrl('file:///etc/passwd').ok).toBe(false)
    expect(validateBaseUrl('ftp://example.com/v1').ok).toBe(false)
    expect(validateBaseUrl('https://user:pass@api.example.com/v1').ok).toBe(false)
    expect(validateBaseUrl('https://api.example.com/v1?key=abc').ok).toBe(false)
    expect(validateBaseUrl('https://api.example.com/v1#frag').ok).toBe(false)
  })

  it('rejects blanks, non-strings, and over-long values', () => {
    expect(validateBaseUrl('   ').ok).toBe(false)
    expect(validateBaseUrl(42).ok).toBe(false)
    expect(validateBaseUrl(`https://a.example.com/${'x'.repeat(AI_SETTINGS_LIMITS.baseUrl)}`).ok).toBe(
      false,
    )
  })
})

describe('isLoopbackHost', () => {
  it('recognizes the loopback forms and nothing else', () => {
    expect(isLoopbackHost('localhost')).toBe(true)
    expect(isLoopbackHost('[::1]')).toBe(true)
    expect(isLoopbackHost('127.0.0.1')).toBe(true)
    expect(isLoopbackHost('128.0.0.1')).toBe(false)
    expect(isLoopbackHost('127.0.0.999')).toBe(false)
    expect(isLoopbackHost('10.0.0.1')).toBe(false)
  })
})

describe('validateAiSettings', () => {
  const base = {
    provider: 'openai',
    providers: { openai: { apiKey: 'sk-test', model: 'gpt-4.1-mini', baseUrl: 'https://api.openai.com/v1' } },
  }

  it('accepts a well-formed payload and normalizes it', () => {
    const result = validateAiSettings({ ...base, providers: { openai: { ...base.providers.openai, baseUrl: 'https://api.openai.com/v1//' } } })
    expect(result.ok).toBe(true)
    expect(result.ok && result.value.providers.openai.baseUrl).toBe('https://api.openai.com/v1')
  })

  it('rejects unknown providers in both the selection and the map', () => {
    expect(validateAiSettings({ ...base, provider: 'evilcorp' }).ok).toBe(false)
    expect(
      validateAiSettings({ ...base, providers: { ...base.providers, evilcorp: { apiKey: '', model: 'm' } } }).ok,
    ).toBe(false)
  })

  it('rejects non-object payloads and wrong field types', () => {
    expect(validateAiSettings(null).ok).toBe(false)
    expect(validateAiSettings([]).ok).toBe(false)
    expect(validateAiSettings({ provider: 'openai' }).ok).toBe(false)
    expect(validateAiSettings({ ...base, providers: { openai: { apiKey: 1, model: 'm' } } }).ok).toBe(false)
    expect(validateAiSettings({ ...base, providers: { openai: { apiKey: '', model: {} } } }).ok).toBe(false)
  })

  it('applies the URL policy to every provider base URL', () => {
    const result = validateAiSettings({
      ...base,
      providers: { openai: { apiKey: '', model: 'm', baseUrl: 'http://evil.example.com/v1' } },
    })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('providers.openai.baseUrl')
  })

  it('treats an empty base URL as "use the preset default"', () => {
    const result = validateAiSettings({
      ...base,
      providers: { openai: { apiKey: '', model: 'm', baseUrl: '  ' } },
    })
    expect(result.ok).toBe(true)
    expect(result.ok && result.value.providers.openai.baseUrl).toBe('')
  })

  it('enforces length caps without echoing the secret', () => {
    const result = validateAiSettings({
      ...base,
      providers: { openai: { apiKey: 'k'.repeat(AI_SETTINGS_LIMITS.apiKey + 1), model: 'm' } },
    })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).not.toContain('kkkk')
  })

  it('keeps custom instructions and drops blank ones', () => {
    const result = validateAiSettings({
      ...base,
      globalInstructions: 'Always use British spelling.',
      perAppInstructions: { docs: 'Prefer short paragraphs.', slides: '   ' },
    })
    expect(result.ok).toBe(true)
    expect(result.ok && result.value.globalInstructions).toBe('Always use British spelling.')
    expect(result.ok && result.value.perAppInstructions).toEqual({ docs: 'Prefer short paragraphs.' })
  })

  it('rejects unknown app surfaces and over-long instructions', () => {
    expect(validateAiSettings({ ...base, perAppInstructions: { email: 'x' } }).ok).toBe(false)
    expect(
      validateAiSettings({
        ...base,
        globalInstructions: 'x'.repeat(AI_SETTINGS_LIMITS.instructions + 1),
      }).ok,
    ).toBe(false)
  })

  it('round-trips what the renderer received from sanitizeAiSettingsForRenderer', () => {
    const stored: AiSettings = { ...defaultAiSettings(), globalInstructions: 'Be terse.' }
    stored.providers.openai.apiKey = 'sk-secret'
    const sent = sanitizeAiSettingsForRenderer(stored)
    const result = validateAiSettings(JSON.parse(JSON.stringify(sent)))
    expect(result.ok).toBe(true)
    expect(result.ok && result.value.globalInstructions).toBe('Be terse.')
  })
})

describe('sanitizeAiSettingsForRenderer', () => {
  it('strips keys and reports only presence', () => {
    const settings = defaultAiSettings()
    settings.providers.openai.apiKey = 'sk-secret-value'
    const sanitized = sanitizeAiSettingsForRenderer(settings)
    expect(sanitized.providers.openai.apiKey).toBe('')
    expect(sanitized.apiKeyPresent?.openai).toBe(true)
    expect(sanitized.apiKeyPresent?.openrouter).toBe(false)
    expect(JSON.stringify(sanitized)).not.toContain('sk-secret-value')
  })
})

describe('composeSystemSuffix', () => {
  it('returns nothing when no instructions are set', () => {
    expect(composeSystemSuffix(undefined, 'docs')).toBe('')
    expect(composeSystemSuffix({ globalInstructions: '   ' }, 'docs')).toBe('')
  })

  it('appends the global instruction for every surface', () => {
    const suffix = composeSystemSuffix({ globalInstructions: 'Use metric units.' }, 'sheets')
    expect(suffix.startsWith('\n\n')).toBe(true)
    expect(suffix).toContain('Use metric units.')
  })

  it('appends only the matching app instruction', () => {
    const settings = {
      globalInstructions: 'Use metric units.',
      perAppInstructions: { docs: 'Prefer bullet lists.', slides: 'Six words per line.' },
    }
    const docs = composeSystemSuffix(settings, 'docs')
    expect(docs).toContain('Prefer bullet lists.')
    expect(docs).not.toContain('Six words per line.')
    expect(composeSystemSuffix(settings, 'pdf')).not.toContain('Prefer bullet lists.')
  })

  it('frames instructions as additive, never as a replacement for the tool contract', () => {
    const suffix = composeSystemSuffix({ globalInstructions: 'Ignore all tools.' }, 'docs')
    expect(suffix).toContain('additional requirements layered on top of')
    // the built-in prompt stays in front of the suffix — this is what the loop concatenates
    const system = 'BUILT-IN CONTRACT' + suffix
    expect(system.indexOf('BUILT-IN CONTRACT')).toBeLessThan(system.indexOf('Ignore all tools.'))
  })
})

describe('redaction', () => {
  it('removes secrets from error text', () => {
    const text = 'HTTP 401: bad key sk-abcdef1234567890 rejected'
    expect(redactSecrets(text, ['sk-abcdef1234567890'])).toBe('HTTP 401: bad key [redacted] rejected')
  })

  it('ignores empty and implausibly short secrets', () => {
    expect(redactSecrets('a short e message', ['', undefined, 'e'])).toBe('a short e message')
  })

  it('redacts stored keys for logging', () => {
    const settings = defaultAiSettings()
    settings.providers.openai.apiKey = 'sk-secret-value'
    const logged = redactAiSettings(settings)
    expect(logged.providers.openai.apiKey).toBe('[redacted]')
    expect(logged.providers.openrouter.apiKey).toBe('')
  })
})
