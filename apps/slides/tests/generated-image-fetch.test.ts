import { describe, expect, it, vi } from 'vitest'
import { fetchGeneratedImage } from '../src/main/ai-generation/generated-image-fetch'

const publicOnly = vi.fn(async (url: URL) =>
  !['127.0.0.1', '169.254.169.254', '::1', 'fd00::1', 'fe80::1'].includes(
    url.hostname.replace(/^\[|\]$/g, ''),
  ),
)

describe('fetchGeneratedImage', () => {
  it('fetches bounded bytes from a public HTTPS URL with manual redirects', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'image/png', 'content-length': '3' },
      }),
    )
    await expect(
      fetchGeneratedImage('https://8.8.8.8/image.png', { fetchImpl, urlValidator: publicOnly }),
    ).resolves.toEqual({ bytes: new Uint8Array([1, 2, 3]), declaredContentType: 'image/png' })
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ redirect: 'manual' })
  })

  it.each([
    'http://8.8.8.8/image.png',
    'file:///etc/passwd',
    'data:image/png;base64,AAAA',
    'https://user:pass@8.8.8.8/image.png',
    'https://127.0.0.1/image.png',
    'https://169.254.169.254/latest/meta-data',
    'https://[::1]/image.png',
    'https://[fd00::1]/image.png',
    'https://[fe80::1]/image.png',
  ])('rejects unsafe remote URL %s before requesting it', async (url) => {
    const fetchImpl = vi.fn()
    await expect(fetchGeneratedImage(url, { fetchImpl, urlValidator: publicOnly })).rejects.toThrow(
      /safe public HTTPS URL/,
    )
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('revalidates every redirect and never requests a private redirect target', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/secret' } }),
      )
    await expect(
      fetchGeneratedImage('https://8.8.8.8/start', { fetchImpl, urlValidator: publicOnly }),
    ).rejects.toThrow(/safe public HTTPS URL/)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('rejects redirects that downgrade to HTTP and excessive redirect chains', async () => {
    const downgrade = vi.fn().mockResolvedValue(
      new Response(null, { status: 302, headers: { location: 'http://8.8.8.8/plain' } }),
    )
    await expect(
      fetchGeneratedImage('https://8.8.8.8/start', { fetchImpl: downgrade, urlValidator: publicOnly }),
    ).rejects.toThrow(/safe public HTTPS URL/)

    const loop = vi.fn().mockResolvedValue(
      new Response(null, { status: 302, headers: { location: 'https://8.8.8.8/loop' } }),
    )
    await expect(
      fetchGeneratedImage('https://8.8.8.8/loop', {
        fetchImpl: loop,
        urlValidator: publicOnly,
        maxRedirects: 2,
      }),
    ).rejects.toThrow(/too many redirects/)
    expect(loop).toHaveBeenCalledTimes(3)
  })

  it('rejects oversized Content-Length and streaming bodies without buffering the full body', async () => {
    const preflight = vi.fn().mockResolvedValue(
      new Response('12345', { status: 200, headers: { 'content-length': '5' } }),
    )
    await expect(
      fetchGeneratedImage('https://8.8.8.8/a', {
        fetchImpl: preflight,
        urlValidator: publicOnly,
        maxBytes: 4,
      }),
    ).rejects.toThrow(/body exceeds/)

    let pulls = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++
        controller.enqueue(new Uint8Array([1, 2, 3]))
        if (pulls > 5) controller.close()
      },
    })
    const streaming = vi.fn().mockResolvedValue(new Response(stream, { status: 200 }))
    await expect(
      fetchGeneratedImage('https://8.8.8.8/a', {
        fetchImpl: streaming,
        urlValidator: publicOnly,
        maxBytes: 4,
      }),
    ).rejects.toThrow(/body exceeds/)
    expect(pulls).toBeLessThanOrEqual(3)
  })

  it('times out through AbortSignal and redacts URL details from errors', async () => {
    const fetchImpl = vi.fn((_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
      }),
    ) as unknown as typeof fetch
    await expect(
      fetchGeneratedImage('https://8.8.8.8/private-token.png?secret=abc', {
        fetchImpl,
        urlValidator: publicOnly,
        timeoutMs: 5,
      }),
    ).rejects.toThrow(/timed out/)
    try {
      await fetchGeneratedImage('https://8.8.8.8/private-token.png?secret=abc', {
        fetchImpl,
        urlValidator: publicOnly,
        timeoutMs: 5,
      })
    } catch (error) {
      expect(String(error)).not.toContain('private-token')
      expect(String(error)).not.toContain('secret=abc')
    }
  })

  it('rejects DNS validation failure and non-success HTTP responses', async () => {
    const fetchImpl = vi.fn()
    await expect(
      fetchGeneratedImage('https://example.invalid/a', {
        fetchImpl,
        urlValidator: vi.fn(async () => false),
      }),
    ).rejects.toThrow(/safe public HTTPS URL/)
    expect(fetchImpl).not.toHaveBeenCalled()

    await expect(
      fetchGeneratedImage('https://8.8.8.8/a', {
        fetchImpl: vi.fn().mockResolvedValue(new Response('no', { status: 404 })),
        urlValidator: publicOnly,
      }),
    ).rejects.toThrow(/HTTP 404/)
  })
})
