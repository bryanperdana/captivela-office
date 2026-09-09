import { describe, expect, it, vi } from 'vitest'
import {
  IMAGE_GENERATION_LIMITS,
  ImageGenerationError,
  classifyImageGenerationError,
  generateImage,
  normalizeImageGenerationEndpoint,
  testImageGenerationCapability,
  validateImageGenerationConfig,
  validateImageGenerationProvider,
  validateImageGenerationRequest,
} from '../src/image-generation'
import { errorResponse, jsonResponse } from './test-utils'

const PROVIDER = {
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'test-token-not-a-secret',
}

const CONFIG = {
  protocol: 'openai-images-v1' as const,
  model: 'image-model',
  size: '1024x1024' as const,
  format: 'png' as const,
}

const REQUEST = { prompt: 'A clean editorial illustration', count: 1 as const }

function fetchOption(fetchImpl: ReturnType<typeof vi.fn>) {
  return { fetchImpl: fetchImpl as unknown as typeof fetch }
}

describe('image-generation contract validation', () => {
  it('accepts and normalizes the bounded V1 contract', () => {
    expect(
      validateImageGenerationProvider({ ...PROVIDER, baseUrl: ' https://api.example.com/v1/ ' }),
    ).toEqual({
      ok: true,
      value: PROVIDER,
    })
    expect(validateImageGenerationConfig(CONFIG)).toEqual({ ok: true, value: CONFIG })
    expect(validateImageGenerationRequest({ prompt: '  draw this  ', count: 1 })).toEqual({
      ok: true,
      value: { prompt: 'draw this', count: 1 },
    })
  })

  it('rejects unknown protocol and unknown provider/config/request keys', () => {
    expect(
      validateImageGenerationConfig({ ...CONFIG, protocol: 'vendor-images-v2' }),
    ).toMatchObject({ ok: false })
    expect(
      validateImageGenerationProvider({ ...PROVIDER, headers: { 'x-extra': 'no' } }),
    ).toMatchObject({ ok: false })
    expect(validateImageGenerationConfig({ ...CONFIG, endpointPath: '/anything' })).toMatchObject({
      ok: false,
    })
    expect(
      validateImageGenerationRequest({ ...REQUEST, url: 'https://example.com/input.png' }),
    ).toMatchObject({ ok: false })
  })

  it('rejects blank/overlong prompts and allows exactly one image', () => {
    expect(validateImageGenerationRequest({ prompt: '   ', count: 1 })).toMatchObject({ ok: false })
    expect(
      validateImageGenerationRequest({
        prompt: 'x'.repeat(IMAGE_GENERATION_LIMITS.promptChars + 1),
        count: 1,
      }),
    ).toMatchObject({ ok: false })
    expect(validateImageGenerationRequest({ prompt: 'draw', count: 2 })).toMatchObject({
      ok: false,
    })
    expect(validateImageGenerationRequest({ prompt: 'draw' })).toMatchObject({ ok: false })
  })

  it('bounds negative prompt, model, URL, and API-key fields', () => {
    expect(
      validateImageGenerationRequest({
        ...REQUEST,
        negativePrompt: 'x'.repeat(IMAGE_GENERATION_LIMITS.negativePromptChars + 1),
      }),
    ).toMatchObject({ ok: false })
    expect(
      validateImageGenerationConfig({
        ...CONFIG,
        model: 'x'.repeat(IMAGE_GENERATION_LIMITS.modelChars + 1),
      }),
    ).toMatchObject({ ok: false })
    expect(
      validateImageGenerationProvider({
        ...PROVIDER,
        baseUrl: `https://example.com/${'x'.repeat(IMAGE_GENERATION_LIMITS.baseUrlChars)}`,
      }),
    ).toMatchObject({ ok: false })
    expect(
      validateImageGenerationProvider({
        ...PROVIDER,
        apiKey: 'x'.repeat(IMAGE_GENERATION_LIMITS.apiKeyChars + 1),
      }),
    ).toMatchObject({ ok: false })
  })
})

