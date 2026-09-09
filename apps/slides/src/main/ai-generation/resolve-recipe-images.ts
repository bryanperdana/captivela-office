import { randomUUID } from 'node:crypto'
import {
  generateImage,
  type ImageGenerationConfig,
  type ImageGenerationProvider,
} from '@genoffice/ai-provider'
import type { SlideRecipeV1 } from '../../shared/ai-generation/recipe-v1'
import type { TrustedImageResolver } from '../../shared/ai-generation/native-pptx-compiler'
import { fetchGeneratedImage } from './generated-image-fetch'
import { ImageAssetStore } from './image-asset-store'
import { normalizeGeneratedImage } from './image-normalizer'
import { decodeGeneratedImageBase64 } from './image-security'

export interface RecipeImageWarning {
  code: 'image-generation-unavailable' | 'image-generation-failed'
  assetId: string
  message: string
}

export interface ResolveRecipeImagesOptions {
  recipe: SlideRecipeV1
  ownerId: number
  deckSessionId: string
  expectedRevision: number
  provider: ImageGenerationProvider
  config: ImageGenerationConfig
  signal?: AbortSignal
  store?: ImageAssetStore
}

export interface ResolvedRecipeImageRun {
  resolveImage: TrustedImageResolver
  warnings: RecipeImageWarning[]
  revoke(): void
}

function sizeForAspect(
  aspect: string,
  fallback: ImageGenerationConfig['size'],
): ImageGenerationConfig['size'] {
  const [w, h] = aspect.split(':').map(Number)
  if (!w || !h || w === h) return w === h ? '1024x1024' : fallback
  return w > h ? '1536x1024' : '1024x1536'
}

function providerPrompt(prompt: string, style: string | undefined, aspect: string): string {
  return [
    prompt,
    style ? `Visual style: ${style}.` : '',
    `Composition aspect ratio: ${aspect}.`,
    'Do not include logos, watermarks, signatures, or readable text unless explicitly requested.',
  ]
    .filter(Boolean)
    .join('\n')
}

function safeFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.slice(0, 400) || 'unknown image-generation failure'
}

/**
 * Resolve semantic image intents entirely in main-process memory. Provider bytes/URLs,
 * credentials, digests, and the run id never cross the renderer boundary.
 */
export async function resolveRecipeImages(
  options: ResolveRecipeImagesOptions,
): Promise<ResolvedRecipeImageRun> {
  const runId = `run_${randomUUID()}`
  const store = options.store ?? new ImageAssetStore()
  const warnings: RecipeImageWarning[] = []
  const handles = new Map<string, { assetId: string; digest: string; ext: 'png' | 'jpg' }>()
  const binding = {
    ownerId: options.ownerId,
    deckSessionId: options.deckSessionId,
    expectedRevision: options.expectedRevision,
    runId,
  }

  for (const block of options.recipe.blocks) {
    if (block.kind !== 'image' || !block.intent) continue
    if (options.signal?.aborted) {
      warnings.push({
        code: 'image-generation-unavailable',
        assetId: block.assetId,
        message: 'Image generation was cancelled; an editable placeholder was emitted.',
      })
      continue
    }
    try {
      const payload = await generateImage(
        options.provider,
        { ...options.config, size: sizeForAspect(block.intent.aspectRatio, options.config.size) },
        {
          prompt: providerPrompt(block.intent.prompt, block.intent.style, block.intent.aspectRatio),
          count: 1,
        },
        { ...(options.signal ? { signal: options.signal } : {}) },
      )
      const source =
        payload.kind === 'base64'
          ? {
              bytes: decodeGeneratedImageBase64(payload.data),
              declaredContentType: null,
            }
          : await fetchGeneratedImage(payload.url, {
              ...(options.signal ? { signal: options.signal } : {}),
            })
      const normalized = normalizeGeneratedImage(source.bytes, {
        declaredContentType: source.declaredContentType,
      })
      const handle = store.put({
        ...binding,
        assetId: block.assetId,
        bytes: normalized.bytes,
        ext: normalized.ext,
      })
      handles.set(block.assetId, handle)
    } catch (error) {
      warnings.push({
        code: 'image-generation-failed',
        assetId: block.assetId,
        message: `${safeFailure(error)}; an editable placeholder was emitted.`,
      })
    }
  }

  return {
    warnings,
    resolveImage: ({ assetId }) => {
      const handle = handles.get(assetId)
      if (!handle) return null
      return store.get({ ...binding, ...handle })
    },
    revoke: () => store.revokeRun(binding.ownerId, binding.deckSessionId, binding.runId),
  }
}
