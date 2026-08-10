/**
 * BYOK compatibility checks: "Test Connection" and "Test Tool Calling".
 *
 * OpenAI-compatible endpoints differ in which parts of the protocol they
 * actually implement, so the two checks answer separate questions and report
 * *which layer* failed rather than a single opaque "request failed":
 *
 *   connectivity — the host could not be reached at all
 *   auth         — reached, credentials rejected
 *   model        — authenticated, but the selected model is not served
 *   protocol     — responded, but not in the OpenAI-compatible shape
 *   streaming    — non-streaming works, the SSE turn does not
 *   tool-calling — streams fine, but never produces a valid tool call
 *   config       — the settings themselves are incomplete (nothing was sent)
 */
import { chatForProvider } from './chat'
import { PROVIDER_META_BY_ID } from './providers'
import { redactSecrets } from './settings'
import { streamForProvider } from './stream'
import type { AiProviderConfig, AiProviderId } from './types'
import { AiTimeoutError } from './watchdog'

export type AiCheckFailureKind =
  | 'connectivity'
  | 'auth'
  | 'model'
  | 'protocol'
  | 'streaming'
  | 'tool-calling'
  | 'policy'
  | 'config'

export interface AiCheckResult {
  ok: boolean
  /** present only on failure */
  kind?: AiCheckFailureKind
  /** human-readable, already stripped of the API key */
  error?: string
  /** short success note (model list source, echoed tool arguments) */
  detail?: string
}

export interface AiCheckOptions {
  fetchImpl?: typeof fetch
  signal?: AbortSignal
}

/**
 * Renderer → main payload for either check. Every field is optional: anything
 * the Settings dialog omits falls back to the stored configuration, and
 * `apiKey` is sent only when the user wants to test a key before saving it.
 */
export interface AiCheckRequest {
  provider?: AiProviderId
  model?: string
  baseUrl?: string
  apiKey?: string
}

/** Result of `ai:set-settings` / `ai:clear-api-key`. */
export interface AiSettingsSaveResult {
  ok: boolean
  /** validation message naming the offending field; never contains a secret */
  error?: string
}

/** Endpoints reached through the OpenAI `/chat/completions` + `/models` shape. */
const OPENAI_COMPATIBLE: ReadonlySet<AiProviderId> = new Set<AiProviderId>([
  'openai',
  'openrouter',
  'ollama',
  'litellm',
  'custom',
  'deepseek',
])

/** Base URL actually used for a check, mirroring the router in ./stream. */
function resolveBaseUrl(provider: AiProviderId, config: AiProviderConfig): string | undefined {
  const explicit = config.baseUrl?.trim()
  if (explicit) return explicit.replace(/\/+$/, '')
  const fallback = PROVIDER_META_BY_ID.get(provider)?.defaultBaseUrl
  return fallback?.replace(/\/+$/, '')
}

/**
 * Map a thrown/returned provider error onto a failure layer. Works off the
 * message because every transport in this package surfaces upstream failures
 * as `HTTP <status>: <body>` (see ./http-error).
 */
export function classifyProviderError(raw: string): AiCheckFailureKind {
  const text = raw.toLowerCase()
  if (/\bhttp 401\b|\bhttp 403\b|unauthorized|invalid api key|invalid_api_key|authentication/.test(text)) {
    return 'auth'
  }
  if (/model .*(not found|does not exist|unavailable)|unknown model|model_not_found|invalid model/.test(text)) {
    return 'model'
  }
  if (/\bhttp 404\b/.test(text)) return 'model'
  if (/tool|function call/.test(text)) return 'tool-calling'
  if (
    /fetch failed|econnrefused|enotfound|etimedout|econnreset|network|timed out|timeout|dns/.test(
      text,
    )
  ) {
    return 'connectivity'
  }
  if (/unexpected token|not valid json|invalid json|empty stream|no content|sse/.test(text)) {
    return 'protocol'
  }
  return 'protocol'
}

function failure(kind: AiCheckFailureKind, error: string, apiKey?: string): AiCheckResult {
  return { ok: false, kind, error: redactSecrets(error, [apiKey]) }
}

/** Settings-level preconditions shared by both checks. */
function checkConfig(provider: AiProviderId, config: AiProviderConfig): AiCheckResult | null {
  const meta = PROVIDER_META_BY_ID.get(provider)
  if (!meta) return failure('config', `Unknown provider: ${provider}`)
  if (!config.model.trim()) return failure('config', 'No model selected')
  if (!resolveBaseUrl(provider, config) && OPENAI_COMPATIBLE.has(provider)) {
    return failure('config', `${meta.label} requires a Base URL`)
  }
  if (!config.apiKey && !meta.apiKeyOptional && provider !== 'genspark') {
    return failure('config', `No API key set for ${meta.label}`)
  }
  return null
}

async function readBody(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 600)
  } catch {
    return ''
  }
}

