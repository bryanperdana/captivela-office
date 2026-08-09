import { describe, expect, it } from 'vitest'
import { AI_PROVIDERS, BYOK_PRESET_IDS, defaultAiSettings, resolveAiSettings } from '../src/providers'

describe('defaultAiSettings', () => {
  it('defaults to the openai BYOK preset, never genspark', () => {
    const settings = defaultAiSettings()
    expect(settings.provider).toBe('openai')
  })

  it('gives every provider its default model and an empty key by default', () => {
    const settings = defaultAiSettings()
    for (const meta of AI_PROVIDERS) {
      expect(settings.providers[meta.id].apiKey).toBe('')
      expect(settings.providers[meta.id].model).toBe(meta.defaultModel)
    }
    expect(settings.providers.custom.baseUrl).toBe('')
    expect(settings.providers.openai.baseUrl).toBe('https://api.openai.com/v1')
    expect(settings.providers.openrouter.baseUrl).toBe('https://openrouter.ai/api/v1')
    expect(settings.providers.ollama.baseUrl).toBe('http://localhost:11434/v1')
    expect(settings.providers.litellm.baseUrl).toBe('http://localhost:4000/v1')
    expect(settings.providers.anthropic.baseUrl).toBeUndefined()
  })

  it('exposes exactly the BYOK presets required by Phase 1, in order', () => {
    expect(BYOK_PRESET_IDS).toEqual(['openai', 'openrouter', 'ollama', 'litellm', 'custom'])
    for (const id of BYOK_PRESET_IDS) {
      expect(AI_PROVIDERS.some((m) => m.id === id)).toBe(true)
    }
  })

  it('applies caller-supplied default keys only to the listed providers', () => {
    const settings = defaultAiSettings({ anthropic: 'sk-ant-preset' })
    expect(settings.providers.anthropic.apiKey).toBe('sk-ant-preset')
    expect(settings.providers.gemini.apiKey).toBe('')
  })
})

describe('resolveAiSettings', () => {
  it('returns fresh defaults when nothing is stored', () => {
    const defaults = defaultAiSettings({ anthropic: 'sk-ant-preset' })
    expect(resolveAiSettings({}, defaults)).toEqual(defaults)
  })

  it('migrates the pre-provider single-endpoint shape into the custom provider', () => {
    const defaults = defaultAiSettings()
    const resolved = resolveAiSettings(
      { apiKey: 'legacy-key', model: 'legacy-model', baseUrl: 'https://legacy.example.com/v1' },
      defaults,
    )
    expect(resolved.providers.custom).toEqual({
      apiKey: 'legacy-key',
      model: 'legacy-model',
      baseUrl: 'https://legacy.example.com/v1',
    })
    // untouched providers keep their defaults
    expect(resolved.providers.anthropic).toEqual(defaults.providers.anthropic)
  })

  it('defaults the legacy base URL to the OpenAI endpoint when omitted', () => {
    const resolved = resolveAiSettings({ apiKey: 'legacy-key' }, defaultAiSettings())
    expect(resolved.providers.custom.baseUrl).toBe('https://api.openai.com/v1')
  })

  it('merges stored multi-provider settings over the defaults, provider by provider', () => {
    const defaults = defaultAiSettings({ anthropic: 'preset-key' })
    const resolved = resolveAiSettings(
      {
        provider: 'gemini',
        providers: {
          gemini: { apiKey: 'stored-gemini-key', model: 'gemini-2.5-pro' },
        } as never,
      },
      defaults,
    )
    expect(resolved.provider).toBe('gemini')
    expect(resolved.providers.gemini).toEqual({ apiKey: 'stored-gemini-key', model: 'gemini-2.5-pro' })
    // provider not mentioned in stored.providers keeps the computed default
    expect(resolved.providers.anthropic.apiKey).toBe('preset-key')
  })
})
