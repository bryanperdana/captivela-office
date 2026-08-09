import { afterEach, describe, expect, it, vi } from 'vitest'
import { TOOL_CALL_PROBE, classifyProviderError, testConnection, testToolCalling } from '../src/compat'
import { errorResponse, jsonResponse, okResponse, sseStream } from './test-utils'

const CONFIG = { apiKey: 'sk-test-key-value', model: 'gpt-4.1-mini', baseUrl: 'https://api.example.com/v1' }

afterEach(() => {
  vi.unstubAllGlobals()
})

/** SSE frames for an OpenAI-compatible tool call, split across argument chunks. */
function toolCallStream(name: string, args: string, chunkSize = 8): string[] {
  const frames = [
    `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name } }] } }] })}`,
  ]
  for (let i = 0; i < args.length; i += chunkSize) {
    const arguments_ = args.slice(i, i + chunkSize)
    frames.push(
      `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: arguments_ } }] } }] })}`,
    )
  }
  frames.push(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })}`)
  frames.push('data: [DONE]')
  return frames
}

describe('testConnection', () => {
  it('passes when /models lists the selected model', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ data: [{ id: 'gpt-4.1-mini' }, { id: 'gpt-4o' }] }),
    )
    const result = await testConnection('openai', CONFIG, { fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(result.ok).toBe(true)
    expect(result.detail).toContain('gpt-4.1-mini')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://api.example.com/v1/models')
  })

  it('sends the API key as a bearer token', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ data: [{ id: 'gpt-4.1-mini' }] }),
    )
    await testConnection('openai', CONFIG, { fetchImpl: fetchImpl as unknown as typeof fetch })
    const init = fetchImpl.mock.calls[0]![1]!
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test-key-value')
  })

  it('reports auth when the endpoint rejects the key', async () => {
    const fetchImpl = vi.fn(async () => errorResponse(401, 'invalid api key'))
    const result = await testConnection('openai', CONFIG, { fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(result).toMatchObject({ ok: false, kind: 'auth' })
  })

  it('reports connectivity when the host cannot be reached', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })
    const result = await testConnection('ollama', { ...CONFIG, apiKey: '', baseUrl: 'http://localhost:11434/v1' }, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result).toMatchObject({ ok: false, kind: 'connectivity' })
  })

  it('falls back to a chat probe when /models is unimplemented', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.endsWith('/models')
        ? errorResponse(404, 'not found')
        : jsonResponse({ choices: [{ message: { content: 'ok' } }] }),
    )
    const result = await testConnection('litellm', CONFIG, { fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(result.ok).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(fetchImpl.mock.calls[1]![0]).toBe('https://api.example.com/v1/chat/completions')
  })

  it('reports model when the model is absent from the list and the probe 404s', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.endsWith('/models')
        ? jsonResponse({ data: [{ id: 'llama3.1' }, { id: 'qwen2.5' }] })
        : errorResponse(404, 'model not found'),
    )
    const result = await testConnection('ollama', { ...CONFIG, baseUrl: 'http://localhost:11434/v1' }, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result).toMatchObject({ ok: false, kind: 'model' })
    expect(result.error).toContain('llama3.1')
  })

  it('passes when the model is unlisted but the probe answers (scoped proxy lists)', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.endsWith('/models')
        ? jsonResponse({ data: [{ id: 'something-else' }] })
        : jsonResponse({ choices: [{ message: { content: 'ok' } }] }),
    )
    const result = await testConnection('custom', CONFIG, { fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(result.ok).toBe(true)
  })

  it('reports protocol when the endpoint answers in a non-OpenAI shape', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.endsWith('/models') ? errorResponse(404, '') : jsonResponse({ result: 'hello' }),
    )
    const result = await testConnection('custom', CONFIG, { fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(result).toMatchObject({ ok: false, kind: 'protocol' })
  })

  it('reports config without sending a request when settings are incomplete', async () => {
    const fetchImpl = vi.fn()
    expect(
      await testConnection('openai', { ...CONFIG, model: '' }, { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).toMatchObject({ ok: false, kind: 'config' })
    expect(
      await testConnection('openai', { ...CONFIG, apiKey: '' }, { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).toMatchObject({ ok: false, kind: 'config' })
    expect(
      await testConnection('custom', { ...CONFIG, baseUrl: '' }, { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).toMatchObject({ ok: false, kind: 'config' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('allows an empty key for providers whose key is optional', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ data: [{ id: 'gpt-4.1-mini' }] }),
    )
    const result = await testConnection(
      'ollama',
      { ...CONFIG, apiKey: '', baseUrl: 'http://localhost:11434/v1' },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    )
    expect(result.ok).toBe(true)
    expect(fetchImpl.mock.calls[0]![1]!.headers).toEqual({})
  })

  it('never echoes the API key back in an error', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.endsWith('/models')
        ? errorResponse(404, '')
        : errorResponse(400, 'bad request for key sk-test-key-value'),
    )
    const result = await testConnection('custom', CONFIG, { fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(result.ok).toBe(false)
    expect(result.error).not.toContain('sk-test-key-value')
    expect(result.error).toContain('[redacted]')
  })
})

describe('testToolCalling', () => {
  it('passes when the model returns the probe call with valid arguments', async () => {
    const fetchImpl = vi.fn(async () =>
      okResponse(sseStream(toolCallStream(TOOL_CALL_PROBE.name, '{"city":"Reykjavik","day_count":3}'))),
    )
    vi.stubGlobal('fetch', fetchImpl)
    const result = await testToolCalling('openai', CONFIG)
    expect(result.ok).toBe(true)
    expect(result.detail).toContain('Reykjavik')
  })

  it('sends the deterministic probe schema in the request', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) =>
      okResponse(sseStream(toolCallStream(TOOL_CALL_PROBE.name, '{"city":"Reykjavik","day_count":3}'))),
    )
    vi.stubGlobal('fetch', fetchImpl)
    await testToolCalling('openai', CONFIG)
    const body = JSON.parse(fetchImpl.mock.calls[0]![1]!.body as string) as {
      tools: Array<{ function: { name: string; parameters: unknown } }>
      stream: boolean
    }
    expect(body.stream).toBe(true)
    expect(body.tools).toHaveLength(1)
    expect(body.tools[0]!.function.name).toBe(TOOL_CALL_PROBE.name)
    expect(body.tools[0]!.function.parameters).toEqual(TOOL_CALL_PROBE.inputSchema)
  })

  it('reports tool-calling when the model answers with prose instead', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        okResponse(
          sseStream([
            `data: ${JSON.stringify({ choices: [{ delta: { content: 'Sure, Reykjavik for 3 days!' } }] })}`,
            `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}`,
            'data: [DONE]',
          ]),
        ),
      ),
    )
    const result = await testToolCalling('openai', CONFIG)
    expect(result).toMatchObject({ ok: false, kind: 'tool-calling' })
    expect(result.error).toContain('Sure, Reykjavik for 3 days!')
  })

  it('reports tool-calling when a different tool is called', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => okResponse(sseStream(toolCallStream('some_other_tool', '{}')))),
    )
    const result = await testToolCalling('openai', CONFIG)
    expect(result).toMatchObject({ ok: false, kind: 'tool-calling' })
    expect(result.error).toContain('some_other_tool')
  })

  it('reports tool-calling when a required argument is missing or mistyped', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => okResponse(sseStream(toolCallStream(TOOL_CALL_PROBE.name, '{"city":"Reykjavik"}')))),
    )
    expect(await testToolCalling('openai', CONFIG)).toMatchObject({ ok: false, kind: 'tool-calling' })

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        okResponse(sseStream(toolCallStream(TOOL_CALL_PROBE.name, '{"city":"Reykjavik","day_count":"three"}'))),
      ),
    )
    expect(await testToolCalling('openai', CONFIG)).toMatchObject({ ok: false, kind: 'tool-calling' })
  })

  it('reports streaming when bytes arrive and then the SSE turn falls apart', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => okResponse(sseStream([': keepalive', ''])) ),
    )
    const result = await testToolCalling('openai', CONFIG)
    expect(result).toMatchObject({ ok: false, kind: 'streaming' })
  })

  it('reports auth when the streaming endpoint rejects the key', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => errorResponse(401, 'invalid api key')),
    )
    expect(await testToolCalling('openai', CONFIG)).toMatchObject({ ok: false, kind: 'auth' })
  })

  it('reports config without sending a request when no model is selected', async () => {
    const fetchImpl = vi.fn()
    vi.stubGlobal('fetch', fetchImpl)
    expect(await testToolCalling('openai', { ...CONFIG, model: '' })).toMatchObject({
      ok: false,
      kind: 'config',
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('never echoes the API key back in an error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => errorResponse(400, 'rejected key sk-test-key-value')),
    )
    const result = await testToolCalling('openai', CONFIG)
    expect(result.error).not.toContain('sk-test-key-value')
  })
})

describe('classifyProviderError', () => {
  it('separates the failure layers', () => {
    expect(classifyProviderError('HTTP 401: unauthorized')).toBe('auth')
    expect(classifyProviderError('HTTP 403: forbidden')).toBe('auth')
    expect(classifyProviderError('HTTP 404: model gpt-9 does not exist')).toBe('model')
    expect(classifyProviderError('fetch failed')).toBe('connectivity')
    expect(classifyProviderError('The model returned no content (empty stream)')).toBe('protocol')
  })
})
