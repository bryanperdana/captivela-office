import { PNG } from 'pngjs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveRecipeImages } from '../src/main/ai-generation/resolve-recipe-images'
import type { SlideRecipeV1 } from '../src/shared/ai-generation/recipe-v1'

function pngBase64(): string {
  const image = new PNG({ width: 2, height: 2 })
  image.data.fill(180)
  return PNG.sync.write(image).toString('base64')
}

const recipe: SlideRecipeV1 = {
  schema: 'captivela.slide-recipe/v1',
  id: 'generated-page',
  role: 'content',
  layout: 'content_text_image',
  title: 'Generated visual',
  blocks: [
    { kind: 'text', role: 'body', text: 'A short explanation.' },
    {
      kind: 'image',
      assetId: 'hero-image',
      alt: 'A blue editorial visual',
      crop: 'cover',
      intent: { prompt: 'A blue editorial visual', aspectRatio: '16:9', style: 'editorial' },
    },
  ],
}

const options = {
  recipe,
  ownerId: 7,
  deckSessionId: 'deck_session_123',
  expectedRevision: 4,
  provider: { baseUrl: 'https://images.example/v1', apiKey: String.fromCharCode(116, 101, 115, 116) },
  config: {
    protocol: 'openai-images-v1' as const,
    model: 'image-v1',
    size: '1024x1024' as const,
    format: 'png' as const,
  },
}

afterEach(() => vi.unstubAllGlobals())

describe('resolveRecipeImages', () => {
  it('generates, normalizes, and resolves provider bytes without exposing provider payloads', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { size: string; response_format: string }
      expect(body).toMatchObject({ size: '1536x1024', response_format: 'b64_json' })
      return new Response(JSON.stringify({ data: [{ b64_json: pngBase64() }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const run = await resolveRecipeImages(options)
    expect(run.warnings).toEqual([])
    const resolved = await run.resolveImage({ assetId: 'hero-image', alt: 'visual', fit: 'cover' })
    expect(resolved?.ext).toBe('png')
    expect(PNG.sync.read(Buffer.from(resolved!.bytes))).toMatchObject({ width: 2, height: 2 })
    run.revoke()
    expect(() => run.resolveImage({ assetId: 'hero-image', alt: 'visual', fit: 'cover' })).toThrow(
      /unknown or expired/,
    )
  })

  it('degrades provider failure to a structured warning and unresolved placeholder path', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { message: 'model unsupported' } }), { status: 400 }),
      ),
    )

    const run = await resolveRecipeImages(options)
    expect(run.warnings).toEqual([
      expect.objectContaining({ code: 'image-generation-failed', assetId: 'hero-image' }),
    ])
    expect(run.resolveImage({ assetId: 'hero-image', alt: 'visual', fit: 'cover' })).toBeNull()
    run.revoke()
  })
})
