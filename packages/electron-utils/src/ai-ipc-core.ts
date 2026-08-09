/**
 * The body of the shared `ai:*` settings handlers, minus Electron.
 *
 * Every app registers the same channel names (the shell registers one set for
 * all four editors, and each app registers its own when run standalone), so the
 * validation, secret resolution and error redaction live here once and each
 * `ipcMain.handle` call is a one-liner over these functions.
 */
import {
  AI_SETTINGS_LIMITS,
  PROVIDER_META_BY_ID,
  redactSecrets,
  testConnection,
  testToolCalling,
  validateAiSettings,
  validateBaseUrl,
  type AiCheckRequest,
  type AiCheckResult,
  type AiProviderConfig,
  type AiProviderId,
  type AiSettings,
  type AiSettingsSaveResult,
} from '@genoffice/ai-provider'
import type { AiSettingsStore } from './ai-settings-store'

export type IpcResult = AiSettingsSaveResult

/** Every field arrives from a renderer, so nothing is trusted until narrowed. */
type RawCheckRequest = { [K in keyof AiCheckRequest]?: unknown }

function asCheckRequest(raw: unknown): RawCheckRequest {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? (raw as RawCheckRequest)
    : {}
}

/** `ai:get-settings` — non-secret configuration plus per-provider key presence. */
export function getSettingsForRenderer(store: AiSettingsStore): AiSettings {
  return store.readForRenderer()
}

/**
 * `ai:set-settings` — validates at the boundary and persists. Returns a result
 * object rather than throwing so the Settings dialog can show the field-level
 * message instead of an "Error invoking remote method" string.
 */
export function setSettingsFromRenderer(store: AiSettingsStore, raw: unknown): IpcResult {
  const validated = validateAiSettings(raw)
  if (!validated.ok) return { ok: false, error: validated.error }
  store.write(validated.value)
  return { ok: true }
}

/** `ai:clear-api-key` — the only way a stored key is removed. */
export function clearApiKeyFromRenderer(store: AiSettingsStore, raw: unknown): IpcResult {
  if (typeof raw !== 'string' || !PROVIDER_META_BY_ID.has(raw as AiProviderId)) {
    return { ok: false, error: `Unknown provider: ${String(raw)}` }
  }
  store.clearApiKey(raw as AiProviderId)
  return { ok: true }
}

/**
 * Build the config a check should run against: the renderer supplies the
 * provider/model/base URL being edited, anything it omits falls back to what is
 * stored, and the API key comes from secure storage unless the dialog passed a
 * freshly typed one.
 */
function resolveCheckRequest(
  store: AiSettingsStore,
  raw: RawCheckRequest,
): { ok: true; provider: AiProviderId; config: AiProviderConfig } | { ok: false; error: string } {
  const stored = store.read()
  const provider = (raw.provider ?? stored.provider) as AiProviderId
  if (typeof provider !== 'string' || !PROVIDER_META_BY_ID.has(provider)) {
    return { ok: false, error: `Unknown provider: ${String(raw.provider)}` }
  }
  const storedConfig = stored.providers[provider]
  let model = storedConfig?.model ?? ''
  if (raw.model !== undefined) {
    if (typeof raw.model !== 'string' || raw.model.length > AI_SETTINGS_LIMITS.model) {
      return { ok: false, error: 'Invalid model' }
    }
    model = raw.model.trim()
  }
  let baseUrl = storedConfig?.baseUrl
  if (raw.baseUrl !== undefined) {
    if (typeof raw.baseUrl !== 'string') return { ok: false, error: 'Invalid Base URL' }
    const trimmed = raw.baseUrl.trim()
    if (!trimmed) {
      baseUrl = ''
    } else {
      const checked = validateBaseUrl(trimmed)
      if (!checked.ok) return { ok: false, error: checked.error }
      baseUrl = checked.value
    }
  }
  let apiKey = storedConfig?.apiKey ?? ''
  if (typeof raw.apiKey === 'string' && raw.apiKey) {
    if (raw.apiKey.length > AI_SETTINGS_LIMITS.apiKey) {
      return { ok: false, error: 'Invalid API key' }
    }
    apiKey = raw.apiKey
  }
  return {
    ok: true,
    provider,
    config: { apiKey, model, ...(baseUrl === undefined ? {} : { baseUrl }) },
  }
}

/** `ai:test-connection` */
export async function runConnectionCheck(
  store: AiSettingsStore,
  raw: unknown = {},
): Promise<AiCheckResult> {
  const resolved = resolveCheckRequest(store, asCheckRequest(raw))
  if (!resolved.ok) return { ok: false, kind: 'config', error: resolved.error }
  return testConnection(resolved.provider, resolved.config)
}

/** `ai:test-tool-calling` */
export async function runToolCallingCheck(
  store: AiSettingsStore,
  raw: unknown = {},
): Promise<AiCheckResult> {
  const resolved = resolveCheckRequest(store, asCheckRequest(raw))
  if (!resolved.ok) return { ok: false, kind: 'config', error: resolved.error }
  return testToolCalling(resolved.provider, resolved.config)
}

/**
 * Config for an outbound chat/stream request.
 *
 * The renderer picks the provider and may carry an edited model/base URL, but
 * the API key is always read from secure storage here — the renderer has never
 * been given one to send back. `fallbackApiKey` covers providers whose
 * credential lives elsewhere (Genspark takes it from the gsk login state).
 */
export function resolveRequestConfig(
  store: AiSettingsStore,
  requestSettings: Partial<AiSettings> | undefined,
  fallbackApiKey?: (provider: AiProviderId) => string,
):
  | { ok: true; provider: AiProviderId; config: AiProviderConfig }
  | { ok: false; error: string; kind: 'provider' | 'apiKey' | 'model' } {
  const stored = store.read()
  const requested = requestSettings?.provider
  const provider =
    typeof requested === 'string' && PROVIDER_META_BY_ID.has(requested as AiProviderId)
      ? (requested as AiProviderId)
      : stored.provider
  const meta = PROVIDER_META_BY_ID.get(provider)!
  const storedConfig = stored.providers[provider]
  const fromRenderer = requestSettings?.providers?.[provider]

  let baseUrl = storedConfig?.baseUrl
  const rendererBaseUrl = fromRenderer?.baseUrl?.trim()
  if (rendererBaseUrl) {
    const checked = validateBaseUrl(rendererBaseUrl)
    if (!checked.ok) return { ok: false, error: checked.error, kind: 'provider' }
    baseUrl = checked.value
  }
  const model = (fromRenderer?.model ?? storedConfig?.model ?? '').trim().slice(0, AI_SETTINGS_LIMITS.model)
  const apiKey = storedConfig?.apiKey || (fallbackApiKey?.(provider) ?? '')

  if (!apiKey && !meta.apiKeyOptional) {
    return { ok: false, error: `No API key set for ${meta.label}`, kind: 'apiKey' }
  }
  if (!model) return { ok: false, error: `No model selected for ${meta.label}`, kind: 'model' }
  return {
    ok: true,
    provider,
    config: { apiKey, model, ...(baseUrl === undefined ? {} : { baseUrl }) },
  }
}

/** Strip the resolved key out of anything about to be logged or sent to a renderer. */
export function redactRequestError(message: string, config: AiProviderConfig | undefined): string {
  return redactSecrets(message, [config?.apiKey])
}
