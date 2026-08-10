import { httpBodyDetail } from './http-error'
import { redactSecrets, validateBaseUrl, type Validated } from './settings'

/** The only provider wire protocol supported by the V1 adapter. */
export type ImageGenerationProtocol = 'openai-images-v1'
export type GeneratedImageFormat = 'png' | 'jpeg'
export type GeneratedImageSize = '1024x1024' | '1536x1024' | '1024x1536'

/** Non-secret image settings. Provider endpoint/key are supplied separately in main. */
export interface ImageGenerationConfig {
  protocol: ImageGenerationProtocol
  model?: string
  size: GeneratedImageSize
  format: GeneratedImageFormat
}

/** Provider connection resolved by a trusted caller (normally Electron main). */
export interface ImageGenerationProvider {
  baseUrl: string
  apiKey: string
}

export interface ImageGenerationRequest {
  prompt: string
  negativePrompt?: string
  /** V1 deliberately permits one result only. */
  count: 1
}

/** URL payloads are returned verbatim; this package never follows them. */
export type ImageGenerationPayload =
  { kind: 'base64'; data: string } | { kind: 'remote-url'; url: string }

export const IMAGE_GENERATION_LIMITS = {
  promptChars: 2_000,
  negativePromptChars: 1_000,
  modelChars: 256,
  baseUrlChars: 2_048,
  apiKeyChars: 8_192,
  requestTimeoutMs: 90_000,
  /** Allows a bounded encoded image response while preventing unlimited buffering. */
  responseBytes: 16 * 1024 * 1024,
  errorChars: 600,
} as const

export type ImageGenerationErrorKind =
  'config' | 'auth' | 'model' | 'protocol' | 'connectivity' | 'policy' | 'timeout' | 'cancelled'

export class ImageGenerationError extends Error {
  readonly kind: ImageGenerationErrorKind
  readonly status?: number

  constructor(kind: ImageGenerationErrorKind, message: string, status?: number) {
    super(message)
    this.name = 'ImageGenerationError'
    this.kind = kind
    if (status !== undefined) this.status = status
  }
}

export interface ImageGenerationOptions {
  fetchImpl?: typeof fetch
  signal?: AbortSignal
  /** Primarily useful for tests; production calls are capped at the exported default. */
  timeoutMs?: number
}

export type ImageGenerationCapabilityFailureKind =
  'auth' | 'model' | 'protocol' | 'connectivity' | 'policy'

export type ImageGenerationCapabilityResult =
  | {
      supported: true
      protocol: ImageGenerationProtocol
      model?: string
      detail: string
    }
  | {
      supported: false
      protocol: ImageGenerationProtocol
      model?: string
      kind: ImageGenerationCapabilityFailureKind
      error: string
    }

const PROVIDER_KEYS = new Set(['baseUrl', 'apiKey'])
const CONFIG_KEYS = new Set(['protocol', 'model', 'size', 'format'])
const REQUEST_KEYS = new Set(['prompt', 'negativePrompt', 'count'])
const SIZES: ReadonlySet<string> = new Set(['1024x1024', '1536x1024', '1024x1536'])
const FORMATS: ReadonlySet<string> = new Set(['png', 'jpeg'])

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function unknownKey(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): string | undefined {
  return Object.keys(value).find((key) => !allowed.has(key))
}

function boundedString(
  value: unknown,
  label: string,
  max: number,
  options: { allowEmpty?: boolean; trim?: boolean } = {},
): Validated<string> {
  if (typeof value !== 'string') return { ok: false, error: `${label} must be a string` }
  const normalized = options.trim === false ? value : value.trim()
  if (!options.allowEmpty && !normalized) return { ok: false, error: `${label} is required` }
  if (normalized.length > max) {
    return { ok: false, error: `${label} is longer than ${max} characters` }
  }
  return { ok: true, value: normalized }
}

