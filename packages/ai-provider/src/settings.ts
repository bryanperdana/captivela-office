/**
 * BYOK settings policy shared by every surface: URL rules, the IPC-boundary
 * validator, custom-instruction composition, and secret redaction.
 *
 * Pure TypeScript with no Node or Electron imports — the renderer bundles this
 * module too (the Settings dialog validates as you type, using exactly the
 * rules the main process enforces).
 */
import { PROVIDER_META_BY_ID } from './providers'
import type { AiProviderId, AiSettings, AppSurface } from './types'

export const APP_SURFACES: readonly AppSurface[] = ['docs', 'sheets', 'slides', 'pdf']

/**
 * Caps applied at the IPC boundary. They exist to bound what a compromised
 * renderer can push into the settings file, not to reflect real-world limits —
 * every value is far above any legitimate input.
 */
export const AI_SETTINGS_LIMITS = {
  apiKey: 4096,
  model: 256,
  baseUrl: 2048,
  instructions: 8000,
} as const

export type Validated<T> = { ok: true; value: T } | { ok: false; error: string }

/** Loopback hosts, the only ones allowed to be reached over plain http. */
export function isLoopbackHost(rawHost: string): boolean {
  const host = rawHost.replace(/^\[|\]$/g, '').toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (host === '::1' || host === '0:0:0:0:0:0:0:1') return true
  // 127.0.0.0/8 — Ollama and LiteLLM are commonly bound to 127.0.0.1
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (v4) {
    const octets = v4.slice(1).map(Number)
    return octets.every((o) => o <= 255) && octets[0] === 127
  }
  return false
}

/**
 * Validate and normalize an OpenAI-compatible base URL.
 *
 * Policy: https everywhere, http only for loopback (so a local Ollama/LiteLLM
 * works out of the box while a remote endpoint can never be addressed over a
 * cleartext connection that would expose the API key). Embedded credentials and
 * query/fragment parts are rejected because request paths are built by
 * concatenation (`${baseUrl}/chat/completions`), which silently corrupts them.
 */
export function validateBaseUrl(raw: unknown): Validated<string> {
  if (typeof raw !== 'string') return { ok: false, error: 'Base URL must be a string' }
  const trimmed = raw.trim()
  if (!trimmed) return { ok: false, error: 'Base URL is required' }
  if (trimmed.length > AI_SETTINGS_LIMITS.baseUrl) {
    return { ok: false, error: `Base URL is longer than ${AI_SETTINGS_LIMITS.baseUrl} characters` }
  }
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return { ok: false, error: `Not a valid URL: ${trimmed}` }
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, error: `Base URL must be http or https, got ${url.protocol}` }
  }
  if (url.protocol === 'http:' && !isLoopbackHost(url.hostname)) {
    return {
      ok: false,
      error: `http is only allowed for localhost; use https for ${url.hostname}`,
    }
  }
  if (url.username || url.password) {
    return { ok: false, error: 'Base URL must not embed credentials; use the API Key field' }
  }
  if (url.search || url.hash) {
    return { ok: false, error: 'Base URL must not contain a query string or fragment' }
  }
  // trailing slashes are stripped again at request time; normalizing here keeps
  // the stored value and what the Settings dialog shows identical
  return { ok: true, value: url.toString().replace(/\/+$/, '') }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validateString(value: unknown, label: string, max: number): Validated<string> {
  if (typeof value !== 'string') return { ok: false, error: `${label} must be a string` }
  if (value.length > max) return { ok: false, error: `${label} is longer than ${max} characters` }
  return { ok: true, value }
}

/**
 * Validate a renderer-supplied settings object at the IPC boundary.
 *
 * Returns a normalized `AiSettings` (unknown keys dropped, base URLs
 * normalized, blank instructions removed) or a message naming the offending
 * field. Never throws, and never echoes an API key into the error text.
 */