/** 401/403 → auth, 402 → auth (billing), 404/400-with-model-wording → model, else protocol. */
function classifyHttpStatus(status: number, body: string): AiCheckFailureKind {
  if (status === 401 || status === 403 || status === 402) return 'auth'
  if (status === 404) return 'model'
  if (status === 400 && /model/i.test(body)) return 'model'
  if (status === 429) return 'connectivity'
  return classifyProviderError(`HTTP ${status}: ${body}`)
}

/**
 * Test Connection: one minimal round trip that proves the endpoint is
 * reachable, the key is accepted, and the selected model is served.
 *
 * `GET /models` is tried first because it is cheap and answers all three at
 * once; endpoints that do not implement it (many self-hosted gateways) fall
 * back to a 1-token `/chat/completions` probe.
 */
export async function testConnection(
  provider: AiProviderId,
  config: AiProviderConfig,
  options: AiCheckOptions = {},
): Promise<AiCheckResult> {
  const configError = checkConfig(provider, config)
  if (configError) return configError
  if (!OPENAI_COMPATIBLE.has(provider)) return testConnectionViaChat(provider, config, options)

  const doFetch = options.fetchImpl ?? fetch
  const baseUrl = resolveBaseUrl(provider, config)!
  const headers: Record<string, string> = {
    ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
  }

  let listResponse: Response
  try {
    listResponse = await doFetch(`${baseUrl}/models`, {
      method: 'GET',
      headers,
      ...(options.signal ? { signal: options.signal } : {}),
    })
  } catch (err) {
    return failure(
      'connectivity',
      `Cannot reach ${baseUrl}: ${err instanceof Error ? err.message : String(err)}`,
      config.apiKey,
    )
  }

  if (listResponse.ok) {
    const body = await readBody(listResponse)
    let ids: string[] | null = null
    try {
      const json = JSON.parse(body) as { data?: Array<{ id?: unknown }> }
      if (Array.isArray(json.data)) {
        ids = json.data.map((m) => String(m?.id ?? '')).filter(Boolean)
      }
    } catch {
      // /models answered but not in the documented shape — the chat probe below
      // is the authoritative check, so fall through rather than fail here
    }
    if (ids && ids.includes(config.model)) {
      return { ok: true, detail: `${config.model} is served by ${baseUrl}` }
    }
    if (ids && ids.length > 0) {
      // The list can be truncated or scoped (proxies routinely expose only a
      // subset), so an absent model is not yet a failure — ask the model itself.
      const probe = await chatProbe(provider, config, options)
      if (probe.ok) return { ok: true, detail: `${config.model} answered a 1-token probe` }
      if (probe.kind === 'model') {
        return failure(
          'model',
          `${config.model} is not served by ${baseUrl}. Available: ${ids.slice(0, 8).join(', ')}${ids.length > 8 ? ', …' : ''}`,
          config.apiKey,
        )
      }
      return probe
    }
  } else if (listResponse.status === 401 || listResponse.status === 403) {
    return failure(
      'auth',
      `${baseUrl} rejected the API key (HTTP ${listResponse.status})`,
      config.apiKey,
    )
  }

  // /models missing, empty, or unparsable: the chat probe decides
  return chatProbe(provider, config, options)
}

/** Minimal non-streaming `/chat/completions` call: cheapest end-to-end proof. */
async function chatProbe(
  provider: AiProviderId,
  config: AiProviderConfig,
  options: AiCheckOptions,
): Promise<AiCheckResult> {
  const doFetch = options.fetchImpl ?? fetch
  const baseUrl = resolveBaseUrl(provider, config)!
  let response: Response
  try {
    response = await doFetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 16,
        stream: false,
      }),
      ...(options.signal ? { signal: options.signal } : {}),
    })
  } catch (err) {
    return failure(
      'connectivity',
      `Cannot reach ${baseUrl}: ${err instanceof Error ? err.message : String(err)}`,
      config.apiKey,
    )
  }
  const body = await readBody(response)
  if (!response.ok) {
    return failure(
      classifyHttpStatus(response.status, body),
      `HTTP ${response.status} from ${baseUrl}: ${body}`,
      config.apiKey,
    )
  }
  try {
    const json = JSON.parse(body) as { choices?: unknown[] }
    if (!Array.isArray(json.choices) || json.choices.length === 0) {
      return failure(
        'protocol',
        `${baseUrl} answered without an OpenAI-compatible "choices" array`,
        config.apiKey,
      )
    }
  } catch {
    return failure('protocol', `${baseUrl} returned a non-JSON response`, config.apiKey)
  }
  return { ok: true, detail: `${config.model} answered a 1-token probe` }
}