/** Strictly validate connection fields and normalize the base URL. */
export function validateImageGenerationProvider(raw: unknown): Validated<ImageGenerationProvider> {
  if (!isPlainObject(raw)) return { ok: false, error: 'Image provider must be an object' }
  const extra = unknownKey(raw, PROVIDER_KEYS)
  if (extra) return { ok: false, error: `Unknown image provider field: ${extra}` }

  const baseUrl = boundedString(
    raw.baseUrl,
    'Image provider Base URL',
    IMAGE_GENERATION_LIMITS.baseUrlChars,
  )
  if (!baseUrl.ok) return baseUrl
  const normalized = validateBaseUrl(baseUrl.value)
  if (!normalized.ok) return { ok: false, error: `Image provider Base URL: ${normalized.error}` }

  const apiKey = boundedString(
    raw.apiKey,
    'Image provider API key',
    IMAGE_GENERATION_LIMITS.apiKeyChars,
    {
      allowEmpty: true,
      trim: false,
    },
  )
  if (!apiKey.ok) return apiKey
  return { ok: true, value: { baseUrl: normalized.value, apiKey: apiKey.value } }
}

/** Strictly validate non-secret image-generation configuration. */
export function validateImageGenerationConfig(raw: unknown): Validated<ImageGenerationConfig> {
  if (!isPlainObject(raw)) return { ok: false, error: 'Image generation config must be an object' }
  const extra = unknownKey(raw, CONFIG_KEYS)
  if (extra) return { ok: false, error: `Unknown image generation config field: ${extra}` }
  if (raw.protocol !== 'openai-images-v1') {
    return { ok: false, error: 'Unsupported image generation protocol' }
  }
  if (!SIZES.has(String(raw.size))) return { ok: false, error: 'Unsupported image size' }
  if (!FORMATS.has(String(raw.format))) return { ok: false, error: 'Unsupported image format' }

  let model: string | undefined
  if (raw.model !== undefined) {
    const checked = boundedString(raw.model, 'Image model', IMAGE_GENERATION_LIMITS.modelChars, {
      allowEmpty: true,
    })
    if (!checked.ok) return checked
    model = checked.value || undefined
  }
  return {
    ok: true,
    value: {
      protocol: 'openai-images-v1',
      ...(model ? { model } : {}),
      size: raw.size as GeneratedImageSize,
      format: raw.format as GeneratedImageFormat,
    },
  }
}

/** Strictly validate the bounded, provider-neutral V1 request. */
export function validateImageGenerationRequest(raw: unknown): Validated<ImageGenerationRequest> {
  if (!isPlainObject(raw)) return { ok: false, error: 'Image generation request must be an object' }
  const extra = unknownKey(raw, REQUEST_KEYS)
  if (extra) return { ok: false, error: `Unknown image generation request field: ${extra}` }
  const prompt = boundedString(raw.prompt, 'Image prompt', IMAGE_GENERATION_LIMITS.promptChars)
  if (!prompt.ok) return prompt
  if (raw.count !== 1) return { ok: false, error: 'Image count must be exactly 1' }

  let negativePrompt: string | undefined
  if (raw.negativePrompt !== undefined) {
    const checked = boundedString(
      raw.negativePrompt,
      'Negative image prompt',
      IMAGE_GENERATION_LIMITS.negativePromptChars,
      { allowEmpty: true },
    )
    if (!checked.ok) return checked
    negativePrompt = checked.value || undefined
  }
  return {
    ok: true,
    value: {
      prompt: prompt.value,
      ...(negativePrompt ? { negativePrompt } : {}),
      count: 1,
    },
  }
}

/**
 * Construct the fixed V1 route. If callers persisted the full route already,
 * keep it; otherwise append it exactly once. No model/recipe input controls it.
 */
export function normalizeImageGenerationEndpoint(rawBaseUrl: unknown): Validated<string> {
  const provider = validateImageGenerationProvider({ baseUrl: rawBaseUrl, apiKey: '' })
  if (!provider.ok) return provider
  const base = provider.value.baseUrl.replace(/\/+$/, '')
  return {
    ok: true,
    value: base.endsWith('/images/generations') ? base : `${base}/images/generations`,
  }
}

