import type { AiProviderId, AiProviderMeta, AiSettings, LegacyAiSettings } from './types'

/**
 * Genspark server-side LLM proxy endpoints. All three protocols share the
 * api_key from the gsk login; model ids follow the proxy's own naming scheme,
 * which differs from the official vendor ids.
 */
export const GENSPARK_LLM_BASE_URLS = {
  anthropic: 'https://www.genspark.ai/api/anthropic',
  gemini: 'https://www.genspark.ai/api/llm_proxy/gemini/v1beta',
  openai: 'https://www.genspark.ai/api/llm_proxy/v1',
} as const

/**
 * Splits GenOffice usage out of the proxy's default "Claw" billing bucket
 * (the backend attributes gsk-key traffic by X-Agent-Type). Only sent to the
 * Genspark proxy — never to direct vendor APIs.
 */
export const GENSPARK_AGENT_TYPE = 'genoffice'

export function gensparkAttributionHeaders(baseUrl?: string): Record<string, string> {
  return baseUrl?.startsWith('https://www.genspark.ai')
    ? { 'X-Agent-Type': GENSPARK_AGENT_TYPE }
    : {}
}

/**
 * Ordered, BYOK-only preset list surfaced in the Settings UI's provider picker.
 * 'genspark' | 'anthropic' | 'gemini' | 'deepseek' remain wired below (routing,
 * gsk login) as native/legacy providers but are intentionally excluded from
 * this list so the default BYOK experience never requires a Genspark account.
 */
export const BYOK_PRESET_IDS: AiProviderId[] = ['openai', 'openrouter', 'ollama', 'litellm', 'custom']

export const AI_PROVIDERS: AiProviderMeta[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    models: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini'],
    defaultModel: 'gpt-4.1-mini',
    keyPlaceholder: 'sk-...',
    needsBaseUrl: true,
    defaultBaseUrl: 'https://api.openai.com/v1',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    models: [
      'openai/gpt-4o',
      'anthropic/claude-sonnet-4.5',
      'meta-llama/llama-3.1-70b-instruct',
      'google/gemini-2.5-flash',
    ],
    defaultModel: 'openai/gpt-4o',
    keyPlaceholder: 'sk-or-...',
    needsBaseUrl: true,
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
  },
  {
    id: 'ollama',
    label: 'Ollama (local)',
    models: ['llama3.1', 'qwen2.5', 'mistral'],
    defaultModel: 'llama3.1',
    keyPlaceholder: 'Not required for local Ollama',
    needsBaseUrl: true,
    defaultBaseUrl: 'http://localhost:11434/v1',
    apiKeyOptional: true,
  },
  {
    id: 'litellm',
    label: 'LiteLLM',
    models: [],
    defaultModel: '',
    keyPlaceholder: 'API Key (if your LiteLLM proxy requires one)',
    needsBaseUrl: true,
    defaultBaseUrl: 'http://localhost:4000/v1',
    apiKeyOptional: true,
  },
  {
    id: 'custom',
    label: 'Custom',
    models: [],
    defaultModel: '',
    keyPlaceholder: 'API Key',
    needsBaseUrl: true,
  },
  {
    id: 'genspark',
    label: 'Genspark',
    models: [
      'claude-opus-4-7',
      'claude-opus-4-8',
      'claude-sonnet-4-6',
      'claude-haiku-4-5',
      'gpt-5.2',
      'gemini-3.1-pro-preview',
      'gemini-3-flash-preview',
    ],
    defaultModel: 'claude-opus-4-7',
    keyPlaceholder: 'Not required - sign in to Genspark',
  },
  {
    id: 'anthropic',
    label: 'Claude',
    models: [
      'claude-sonnet-5',
      'claude-opus-4-8',
      'claude-opus-4-7',
      'claude-sonnet-4-6',
      'claude-opus-4-6',
      'claude-opus-4-5-20251101',
      'claude-haiku-4-5-20251001',
      'claude-sonnet-4-5-20250929',
    ],
    defaultModel: 'claude-opus-4-7',
    keyPlaceholder: 'sk-ant-api03-...',
  },
  {
    id: 'gemini',
    label: 'Gemini',
    models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'],
    defaultModel: 'gemini-2.5-flash',
    keyPlaceholder: 'AIza...',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    defaultModel: 'deepseek-chat',
    keyPlaceholder: 'sk-...',
    needsBaseUrl: true,
    defaultBaseUrl: 'https://api.deepseek.com/v1',
  },
]

export const PROVIDER_META_BY_ID: ReadonlyMap<AiProviderId, AiProviderMeta> = new Map(
  AI_PROVIDERS.map((m) => [m.id, m]),
)

/**
 * Fresh settings with every provider's default model and an empty key,
 * except providers listed in `defaultApiKeys` (e.g. an app-specific
 * preconfigured Anthropic key). Callers own that policy; this package
 * has no hardcoded keys. Defaults to the 'openai' BYOK preset — no
 * provider requires a Genspark account to work.
 */
export function defaultAiSettings(
  defaultApiKeys?: Partial<Record<AiProviderId, string>>,
): AiSettings {
  const providers = {} as AiSettings['providers']
  for (const meta of AI_PROVIDERS) {
    providers[meta.id] = {
      apiKey: defaultApiKeys?.[meta.id] ?? '',
      model: meta.defaultModel,
      baseUrl: meta.needsBaseUrl ? (meta.defaultBaseUrl ?? '') : undefined,
    }
  }
  return { provider: 'openai', providers }
}

/**
 * Merge on-disk settings over freshly computed defaults, migrating the
 * pre-provider shape (a single OpenAI-compatible endpoint) into the
 * "custom" provider slot. `stored` is whatever the caller read from its
 * settings file (already JSON-parsed); this function does no file I/O.
 */
export function resolveAiSettings(
  stored: Partial<AiSettings> & LegacyAiSettings,
  defaults: AiSettings,
): AiSettings {
  // custom instructions are independent of the provider shape, so they survive
  // both the modern and the legacy-migration path
  const instructions: Pick<AiSettings, 'globalInstructions' | 'perAppInstructions'> = {
    ...(stored.globalInstructions ? { globalInstructions: stored.globalInstructions } : {}),
    ...(stored.perAppInstructions ? { perAppInstructions: stored.perAppInstructions } : {}),
  }
  if (!stored.providers) {
    if (stored.apiKey) {
      defaults.providers.custom = {
        apiKey: stored.apiKey,
        model: stored.model ?? '',
        baseUrl: stored.baseUrl ?? 'https://api.openai.com/v1',
      }
    }
    return { ...defaults, ...instructions }
  }
  return {
    provider: stored.provider ?? defaults.provider,
    providers: { ...defaults.providers, ...stored.providers },
    ...instructions,
  }
}