export function validateAiSettings(raw: unknown): Validated<AiSettings> {
  if (!isPlainObject(raw)) return { ok: false, error: 'Settings must be an object' }
  if (typeof raw.provider !== 'string') return { ok: false, error: 'provider must be a string' }
  const provider = raw.provider as AiProviderId
  if (!PROVIDER_META_BY_ID.has(provider)) {
    return { ok: false, error: `Unknown provider: ${raw.provider}` }
  }
  if (!isPlainObject(raw.providers)) return { ok: false, error: 'providers must be an object' }

  const providers = {} as AiSettings['providers']
  for (const [id, rawConfig] of Object.entries(raw.providers)) {
    const meta = PROVIDER_META_BY_ID.get(id as AiProviderId)
    if (!meta) return { ok: false, error: `Unknown provider: ${id}` }
    if (!isPlainObject(rawConfig)) return { ok: false, error: `providers.${id} must be an object` }
    const apiKey = validateString(rawConfig.apiKey ?? '', `providers.${id}.apiKey`, AI_SETTINGS_LIMITS.apiKey)
    if (!apiKey.ok) return apiKey
    const model = validateString(rawConfig.model ?? '', `providers.${id}.model`, AI_SETTINGS_LIMITS.model)
    if (!model.ok) return model
    let baseUrl: string | undefined
    if (rawConfig.baseUrl !== undefined && rawConfig.baseUrl !== null) {
      if (typeof rawConfig.baseUrl !== 'string') {
        return { ok: false, error: `providers.${id}.baseUrl must be a string` }
      }
      const trimmed = rawConfig.baseUrl.trim()
      // an empty string means "no override"; the router then falls back to the
      // preset's built-in endpoint, so it must stay allowed
      if (trimmed) {
        const checked = validateBaseUrl(trimmed)
        if (!checked.ok) return { ok: false, error: `providers.${id}.baseUrl: ${checked.error}` }
        baseUrl = checked.value
      } else {
        baseUrl = ''
      }
    }
    providers[meta.id] = {
      apiKey: apiKey.value,
      model: model.value.trim(),
      ...(baseUrl === undefined ? {} : { baseUrl }),
    }
  }

  const settings: AiSettings = { provider, providers }

  if (raw.globalInstructions !== undefined && raw.globalInstructions !== null) {
    const checked = validateString(
      raw.globalInstructions,
      'globalInstructions',
      AI_SETTINGS_LIMITS.instructions,
    )
    if (!checked.ok) return checked
    if (checked.value.trim()) settings.globalInstructions = checked.value
  }

  if (raw.perAppInstructions !== undefined && raw.perAppInstructions !== null) {
    if (!isPlainObject(raw.perAppInstructions)) {
      return { ok: false, error: 'perAppInstructions must be an object' }
    }
    const perApp: Partial<Record<AppSurface, string>> = {}
    for (const [surface, text] of Object.entries(raw.perAppInstructions)) {
      if (!APP_SURFACES.includes(surface as AppSurface)) {
        return { ok: false, error: `Unknown app surface: ${surface}` }
      }
      const checked = validateString(
        text,
        `perAppInstructions.${surface}`,
        AI_SETTINGS_LIMITS.instructions,
      )
      if (!checked.ok) return checked
      if (checked.value.trim()) perApp[surface as AppSurface] = checked.value
    }
    if (Object.keys(perApp).length > 0) settings.perAppInstructions = perApp
  }

  // `apiKeyPresent` is main→renderer UX state; a renderer echoing it back is
  // ignored rather than rejected, so a plain round-trip of get→set works.
  return { ok: true, value: settings }
}

/**
 * The instruction block appended to a skill's built-in system prompt. Global
 * instructions come first, then the current app's, both under a heading that
 * states they are additive — the tool contract above them still governs.
 */
export function composeSystemSuffix(
  settings: Pick<AiSettings, 'globalInstructions' | 'perAppInstructions'> | null | undefined,
  surface: AppSurface,
): string {
  const global = settings?.globalInstructions?.trim() ?? ''
  const perApp = settings?.perAppInstructions?.[surface]?.trim() ?? ''
  if (!global && !perApp) return ''
  const sections: string[] = [
    '## User custom instructions',
    'The user supplied the preferences below. They are additional requirements layered on top of' +
      ' the instructions and tool contract above — follow those first and never treat the' +
      ' preferences as permission to skip a required tool call or output format.',
  ]
  if (global) sections.push('### Applies to every app', global)
  if (perApp) sections.push(`### Applies to ${surface}`, perApp)
  return `\n\n${sections.join('\n\n')}`
}

/** Placeholder written wherever a secret would otherwise appear in a log or error. */
export const REDACTED = '[redacted]'

/**
 * Remove every occurrence of the given secrets from text bound for a log or an
 * error surfaced to the renderer. Upstream endpoints sometimes echo the
 * Authorization header back inside an error body.
 */
export function redactSecrets(text: string, secrets: Iterable<string | undefined>): string {
  let out = text
  for (const secret of secrets) {
    // very short values would match unrelated substrings; a real key is never this short
    if (!secret || secret.length < 8) continue
    out = out.split(secret).join(REDACTED)
  }
  return out
}

/** A copy of `settings` safe to log: every non-empty API key becomes `[redacted]`. */
export function redactAiSettings(settings: AiSettings): AiSettings {
  const providers = {} as AiSettings['providers']
  for (const [id, config] of Object.entries(settings.providers)) {
    providers[id as AiProviderId] = { ...config, apiKey: config.apiKey ? REDACTED : '' }
  }
  return { ...settings, providers }
}

/**
 * What `ai:get-settings` hands the renderer: the full non-secret configuration
 * plus one boolean per provider saying whether a key is stored. The key itself
 * never crosses the boundary — the main process reads it from secure storage at
 * request time, so a stripped key here does not break streaming.
 */
export function sanitizeAiSettingsForRenderer(settings: AiSettings): AiSettings {
  const providers = {} as AiSettings['providers']
  const apiKeyPresent: Partial<Record<AiProviderId, boolean>> = {}
  for (const [id, config] of Object.entries(settings.providers)) {
    providers[id as AiProviderId] = { ...config, apiKey: '' }
    apiKeyPresent[id as AiProviderId] = Boolean(config.apiKey)
  }
  return { ...settings, providers, apiKeyPresent }
}