/** HTTP/upstream classification kept separate from transport and response parsing. */
export function classifyImageGenerationError(
  status: number | undefined,
  raw: string,
): Exclude<ImageGenerationErrorKind, 'config' | 'timeout' | 'cancelled'> {
  const text = raw.toLowerCase()
  if (
    status === 401 ||
    status === 402 ||
    status === 403 ||
    /invalid[_ ]api key|unauthorized|authentication/.test(text)
  ) {
    return 'auth'
  }
  if (/content policy|safety|moderation|blocked prompt|policy violation/.test(text)) return 'policy'
  if (
    /model .*(not found|does not exist|unavailable|unsupported|failed|cannot generate|can't generate)|unknown model|model_not_found|invalid model|upstream model/.test(
      text,
    )
  ) {
    return 'model'
  }
  if (status === 429 || (status !== undefined && status >= 500)) return 'connectivity'
  if (/fetch failed|econnrefused|enotfound|etimedout|econnreset|network|dns/.test(text)) {
    return 'connectivity'
  }
  return 'protocol'
}

function sanitizeProviderText(raw: string, secrets: Iterable<string | undefined>): string {
  let text = redactSecrets(raw, secrets)
  text = text.replace(/\bBearer\s+[^\s"']+/gi, 'Bearer [redacted]')
  text = text.replace(/("b64_json"\s*:\s*")[^"]*(")/gi, '$1[redacted]$2')
  text = text.replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi, 'data:image/[redacted]')
  // Provider errors occasionally dump encoded bytes outside a named JSON field.
  text = text.replace(/\b[A-Za-z0-9+/]{64,}={0,2}\b/g, '[redacted]')
  return httpBodyDetail(text).slice(0, IMAGE_GENERATION_LIMITS.errorChars)
}

async function readBoundedResponse(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let bytes = 0
  let text = ''
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > maxBytes) {
        await reader.cancel().catch(() => {})
        throw new ImageGenerationError(
          'protocol',
          `Image provider response exceeded ${maxBytes} bytes`,
        )
      }
      text += decoder.decode(value, { stream: true })
    }
    return text + decoder.decode()
  } finally {
    reader.releaseLock()
  }
}

function parseOpenAiImageResponse(raw: string): ImageGenerationPayload {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    throw new ImageGenerationError('protocol', 'Image provider returned malformed JSON')
  }
  if (!isPlainObject(json) || !Array.isArray(json.data) || json.data.length !== 1) {
    throw new ImageGenerationError(
      'protocol',
      'Image provider must return exactly one item in data',
    )
  }
  const item = json.data[0]
  if (!isPlainObject(item)) {
    throw new ImageGenerationError('protocol', 'Image provider returned an invalid data item')
  }
  const hasBase64 = typeof item.b64_json === 'string' && item.b64_json.length > 0
  const hasUrl = typeof item.url === 'string' && item.url.trim().length > 0
  if (hasBase64 === hasUrl) {
    throw new ImageGenerationError(
      'protocol',
      'Image provider must return exactly one non-empty b64_json or url payload',
    )
  }
  if (hasBase64) return { kind: 'base64', data: item.b64_json as string }
  return { kind: 'remote-url', url: (item.url as string).trim() }
}

function configError(error: string): ImageGenerationError {
  return new ImageGenerationError('config', error)
}

function timeoutValue(raw: number | undefined): number {
  if (raw === undefined) return IMAGE_GENERATION_LIMITS.requestTimeoutMs
  if (!Number.isFinite(raw) || raw <= 0)
    throw configError('Image generation timeout must be positive')
  return Math.min(Math.floor(raw), IMAGE_GENERATION_LIMITS.requestTimeoutMs)
}