/** Native (non-OpenAI-shaped) providers reuse their own one-shot chat path. */
async function testConnectionViaChat(
  provider: AiProviderId,
  config: AiProviderConfig,
  options: AiCheckOptions,
): Promise<AiCheckResult> {
  try {
    const result = await chatForProvider(
      provider,
      config,
      'Reply with the single word: ok',
      'ping',
      options.signal,
    )
    if (result.ok) return { ok: true, detail: `${config.model} answered a probe` }
    const error = result.error ?? 'Unknown error'
    return failure(classifyProviderError(error), error, config.apiKey)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return failure(
      err instanceof AiTimeoutError ? 'connectivity' : classifyProviderError(message),
      message,
      config.apiKey,
    )
  }
}

/**
 * The deterministic probe schema. Every field is required, has one obviously
 * correct value given the prompt, and is typed — so a model that emits a
 * plausible-looking but malformed call still fails the check.
 */
export const TOOL_CALL_PROBE = {
  name: 'byok_selftest_echo',
  description:
    'Records a city and a number of days. Call this exactly once with the values the user gives you.',
  inputSchema: {
    type: 'object',
    properties: {
      city: { type: 'string', description: 'The city name from the user message' },
      day_count: { type: 'integer', description: 'The number of days from the user message' },
    },
    required: ['city', 'day_count'],
    additionalProperties: false,
  },
  /** Expected arguments; the prompt below asks for exactly these. */
  expected: { city: 'Reykjavik', day_count: 3 },
} as const

const TOOL_PROBE_SYSTEM =
  'You are running a tool-calling self-test. You must answer only by calling the' +
  ' byok_selftest_echo tool exactly once. Do not write any prose.'

const TOOL_PROBE_USER =
  'Record the city Reykjavik and a day count of 3 by calling byok_selftest_echo.'

/**
 * Test Tool Calling: runs a real streaming turn with the probe schema and
 * verifies a well-formed call comes back.
 *
 * It deliberately goes through `streamForProvider` — the exact path the editors
 * use — so a gateway that streams prose fine but mangles `tool_calls` deltas is
 * caught here rather than in the middle of a document edit.
 */
export async function testToolCalling(
  provider: AiProviderId,
  config: AiProviderConfig,
  options: AiCheckOptions = {},
): Promise<AiCheckResult> {
  const configError = checkConfig(provider, config)
  if (configError) return configError

  const controller = new AbortController()
  if (options.signal) {
    if (options.signal.aborted) controller.abort()
    else options.signal.addEventListener('abort', () => controller.abort(), { once: true })
  }

  const calls: Array<{ name: string; input: Record<string, unknown>; inputError?: string }> = []
  let text = ''
  let sawActivity = false
  try {
    await streamForProvider(
      provider,
      config,
      TOOL_PROBE_SYSTEM,
      [{ role: 'user', text: TOOL_PROBE_USER }],
      [
        {
          name: TOOL_CALL_PROBE.name,
          description: TOOL_CALL_PROBE.description,
          inputSchema: TOOL_CALL_PROBE.inputSchema as unknown as Record<string, unknown>,
        },
      ],
      256,
      {
        signal: controller.signal,
        onDelta: (delta) => {
          text += delta
        },
        onToolCall: (call) =>
          calls.push({
            name: call.name,
            input: call.input,
            ...(call.inputError ? { inputError: call.inputError } : {}),
          }),
        onActivity: () => {
          sawActivity = true
        },
      },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (err instanceof AiTimeoutError) {
      return failure('connectivity', message, config.apiKey)
    }
    const kind = classifyProviderError(message)
    // bytes arrived and then the turn fell apart: that is a streaming-layer
    // failure, not a connectivity or protocol-shape one
    return failure(
      sawActivity && kind === 'protocol' ? 'streaming' : kind,
      message,
      config.apiKey,
    )
  }

  const call = calls.find((c) => c.name === TOOL_CALL_PROBE.name)
  if (!call) {
    const returned = text.trim()
    return failure(
      'tool-calling',
      calls.length > 0
        ? `The model called ${calls.map((c) => c.name).join(', ')} instead of ${TOOL_CALL_PROBE.name}`
        : `The model answered with text instead of a tool call${returned ? `: ${returned.slice(0, 200)}` : ''}`,
      config.apiKey,
    )
  }
  if (call.inputError) {
    return failure(
      'tool-calling',
      `The tool call arguments were not valid JSON: ${call.inputError}`,
      config.apiKey,
    )
  }
  if (typeof call.input.city !== 'string' || !call.input.city.trim()) {
    return failure('tool-calling', 'The tool call omitted the required "city" argument', config.apiKey)
  }
  if (typeof call.input.day_count !== 'number') {
    return failure(
      'tool-calling',
      'The tool call omitted the required "day_count" argument or sent it as the wrong type',
      config.apiKey,
    )
  }
  return {
    ok: true,
    detail: `${config.model} called ${TOOL_CALL_PROBE.name}({ city: ${JSON.stringify(call.input.city)}, day_count: ${call.input.day_count} })`,
  }
}