describe('OpenAI Images V1 adapter', () => {
  it('normalizes /images/generations exactly once', () => {
    expect(normalizeImageGenerationEndpoint('https://api.example.com/v1')).toEqual({
      ok: true,
      value: 'https://api.example.com/v1/images/generations',
    })
    expect(normalizeImageGenerationEndpoint('https://api.example.com/v1/')).toEqual({
      ok: true,
      value: 'https://api.example.com/v1/images/generations',
    })
    expect(
      normalizeImageGenerationEndpoint('https://api.example.com/v1/images/generations/'),
    ).toEqual({
      ok: true,
      value: 'https://api.example.com/v1/images/generations',
    })
  })

  it('posts a bounded OpenAI-compatible request with bearer auth', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ data: [{ b64_json: 'aGVsbG8=' }] }),
    )
    await generateImage(
      PROVIDER,
      CONFIG,
      { ...REQUEST, negativePrompt: 'No text' },
      fetchOption(fetchImpl),
    )

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://api.example.com/v1/images/generations')
    const init = fetchImpl.mock.calls[0]![1] as RequestInit
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-token-not-a-secret',
    })
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'image-model',
      prompt: 'A clean editorial illustration\n\nAvoid: No text',
      n: 1,
      size: '1024x1024',
      response_format: 'b64_json',
      output_format: 'png',
    })
  })

  it('omits authorization and model when they are not configured', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ data: [{ b64_json: 'aGVsbG8=' }] }),
    )
    await generateImage(
      { ...PROVIDER, apiKey: '' },
      { ...CONFIG, model: undefined },
      REQUEST,
      fetchOption(fetchImpl),
    )
    const init = fetchImpl.mock.calls[0]![1] as RequestInit
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(JSON.parse(init.body as string)).not.toHaveProperty('model')
  })

  it('parses b64_json without decoding it', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ data: [{ b64_json: 'aGVsbG8=' }] }))
    await expect(generateImage(PROVIDER, CONFIG, REQUEST, fetchOption(fetchImpl))).resolves.toEqual(
      {
        kind: 'base64',
        data: 'aGVsbG8=',
      },
    )
  })

  it('returns a URL payload without fetching the URL', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ data: [{ url: 'https://cdn.example.com/result.png' }] }),
    )
    await expect(generateImage(PROVIDER, CONFIG, REQUEST, fetchOption(fetchImpl))).resolves.toEqual(
      {
        kind: 'remote-url',
        url: 'https://cdn.example.com/result.png',
      },
    )
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it.each([
    { data: [] },
    { data: [{}, { b64_json: 'one' }] },
    { data: [{ b64_json: '' }] },
    { data: [{ url: '' }] },
    { data: [{ b64_json: 'one', url: 'https://cdn.example.com/result.png' }] },
    { choices: [{ message: { content: 'Here is your image' } }] },
  ])('rejects empty, multiple, mixed, or non-image result %#', async (body) => {
    const fetchImpl = vi.fn(async () => jsonResponse(body))
    await expect(
      generateImage(PROVIDER, CONFIG, REQUEST, fetchOption(fetchImpl)),
    ).rejects.toMatchObject({
      name: 'ImageGenerationError',
      kind: 'protocol',
    })
  })

  it('classifies auth, model, protocol, policy, and connectivity failures', () => {
    expect(classifyImageGenerationError(401, 'unauthorized')).toBe('auth')
    expect(classifyImageGenerationError(403, 'forbidden')).toBe('auth')
    expect(classifyImageGenerationError(400, 'upstream model image-model is unsupported')).toBe(
      'model',
    )
    expect(classifyImageGenerationError(404, 'route not found')).toBe('protocol')
    expect(classifyImageGenerationError(400, 'content policy violation')).toBe('policy')
    expect(classifyImageGenerationError(429, 'rate limited')).toBe('connectivity')
    expect(classifyImageGenerationError(503, 'unavailable')).toBe('connectivity')
  })

  it('redacts API keys, bearer values, and base64 response data from errors', async () => {
    const encoded = 'A'.repeat(256)
    const fetchImpl = vi.fn(async () =>
      errorResponse(
        400,
        JSON.stringify({
          error: `rejected key ${PROVIDER.apiKey}`,
          authorization: `Bearer ${PROVIDER.apiKey}`,
          b64_json: encoded,
        }),
      ),
    )
    const error = await generateImage(PROVIDER, CONFIG, REQUEST, fetchOption(fetchImpl)).catch(
      (caught: unknown) => caught,
    )
    expect(error).toBeInstanceOf(ImageGenerationError)
    expect((error as Error).message).not.toContain(PROVIDER.apiKey)
    expect((error as Error).message).not.toContain(encoded)
    expect((error as Error).message).toContain('[redacted]')
  })

  it('supports a bounded timeout', async () => {
    const fetchImpl = vi.fn(
      async (_url: string, init?: RequestInit) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('The operation was aborted', 'AbortError')),
            { once: true },
          )
        }),
    )
    await expect(
      generateImage(PROVIDER, CONFIG, REQUEST, {
        ...fetchOption(fetchImpl),
        timeoutMs: 5,
      }),
    ).rejects.toMatchObject({ name: 'ImageGenerationError', kind: 'timeout' })
  })

  it('supports caller cancellation without sending a request when already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetchImpl = vi.fn()
    await expect(
      generateImage(PROVIDER, CONFIG, REQUEST, {
        ...fetchOption(fetchImpl),
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'ImageGenerationError', kind: 'cancelled' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('supports caller cancellation while reading the response', async () => {
    const controller = new AbortController()
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(streamController) {
          init?.signal?.addEventListener(
            'abort',
            () =>
              streamController.error(new DOMException('The operation was aborted', 'AbortError')),
            { once: true },
          )
        },
      })
      return new Response(body, { status: 200 })
    })
    const pending = generateImage(PROVIDER, CONFIG, REQUEST, {
      ...fetchOption(fetchImpl),
      signal: controller.signal,
    })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'ImageGenerationError', kind: 'cancelled' })
  })
})

