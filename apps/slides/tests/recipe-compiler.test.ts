import { openPptx } from '@genoffice/pptx-engine'
import { describe, expect, it, vi } from 'vitest'
import { validateNativeSlideIR } from '../src/shared/ai-generation/native-slide-ir'
import {
  CURATED_RECIPE_LAYOUTS_V1,
  compileSlideRecipeV1,
} from '../src/shared/ai-generation/recipe-compiler'
import { compileNativeSlideIrToPptx } from '../src/shared/ai-generation/native-pptx-compiler'

const theme = {
  background: '#FFF8F0',
  text: '#17223B',
  accent: '#F26B38',
  secondaryAccent: '#2E86AB',
  surface: '#FFFFFF',
}

const recipe = (layout: (typeof CURATED_RECIPE_LAYOUTS_V1)[number], blocks: unknown[] = []) => ({
  schema: 'captivela.slide-recipe/v1',
  id: 'slide-one',
  role: layout === 'closing_cta' ? 'closing' : layout === 'cover_typography_hero' ? 'cover' : 'content',
  layout,
  title: 'Deterministic native slides',
  blocks,
})

function textFromSlide(slide: Awaited<ReturnType<typeof openPptx>>['deck']['slides'][number]): string {
  return slide.elements
    .flatMap((element) => (element.type === 'text' || element.type === 'shape' ? element.text?.paragraphs ?? [] : []))
    .flatMap((paragraph) => paragraph.runs)
    .map((run) => run.text)
    .join('\n')
}

describe('SlideRecipeV1 deterministic local compiler', () => {
  it('exposes the planner vocabulary as the curated v1 layout set', () => {
    expect(CURATED_RECIPE_LAYOUTS_V1).toEqual([
      'cover_typography_hero',
      'three_column_cards',
      'hero_big_number',
      'comparison',
      'timeline',
      'kpi_cards',
      'content_text_image',
      'closing_cta',
    ])
  })

  it.each(CURATED_RECIPE_LAYOUTS_V1)('compiles %s to valid deterministic NativeSlideIR', (layout) => {
    const blocks = [
      { kind: 'text', role: 'subtitle', text: 'Semantic content compiled locally' },
      { kind: 'text', role: 'body', text: 'Every object remains editable after export.' },
      { kind: 'metric', label: 'Editable objects', value: '100%', detail: 'No flattened slide image' },
      { kind: 'metric', label: 'Network fetches', value: 0 },
      { kind: 'bullets', role: 'features', items: ['Deterministic geometry', 'Strict validation'] },
      { kind: 'image', assetId: 'hero-art', alt: 'Abstract orange geometry', crop: 'contain' },
    ]
    const first = compileSlideRecipeV1(recipe(layout, blocks), theme)
    const second = compileSlideRecipeV1(recipe(layout, blocks), theme)

    expect(first.ok).toBe(true)
    expect(second).toEqual(first)
    if (!first.ok) return
    expect(first.layoutId).toBe(`recipe-v1:${layout}`)
    expect(validateNativeSlideIR(first.value)).toEqual({ ok: true, value: first.value })
    expect(first.value.width).toBe(10_000)
    expect(first.value.height).toBe(5_625)
    expect(first.value.elements[0]?.id).toContain(layout)
    expect(first.value.elements.every((element) => Number.isInteger(element.x))).toBe(true)
  })

  it('rejects unknown and malformed recipes/themes instead of guessing', () => {
    const unknown = compileSlideRecipeV1({ ...recipe('timeline'), layout: 'absolute_freeform' }, theme)
    const malformed = compileSlideRecipeV1({ ...recipe('timeline'), blocks: [{ kind: 'iframe' }] }, theme)
    const badTheme = compileSlideRecipeV1(recipe('timeline'), { ...theme, accent: 'orange' })

    expect(unknown.ok).toBe(false)
    expect(malformed.ok).toBe(false)
    expect(badTheme.ok).toBe(false)
    if (!unknown.ok) expect(unknown.errors.some((error) => error.path === '$.layout')).toBe(true)
  })

  it('returns structured content-audit warnings for placeholder copy and near-empty slides', () => {
    const result = compileSlideRecipeV1(
      recipe('three_column_cards', [{ kind: 'text', role: 'body', text: 'TODO: add lorem ipsum XX% here' }]),
      theme,
    )
    const nearEmpty = compileSlideRecipeV1({ ...recipe('closing_cta'), title: 'Thanks' }, theme)

    expect(result.ok).toBe(true)
    expect(nearEmpty.ok).toBe(true)
    if (result.ok) expect(result.warnings.map((warning) => warning.code)).toContain('placeholder-copy')
    if (nearEmpty.ok) expect(nearEmpty.warnings.map((warning) => warning.code)).toContain('near-empty-slide')
  })
})

