import {
  addElement,
  addPicture,
  createBlankPptx,
  openPptx,
  savePptx,
  setSlideBackground,
} from '@genoffice/pptx-engine'
import { validateNativeSlideIR, type NativeImageElementIR, type NativeSlideIR, type NativeTextElementIR } from './native-slide-ir'
import type { ValidationError } from './recipe-v1'

export type ResolvedImageExtension = 'png' | 'jpg' | 'jpeg' | 'gif' | 'bmp' | 'webp' | 'tif' | 'tiff'

export interface TrustedImageResolution {
  bytes: Uint8Array
  ext: ResolvedImageExtension
}

export type TrustedImageResolver = (request: {
  assetId: string
  alt: string
  fit: NativeImageElementIR['fit']
}) => Promise<TrustedImageResolution | null> | TrustedImageResolution | null

export interface NativePptxCompilerOptions {
  /** Trusted host-provided resolver. The compiler never interprets asset IDs or dereferences URLs. */
  resolveImage?: TrustedImageResolver
}

export interface NativePptxCompilerWarning {
  code: 'image-unresolved' | 'image-resolver-failed' | 'image-unsupported' | 'chart-placeholder'
  message: string
  elementId: string
  assetId?: string
}

export interface NativePptxCompileResult {
  bytes: Uint8Array
  warnings: NativePptxCompilerWarning[]
}

export class NativeSlideIrValidationError extends Error {
  readonly errors: ValidationError[]

  constructor(errors: ValidationError[]) {
    super(`Invalid NativeSlideIR: ${errors.map((error) => `${error.path} ${error.message}`).join('; ')}`)
    this.name = 'NativeSlideIrValidationError'
    this.errors = errors
  }
}

const roleStyle: Record<NativeTextElementIR['role'], { fontSize: number; bold?: boolean; italic?: boolean }> = {
  title: { fontSize: 34, bold: true },
  subtitle: { fontSize: 22 },
  body: { fontSize: 18 },
  caption: { fontSize: 13 },
  quote: { fontSize: 25, italic: true },
  source: { fontSize: 10 },
  cta: { fontSize: 22, bold: true },
}

function emuRect(
  element: { x: number; y: number; w: number; h: number },
  ir: NativeSlideIR,
  deckSize: { cx: number; cy: number },
) {
  return {
    x: Math.round((element.x / ir.width) * deckSize.cx),
    y: Math.round((element.y / ir.height) * deckSize.cy),
    cx: Math.round((element.w / ir.width) * deckSize.cx),
    cy: Math.round((element.h / ir.height) * deckSize.cy),
  }
}

function addText(
  slide: Parameters<typeof addElement>[0],
  element: NativeTextElementIR,
  ir: NativeSlideIR,
  deckSize: { cx: number; cy: number },
): void {
  const style = roleStyle[element.role]
  addElement(slide, {
    kind: 'textbox',
    offset: emuRect(element, ir, deckSize),
    paragraphs: [
      {
        ...(element.align ? { align: element.align } : {}),
        runs: [{ text: element.text, color: element.color, fontSize: style.fontSize, ...(style.bold ? { bold: true } : {}), ...(style.italic ? { italic: true } : {}) }],
      },
    ],
  })
}

function addPlaceholder(
  slide: Parameters<typeof addElement>[0],
  element: NativeImageElementIR,
  ir: NativeSlideIR,
  deckSize: { cx: number; cy: number },
): void {
  addElement(slide, {
    kind: 'roundRect',
    offset: emuRect(element, ir, deckSize),
    fillColor: '#E8E8E8',
    stroke: { color: '#A0A0A0', widthEmu: 12_700 },
    paragraphs: [{ align: 'center', runs: [{ text: `Image: ${element.alt || element.assetId}`, color: '#666666', fontSize: 14 }] }],
  })
}

export async function compileNativeSlideIrToPptx(
  irInput: unknown,
  options: NativePptxCompilerOptions = {},
): Promise<NativePptxCompileResult> {
  const validation = validateNativeSlideIR(irInput)
  if (!validation.ok) throw new NativeSlideIrValidationError(validation.errors)
  const ir = validation.value
  const opened = await openPptx(await createBlankPptx())
  const slide = opened.deck.slides[0]!
  const deckSize = opened.deck.size
  const warnings: NativePptxCompilerWarning[] = []
  setSlideBackground(slide, ir.background)

  for (const element of ir.elements) {
    if (element.kind === 'text') {
      addText(slide, element, ir, deckSize)
      continue
    }
    if (element.kind === 'shape') {
      addElement(slide, {
        kind: element.shape,
        offset: emuRect(element, ir, deckSize),
        fillColor: element.fill,
        ...(element.stroke ? { stroke: { color: element.stroke, widthEmu: 12_700 } } : {}),
      })
      continue
    }
    if (element.kind === 'image') {
      if (!options.resolveImage) {
        addPlaceholder(slide, element, ir, deckSize)
        warnings.push({ code: 'image-unresolved', message: 'Image was not resolved; an editable placeholder was emitted.', elementId: element.id, assetId: element.assetId })
        continue
      }
      let resolved: TrustedImageResolution | null
      try {
        resolved = await options.resolveImage({ assetId: element.assetId, alt: element.alt, fit: element.fit })
      } catch (error) {
        addPlaceholder(slide, element, ir, deckSize)
        warnings.push({ code: 'image-resolver-failed', message: `Trusted image resolver failed: ${error instanceof Error ? error.message : 'unknown error'}`, elementId: element.id, assetId: element.assetId })
        continue
      }
      if (!resolved) {
        addPlaceholder(slide, element, ir, deckSize)
        warnings.push({ code: 'image-unresolved', message: 'Trusted image resolver returned no bytes; an editable placeholder was emitted.', elementId: element.id, assetId: element.assetId })
        continue
      }
      const picture = addPicture(opened, slide, {
        bytes: resolved.bytes,
        ext: resolved.ext,
        offset: emuRect(element, ir, deckSize),
        name: `Captivela image ${element.id}`,
        descr: element.alt,
      })
      if (!picture) {
        addPlaceholder(slide, element, ir, deckSize)
        warnings.push({ code: 'image-unsupported', message: `Resolved image extension is unsupported: ${resolved.ext}`, elementId: element.id, assetId: element.assetId })
      }
      continue
    }

    addElement(slide, {
      kind: 'roundRect',
      offset: emuRect(element, ir, deckSize),
      fillColor: '#F2F2F2',
      stroke: { color: '#A0A0A0', widthEmu: 12_700 },
      paragraphs: [{ align: 'center', runs: [{ text: `Chart: ${element.chartKind}`, color: '#666666', fontSize: 14 }] }],
    })
    warnings.push({ code: 'chart-placeholder', message: 'Chart primitive is not compiled in v1; an editable shape placeholder was emitted.', elementId: element.id })
  }

  return { bytes: await savePptx(opened), warnings }
}