describe('image-generation capability result', () => {
  it('marks support only after a valid image result', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ data: [{ b64_json: 'aGVsbG8=' }] }))
    await expect(
      testImageGenerationCapability(PROVIDER, CONFIG, fetchOption(fetchImpl)),
    ).resolves.toEqual({
      supported: true,
      protocol: 'openai-images-v1',
      model: 'image-model',
      detail: 'The endpoint returned one base64 image payload',
    })
  })

  it('returns a classified, redacted failure instead of throwing', async () => {
    const encoded = 'B'.repeat(256)
    const fetchImpl = vi.fn(async () =>
      errorResponse(400, `upstream model failed ${PROVIDER.apiKey} ${encoded}`),
    )
    const result = await testImageGenerationCapability(PROVIDER, CONFIG, fetchOption(fetchImpl))
    expect(result).toMatchObject({
      supported: false,
      protocol: 'openai-images-v1',
      model: 'image-model',
      kind: 'model',
    })
    if (result.supported) throw new Error('Expected a failed capability result')
    expect(result.error).not.toContain(PROVIDER.apiKey)
    expect(result.error).not.toContain(encoded)
  })

  it('does not conflate timeout/cancellation with image support', async () => {
    const controller = new AbortController()
    controller.abort()
    const result = await testImageGenerationCapability(PROVIDER, CONFIG, {
      fetchImpl: vi.fn() as unknown as typeof fetch,
      signal: controller.signal,
    })
    expect(result).toMatchObject({ supported: false, kind: 'connectivity' })
  })
})