describe('NativeSlideIR editable PPTX compiler', () => {
  it('saves and reopens one editable native slide with text, geometry, and background preserved', async () => {
    const compiled = compileSlideRecipeV1(
      recipe('content_text_image', [
        { kind: 'text', role: 'body', text: 'Preserved body copy' },
        { kind: 'image', assetId: 'remote-hero', alt: 'A hero visual' },
      ]),
      theme,
    )
    expect(compiled.ok).toBe(true)
    if (!compiled.ok) return

    const exported = await compileNativeSlideIrToPptx(compiled.value)
    const reopened = await openPptx(exported.bytes)
    const slide = reopened.deck.slides[0]!

    expect(reopened.deck.slides).toHaveLength(1)
    expect(slide.background).toEqual({ type: 'solid', color: theme.background })
    expect(textFromSlide(slide)).toContain('Deterministic native slides')
    expect(textFromSlide(slide)).toContain('Preserved body copy')
    expect(slide.elements.some((element) => element.type === 'text')).toBe(true)
    expect(slide.elements.some((element) => element.type === 'shape')).toBe(true)
    expect(slide.elements.some((element) => element.type === 'picture')).toBe(false)
    expect(exported.warnings).toContainEqual(
      expect.objectContaining({ code: 'image-unresolved', elementId: expect.any(String) }),
    )

    const titleIr = compiled.value.elements.find((element) => element.kind === 'text' && element.role === 'title')!
    const titlePptx = slide.elements.find((element) => element.type === 'text')!
    expect(titlePptx.transform.offset.x).toBe(Math.round((titleIr.x / compiled.value.width) * reopened.deck.size.cx))
    expect(titlePptx.transform.offset.y).toBe(Math.round((titleIr.y / compiled.value.height) * reopened.deck.size.cy))
  })

  it('only embeds image bytes supplied by an explicit trusted resolver', async () => {
    const compiled = compileSlideRecipeV1(
      recipe('content_text_image', [{ kind: 'image', assetId: 'trusted-hero', alt: 'Trusted hero' }]),
      theme,
    )
    expect(compiled.ok).toBe(true)
    if (!compiled.ok) return

    const resolver = vi.fn(async ({ assetId }: { assetId: string }) => {
      expect(assetId).toBe('trusted-hero')
      return {
        ext: 'png' as const,
        bytes: Uint8Array.from(
          Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZC+8AAAAASUVORK5CYII=',
            'base64',
          ),
        ),
      }
    })
    const exported = await compileNativeSlideIrToPptx(compiled.value, { resolveImage: resolver })
    const reopened = await openPptx(exported.bytes)

    expect(resolver).toHaveBeenCalledTimes(1)
    expect(exported.warnings.some((warning) => warning.code === 'image-unresolved')).toBe(false)
    expect(reopened.deck.slides[0]!.elements.some((element) => element.type === 'picture')).toBe(true)
  })

  it('rejects malformed NativeSlideIR before creating a presentation', async () => {
    await expect(
      compileNativeSlideIrToPptx({
        schema: 'captivela.native-slide-ir/v1',
        width: 10_000,
        height: 5_625,
        background: '#FFFFFF',
        elements: [{ kind: 'html', html: '<h1>not allowed</h1>' }],
      }),
    ).rejects.toMatchObject({ name: 'NativeSlideIrValidationError' })
  })
})
