import { describe, expect, it } from 'vitest'
import {
  AI_GENERATION_LIMITS,
  validateDeckRecipeV1,
  validateSlideRecipeV1,
} from '../src/shared/ai-generation/recipe-v1'
import { validateNativeSlideIR } from '../src/shared/ai-generation/native-slide-ir'

const validSlide = () => ({
  schema: 'captivela.slide-recipe/v1',
  id: 'intro',
  role: 'cover',
  layout: 'cover_typography_hero',
  title: 'A safer generation foundation',
  blocks: [
    { kind: 'text', role: 'subtitle', text: 'Semantic content, compiled locally' },
    { kind: 'image', assetId: 'hero-image', alt: 'Abstract presentation artwork' },
  ],
})

const validDeck = () => ({
  schema: 'captivela.deck-recipe/v1',
  title: 'Captivela AI Slides',
  theme: {
    background: '#FFFFFF',
    text: '#14213D',
    accent: '#FCA311',
  },
  assets: [
    { id: 'hero-image', source: 'https://cdn.example.com/slides/hero.png', alt: 'Hero' },
    { id: 'logo', source: 'asset_brand_logo', alt: 'Brand logo' },
  ],
  slides: [validSlide()],
})

function expectInvalid(result: ReturnType<typeof validateDeckRecipeV1>, fragment?: string) {
  expect(result.ok).toBe(false)
  if (!result.ok && fragment) {
    expect(result.errors.map((error) => `${error.path}: ${error.message}`).join('\n')).toContain(fragment)
  }
}

describe('DeckRecipeV1 / SlideRecipeV1 validation', () => {
  it('accepts a valid semantic deck recipe', () => {
    const result = validateDeckRecipeV1(validDeck())
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.schema).toBe('captivela.deck-recipe/v1')
  })

  it('rejects unknown keys, including raw executable/native payload fields', () => {
    for (const forbidden of ['html', 'css', 'js', 'ooxml', 'script', 'shell', 'path']) {
      expectInvalid(validateDeckRecipeV1({ ...validDeck(), [forbidden]: 'untrusted' }), forbidden)
    }
    expectInvalid(
      validateDeckRecipeV1({ ...validDeck(), slides: [{ ...validSlide(), html: '<h1>x</h1>' }] }),
      'html',
    )
  })

  it('rejects invalid schema discriminators and malformed roles/layouts/blocks', () => {
    expectInvalid(validateDeckRecipeV1({ ...validDeck(), schema: 'captivela.deck-recipe/v2' }), 'schema')
    expect(validateSlideRecipeV1({ ...validSlide(), role: 'agenda-ish' }).ok).toBe(false)
    expect(validateSlideRecipeV1({ ...validSlide(), layout: 'absolute-freeform' }).ok).toBe(false)
    expect(
      validateSlideRecipeV1({ ...validSlide(), blocks: [{ kind: 'iframe', src: 'https://x.test' }] })
        .ok,
    ).toBe(false)
  })

  it('rejects oversized strings and collection counts', () => {
    expectInvalid(validateDeckRecipeV1({ ...validDeck(), title: 'x'.repeat(AI_GENERATION_LIMITS.title + 1) }))
    expectInvalid(
      validateDeckRecipeV1({
        ...validDeck(),
        slides: Array.from({ length: AI_GENERATION_LIMITS.slides + 1 }, (_, index) => ({
          ...validSlide(),
          id: `slide-${index}`,
        })),
      }),
      'slides',
    )
    expect(
      validateSlideRecipeV1({
        ...validSlide(),
        blocks: Array.from({ length: AI_GENERATION_LIMITS.blocksPerSlide + 1 }, () => ({
          kind: 'text',
          role: 'body',
          text: 'x',
        })),
      }).ok,
    ).toBe(false)
    expectInvalid(
      validateDeckRecipeV1({
        ...validDeck(),
        assets: Array.from({ length: AI_GENERATION_LIMITS.assets + 1 }, (_, index) => ({
          id: `asset-${index}`,
          source: `asset_${index}`,
        })),
      }),
      'assets',
    )
  })

  it('rejects NaN/Infinity and invalid #RRGGBB colors', () => {
    expectInvalid(validateDeckRecipeV1({ ...validDeck(), theme: { ...validDeck().theme, accent: '#fff' } }))
    const slide = {
      ...validSlide(),
      blocks: [{ kind: 'metric', label: 'Growth', value: Number.NaN }],
    }
    expect(validateSlideRecipeV1(slide).ok).toBe(false)
    expect(
      validateSlideRecipeV1({
        ...validSlide(),
        blocks: [{ kind: 'chart', chartKind: 'bar', categories: ['A'], series: [{ name: 'S', values: [Infinity] }] }],
      }).ok,
    ).toBe(false)
  })

  it.each([
    'file:///etc/passwd',
    'data:image/png;base64,AAAA',
    'http://example.com/a.png',
    'https://localhost/a.png',
    'https://127.0.0.1/a.png',
    'https://[::1]/a.png',
    'https://10.0.0.1/a.png',
    'https://172.16.0.1/a.png',
    'https://192.168.1.1/a.png',
    'https://169.254.1.1/a.png',
    'https://user:pass@example.com/a.png',
  ])('rejects unsafe asset URL %s', (source) => {
    expectInvalid(validateDeckRecipeV1({ ...validDeck(), assets: [{ id: 'bad', source }] }), 'source')
  })

  it('accepts safe HTTPS URLs and opaque asset IDs', () => {
    expect(validateDeckRecipeV1(validDeck()).ok).toBe(true)
    expect(
      validateDeckRecipeV1({
        ...validDeck(),
        assets: [
          { id: 'remote', source: 'https://images.example.com/a.png?size=large' },
          { id: 'opaque', source: 'asset_01HZXABCDEF' },
        ],
      }).ok,
    ).toBe(true)
  })

  it('accepts bounded semantic generated-image intent', () => {
    const result = validateSlideRecipeV1({
      ...validSlide(),
      blocks: [{
        kind: 'image',
        assetId: 'generated-hero',
        alt: 'Editorial collaboration scene',
        crop: 'cover',
        intent: {
          prompt: 'Editorial photograph of a small team collaborating in a bright studio',
          aspectRatio: '16:9',
          style: 'editorial',
        },
      }],
    })
    expect(result.ok).toBe(true)
  })

  it.each(['url', 'path', 'base64', 'provider', 'model', 'endpoint', 'headers']) (
    'rejects model-controlled generated-image field %s',
    (field) => {
      const result = validateSlideRecipeV1({
        ...validSlide(),
        blocks: [{
          kind: 'image',
          assetId: 'generated-hero',
          alt: 'Generated hero',
          intent: { prompt: 'Safe prompt', aspectRatio: '16:9', [field]: 'untrusted' },
        }],
      })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.errors.some((error) => error.path.includes(field))).toBe(true)
    },
  )

  it('enforces generated-image prompt, enum, and per-slide count bounds', () => {
    const image = (index: number) => ({
      kind: 'image',
      assetId: `generated-${index}`,
      alt: 'Generated visual',
      intent: { prompt: 'Safe prompt', aspectRatio: '16:9' },
    })
    expect(validateSlideRecipeV1({
      ...validSlide(),
      blocks: [{ ...image(1), intent: { prompt: 'x'.repeat(AI_GENERATION_LIMITS.imagePrompt + 1), aspectRatio: '16:9' } }],
    }).ok).toBe(false)
    expect(validateSlideRecipeV1({
      ...validSlide(),
      blocks: [{ ...image(1), intent: { prompt: 'Safe prompt', aspectRatio: '4:3' } }],
    }).ok).toBe(false)
    expect(validateSlideRecipeV1({
      ...validSlide(),
      blocks: Array.from({ length: AI_GENERATION_LIMITS.generatedImagesPerSlide + 1 }, (_, index) => image(index)),
    }).ok).toBe(false)
  })
})

