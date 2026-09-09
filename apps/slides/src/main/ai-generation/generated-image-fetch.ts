import { isSafeRemoteUrl } from '@genoffice/electron-utils'

export interface FetchedGeneratedImage {
  bytes: Uint8Array
  declaredContentType: string | null
}

export type GeneratedImageUrlValidator = (url: URL) => boolean | Promise<boolean>

export interface FetchGeneratedImageOptions {
  maxRedirects?: number
  maxBytes?: number
  timeoutMs?: number
  signal?: AbortSignal
  fetchImpl?: typeof fetch
  /** Injectable for deterministic DNS/address-policy tests. */
  urlValidator?: GeneratedImageUrlValidator
}

const DEFAULT_MAX_REDIRECTS = 3
const DEFAULT_MAX_BYTES = 12 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 90_000

async function defaultUrlValidator(url: URL): Promise<boolean> {
  return isSafeRemoteUrl(url.toString())
}

async function assertSafeUrl(raw: string, validator: GeneratedImageUrlValidator): Promise<URL> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('generated image URL is not a safe public HTTPS URL')
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '')
    throw new Error('generated image URL is not a safe public HTTPS URL')
  if (!(await validator(url))) throw new Error('generated image URL is not a safe public HTTPS URL')
  return url
}

function positiveInteger(value: number, name: string, allowZero = false): number {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1))
    throw new Error(`invalid generated image fetch ${name}`)
  return value
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  const contentLength = response.headers.get('content-length')
  if (contentLength !== null) {
    const parsed = Number(contentLength)
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maxBytes)
      throw new Error('generated image response body exceeds byte limit')
  }
  if (!response.body) throw new Error('generated image response body is empty')

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) {
        await reader.cancel()
        throw new Error('generated image response body exceeds byte limit')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  if (size === 0) throw new Error('generated image response body is empty')
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

/**
 * Downloads a short-lived provider result through a strict compatibility path.
 * HTTPS, credentials, DNS/address policy, and redirect destinations are checked at every hop;
 * the body is streamed into a fixed upper bound and all public errors omit the source URL.
 */
export async function fetchGeneratedImage(
  rawUrl: string,
  options: FetchGeneratedImageOptions = {},
): Promise<FetchedGeneratedImage> {
  const maxRedirects = positiveInteger(
    options.maxRedirects ?? DEFAULT_MAX_REDIRECTS,
    'maxRedirects',
    true,
  )
  const maxBytes = positiveInteger(options.maxBytes ?? DEFAULT_MAX_BYTES, 'maxBytes')
  const timeoutMs = positiveInteger(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 'timeoutMs')
  const fetchImpl = options.fetchImpl ?? fetch
  const validator = options.urlValidator ?? defaultUrlValidator
  const controller = new AbortController()
  const onAbort = () => controller.abort(options.signal?.reason)
  options.signal?.addEventListener('abort', onAbort, { once: true })
  if (options.signal?.aborted) onAbort()
  const timer = setTimeout(() => controller.abort(new Error('generated image fetch timed out')), timeoutMs)

  try {
    let current = rawUrl
    for (let hop = 0; hop <= maxRedirects; hop++) {
      const url = await assertSafeUrl(current, validator)
      let response: Response
      try {
        response = await fetchImpl(url.toString(), {
          method: 'GET',
          redirect: 'manual',
          signal: controller.signal,
          headers: { Accept: 'image/png,image/jpeg' },
        })
      } catch (error) {
        if (controller.signal.aborted) {
          if (options.signal?.aborted)
            throw new Error('generated image fetch aborted', { cause: error })
          throw new Error('generated image fetch timed out', { cause: error })
        }
        throw new Error('generated image fetch failed', { cause: error })
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        if (!location) throw new Error('generated image redirect is missing a location')
        if (hop === maxRedirects) throw new Error('generated image fetch has too many redirects')
        try {
          current = new URL(location, url).toString()
        } catch {
          throw new Error('generated image redirect is invalid')
        }
        continue
      }
      if (!response.ok) throw new Error(`generated image fetch failed with HTTP ${response.status}`)
      return {
        bytes: await readBoundedBody(response, maxBytes),
        declaredContentType: response.headers.get('content-type'),
      }
    }
    throw new Error('generated image fetch has too many redirects')
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', onAbort)
  }
}