/** Invoke one bounded OpenAI-compatible Images V1 request. */
export async function generateImage(
  rawProvider: unknown,
  rawConfig: unknown,
  rawRequest: unknown,
  options: ImageGenerationOptions = {},
): Promise<ImageGenerationPayload> {
  const provider = validateImageGenerationProvider(rawProvider)
  if (!provider.ok) throw configError(provider.error)
  const config = validateImageGenerationConfig(rawConfig)
  if (!config.ok) throw configError(config.error)
  const request = validateImageGenerationRequest(rawRequest)
  if (!request.ok) throw configError(request.error)
  const endpoint = normalizeImageGenerationEndpoint(provider.value.baseUrl)
  if (!endpoint.ok) throw configError(endpoint.error)
  const timeoutMs = timeoutValue(options.timeoutMs)

  if (options.signal?.aborted) {
    throw new ImageGenerationError('cancelled', 'Image generation was cancelled')
  }

  const controller = new AbortController()
  let timedOut = false
  const abortFromCaller = () => controller.abort(options.signal?.reason)
  options.signal?.addEventListener('abort', abortFromCaller, { once: true })
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  const prompt = request.value.negativePrompt
    ? `${request.value.prompt}\n\nAvoid: ${request.value.negativePrompt}`
    : request.value.prompt
  const body = {
    ...(config.value.model ? { model: config.value.model } : {}),
    prompt,
    n: 1,
    size: config.value.size,
    response_format: 'b64_json',
    output_format: config.value.format,
  }

  try {
    let response: Response
    try {
      response = await (options.fetchImpl ?? fetch)(endpoint.value, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(provider.value.apiKey ? { Authorization: `Bearer ${provider.value.apiKey}` } : {}),
        },
        body: JSON.stringify(body),
      })
    } catch (error) {
      if (timedOut)
        throw new ImageGenerationError('timeout', `Image generation timed out after ${timeoutMs}ms`)
      if (options.signal?.aborted)
        throw new ImageGenerationError('cancelled', 'Image generation was cancelled')
      const message = error instanceof Error ? error.message : String(error)
      throw new ImageGenerationError(
        'connectivity',
        sanitizeProviderText(`Cannot reach image provider: ${message}`, [provider.value.apiKey]),
      )
    }

    let raw: string
    try {
      raw = await readBoundedResponse(response, IMAGE_GENERATION_LIMITS.responseBytes)
    } catch (error) {
      if (error instanceof ImageGenerationError) throw error
      if (timedOut)
        throw new ImageGenerationError('timeout', `Image generation timed out after ${timeoutMs}ms`)
      if (options.signal?.aborted)
        throw new ImageGenerationError('cancelled', 'Image generation was cancelled')
      const message = error instanceof Error ? error.message : String(error)
      throw new ImageGenerationError(
        'connectivity',
        sanitizeProviderText(`Cannot read image provider response: ${message}`, [
          provider.value.apiKey,
        ]),
      )
    }
    if (!response.ok) {
      const safe = sanitizeProviderText(raw, [provider.value.apiKey])
      throw new ImageGenerationError(
        classifyImageGenerationError(response.status, raw),
        `Image provider HTTP ${response.status}: ${safe || 'request failed'}`,
        response.status,
      )
    }
    return parseOpenAiImageResponse(raw)
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', abortFromCaller)
  }
}

/**
 * Run a real, independent image probe. Chat/tool success never influences this
 * result; support is true only after one valid image payload is parsed.
 */
export async function testImageGenerationCapability(
  provider: unknown,
  rawConfig: unknown,
  options: ImageGenerationOptions = {},
): Promise<ImageGenerationCapabilityResult> {
  const checkedConfig = validateImageGenerationConfig(rawConfig)
  const protocol: ImageGenerationProtocol = 'openai-images-v1'
  const model = checkedConfig.ok ? checkedConfig.value.model : undefined
  try {
    const payload = await generateImage(
      provider,
      rawConfig,
      { prompt: 'A small solid blue square on a white background', count: 1 },
      options,
    )
    return {
      supported: true,
      protocol,
      ...(model ? { model } : {}),
      detail:
        payload.kind === 'base64'
          ? 'The endpoint returned one base64 image payload'
          : 'The endpoint returned one remote image URL payload',
    }
  } catch (error) {
    const caught =
      error instanceof ImageGenerationError
        ? error
        : new ImageGenerationError(
            'protocol',
            error instanceof Error ? error.message : String(error),
          )
    const kind: ImageGenerationCapabilityFailureKind =
      caught.kind === 'auth' ||
      caught.kind === 'model' ||
      caught.kind === 'protocol' ||
      caught.kind === 'policy'
        ? caught.kind
        : 'connectivity'
    return {
      supported: false,
      protocol,
      ...(model ? { model } : {}),
      kind,
      error: caught.message,
    }
  }
}