describe('trusted NativeSlideIR validation', () => {
  const validIr = () => ({
    schema: 'captivela.native-slide-ir/v1',
    width: 10_000,
    height: 5_625,
    background: '#FFFFFF',
    elements: [
      {
        kind: 'text',
        id: 'title',
        x: 500,
        y: 400,
        w: 9_000,
        h: 800,
        text: 'Native, deterministic output',
        role: 'title',
        color: '#14213D',
      },
      {
        kind: 'shape',
        id: 'accent',
        x: 500,
        y: 1_400,
        w: 2_000,
        h: 80,
        shape: 'rect',
        fill: '#FCA311',
      },
    ],
  })

  it('accepts bounded integer coordinates and strict native element kinds', () => {
    expect(validateNativeSlideIR(validIr()).ok).toBe(true)
  })

  it.each([
    { x: -1 },
    { x: 10_001 },
    { w: 0 },
    { y: 1.5 },
    { h: Infinity },
  ])('rejects invalid normalized coordinates: %o', (coordinate) => {
    const ir = validIr()
    ir.elements[0] = { ...ir.elements[0], ...coordinate }
    expect(validateNativeSlideIR(ir).ok).toBe(false)
  })

  it('rejects boxes that extend beyond the trusted canvas', () => {
    const ir = validIr()
    ir.elements[0] = { ...ir.elements[0], x: 9_500, w: 1_000 }
    expect(validateNativeSlideIR(ir).ok).toBe(false)
  })

  it('rejects chart series whose value count does not match categories', () => {
    expect(
      validateNativeSlideIR({
        ...validIr(),
        elements: [
          {
            kind: 'chart',
            id: 'chart',
            x: 500,
            y: 500,
            w: 5_000,
            h: 3_000,
            chartKind: 'bar',
            categories: ['A', 'B'],
            series: [{ name: 'Revenue', values: [10] }],
          },
        ],
      }).ok,
    ).toBe(false)
  })

  it('rejects unknown native kinds and filesystem paths', () => {
    expect(
      validateNativeSlideIR({
        ...validIr(),
        elements: [{ kind: 'html', id: 'x', x: 0, y: 0, w: 100, h: 100, html: '<p>x</p>' }],
      }).ok,
    ).toBe(false)
    expect(validateNativeSlideIR({ ...validIr(), path: '/tmp/deck.pptx' }).ok).toBe(false)
  })
})
