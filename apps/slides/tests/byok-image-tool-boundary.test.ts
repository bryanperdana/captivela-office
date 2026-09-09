import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const slidesRoot = process.cwd().endsWith(join('apps', 'slides'))
  ? process.cwd()
  : join(process.cwd(), 'apps', 'slides')
const source = (relativePath: string) => readFileSync(join(slidesRoot, relativePath), 'utf8')
const skillSource = source('src/renderer/ai/slides-skill.ts')
const ipcSource = source('src/main/ai-ipc.ts')
const slidesMainSource = source('src/main/slides-main.ts')
const preloadSource = source('src/preload/index.ts')
const sharedIpcSource = source('src/shared/ipc.ts')

describe('BYOK generated-image tool boundary', () => {
  it('requires target geometry and does not expose provider/model/reference overrides', () => {
    const toolStart = skillSource.indexOf("name: 'generate_image'")
    const toolEnd = skillSource.indexOf("name: 'analyze_media'", toolStart)
    const contract = skillSource.slice(toolStart, toolEnd)

    expect(contract).toContain("required: ['prompt', 'slideIndex', 'x', 'y', 'w', 'h']")
    expect(contract).not.toContain('referenceImageUrls')
    expect(contract).not.toContain("model: {")
    expect(contract).not.toContain('returns an image URL')
  })

  it('keeps page image generation cancellable through an owner-scoped opaque request id', () => {
    expect(slidesMainSource).toContain("'slides:cancel-page-recipe'")
    expect(slidesMainSource).toContain('pageRecipeKey(e.sender.id, requestId)')
    expect(slidesMainSource).toContain('signal: controller.signal')
    expect(preloadSource).toContain("ipcRenderer.invoke('slides:cancel-page-recipe', requestId)")
  })

  it('inserts in main and never returns a provider URL or image bytes through IPC', () => {
    const handlerStart = ipcSource.indexOf("'ai:generate-image'")
    const handlerEnd = ipcSource.indexOf("'ai:analyze-media'", handlerStart)
    const handler = ipcSource.slice(handlerStart, handlerEnd)

    expect(handler).toContain('addPicture(')
    expect(handler).toContain('normalizeGeneratedImage(')
    expect(handler).toContain('sessionGenerationId(current)')
    expect(handler).not.toContain('return { url:')

    for (const boundary of [preloadSource, sharedIpcSource]) {
      const start = boundary.indexOf('generateImage:')
      const end = boundary.indexOf('analyzeMedia:', start)
      const contract = boundary.slice(start, end)
      expect(contract).not.toContain('url?: string')
      expect(contract).not.toContain('bytes')
      expect(contract).not.toContain('referenceImageUrls')
    }
  })
})
