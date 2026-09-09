/** Skill-layer behavior of the regenerate_slide (redo one page in place) and delete_slide tools. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createSlidesSkill, type DeckAccess } from '../src/renderer/ai/slides-skill'
import type { RenderSlide } from '@genoffice/pptx-render'
import type { AgentToolCall } from '../src/shared/ipc'

const page = { widthPx: 1280, heightPx: 720, nodes: [] } as unknown as RenderSlide

function mkAccess(
  slides: RenderSlide[],
  overrides: Partial<DeckAccess> = {},
): DeckAccess & { applyDeck: ReturnType<typeof vi.fn> } {
  const applyDeck = vi.fn()
  return {
    getSlides: () => slides,
    getCurrent: () => 0,
    getSelectedIds: () => [],
    applySlide: () => {},
    applyDeck,
    fitWidthPx: 1280,
    ...overrides,
  } as unknown as DeckAccess & { applyDeck: ReturnType<typeof vi.fn> }
}

const call = (name: string, input: Record<string, unknown>): AgentToolCall => ({
  id: 't',
  name,
  input,
})

beforeEach(() => {
  ;(window as any).slidesApi = { deleteSlide: vi.fn(async () => [page, page]) }
})

const generatorOk = () =>
  vi.fn(async () => ({
    ok: true,
    artifact: { schema: 'captivela.page-generation-artifact/v1' as const, artifactId: 'artifact-page-2', digest: 'b'.repeat(64) },
  }))

describe('regenerate_slide', () => {
  it('brief → configured generator returns an opaque artifact → calls access.applyRegeneratedPage to land it', async () => {
    const applyRegeneratedPage = vi.fn(async () => ({ ok: true }))
    const generatePageArtifact = generatorOk()
    const skill = createSlidesSkill(
      mkAccess([page, page], { applyRegeneratedPage, generatePageArtifact, retryBackoffMs: 0 }),
    )
    const r = await skill.executeTool!(
      call('regenerate_slide', {
        slideIndex: 1,
        brief: 'Redo as three-column cards, keep the title "NEW"',
      }),
    )
    expect(r.isError).toBeUndefined()
    expect(r.mutated).toBe(true)
    expect(generatePageArtifact).toHaveBeenCalledOnce()
    expect(applyRegeneratedPage).toHaveBeenCalledWith(1, { schema: 'captivela.page-generation-artifact/v1', artifactId: 'artifact-page-2', digest: 'b'.repeat(64) })
    expect(r.output).toContain('page 2')
    expect(r.output).toContain('AI slide generation')
    expect(r.output).not.toMatch(/cloud|gsk|sign in/i)
  })

  it('slideIndex out of range → errors without invoking the pipeline', async () => {
    const applyRegeneratedPage = vi.fn(async () => ({ ok: true }))
    const skill = createSlidesSkill(
      mkAccess([page], { applyRegeneratedPage, generatePageArtifact: generatorOk(), retryBackoffMs: 0 }),
    )
    const r = await skill.executeTool!(call('regenerate_slide', { slideIndex: 3, brief: 'x' }))
    expect(r.isError).toBe(true)
    expect(applyRegeneratedPage).not.toHaveBeenCalled()
  })

  it('empty brief → errors', async () => {
    const skill = createSlidesSkill(
      mkAccess([page], {
        applyRegeneratedPage: vi.fn(async () => ({ ok: true })),
        generatePageArtifact: generatorOk(),
        retryBackoffMs: 0,
      }),
    )
    const r = await skill.executeTool!(call('regenerate_slide', { slideIndex: 0, brief: '' }))
    expect(r.isError).toBe(true)
  })

  it('configured page generation fails (after 1 retry) → provider-neutral error passed through', async () => {
    const generatePageArtifact = vi.fn(async () => ({ ok: false, error: 'generator timeout' }))
    const skill = createSlidesSkill(
      mkAccess([page], {
        applyRegeneratedPage: vi.fn(async () => ({ ok: true })),
        generatePageArtifact,
        retryBackoffMs: 0,
      }),
    )
    const r = await skill.executeTool!(call('regenerate_slide', { slideIndex: 0, brief: 'x' }))
    expect(r.isError).toBe(true)
    expect(r.output).toContain('generator timeout')
    expect(r.output).not.toMatch(/cloud|gsk|sign in/i)
    expect(generatePageArtifact).toHaveBeenCalledTimes(2)
  })

  it('landing fails → error passed through with a retry hint', async () => {
    const skill = createSlidesSkill(
      mkAccess([page], {
        applyRegeneratedPage: vi.fn(async () => ({ ok: false, error: 'conversion timeout' })),
        generatePageArtifact: generatorOk(),
        retryBackoffMs: 0,
      }),
    )
    const r = await skill.executeTool!(call('regenerate_slide', { slideIndex: 0, brief: 'x' }))
    expect(r.isError).toBe(true)
    expect(r.output).toContain('conversion timeout')
  })

  it('validatedGenerationCompleted=true after success (native tools no longer blocked by the anti-handcrafting gate)', async () => {
    const skill = createSlidesSkill(
      mkAccess([page], {
        applyRegeneratedPage: vi.fn(async () => ({ ok: true })),
        generatePageArtifact: generatorOk(),
        retryBackoffMs: 0,
      }),
    )
    await skill.executeTool!(call('regenerate_slide', { slideIndex: 0, brief: 'x' }))
    ;(window as any).slidesApi.addElement = vi.fn(async () => ({ slide: page, sourceId: 'e1' }))
    const r = await skill.executeTool!(
      call('add_text_box', {
        slideIndex: 0,
        x: 1,
        y: 1,
        w: 10,
        h: 10,
        paragraphs: [{ text: 'x' }],
      }),
    )
    expect(r.isError).toBeUndefined()
  })
})

describe('delete_slide', () => {
  it('deletes the given slide and writes back via applyDeck', async () => {
    const access = mkAccess([page, page, page])
    const r = await createSlidesSkill(access).executeTool!(call('delete_slide', { slideIndex: 2 }))
    expect(r.isError).toBeUndefined()
    expect(r.mutated).toBe(true)
    expect((window as any).slidesApi.deleteSlide).toHaveBeenCalledWith(2)
    expect(access.applyDeck).toHaveBeenCalledOnce()
    expect(r.output).toContain('has 2 pages')
  })

  it('only one slide left → refused', async () => {
    const r = await createSlidesSkill(mkAccess([page])).executeTool!(
      call('delete_slide', { slideIndex: 0 }),
    )
    expect(r.isError).toBe(true)
    expect((window as any).slidesApi.deleteSlide).not.toHaveBeenCalled()
  })

  it('out of range → errors', async () => {
    const r = await createSlidesSkill(mkAccess([page, page])).executeTool!(
      call('delete_slide', { slideIndex: 5 }),
    )
    expect(r.isError).toBe(true)
  })
})
