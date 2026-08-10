import {
  NATIVE_SLIDE_IR_SCHEMA,
  validateNativeSlideIR,
  type NativeBoxIR,
  type NativeSlideElementIR,
  type NativeSlideIR,
  type NativeTextElementIR,
} from './native-slide-ir'
import {
  SLIDE_LAYOUTS,
  validateRecipeThemeV1,
  validateSlideRecipeV1,
  type RecipeThemeV1,
  type SlideBlockV1,
  type SlideLayout,
  type SlideRecipeV1,
  type ValidationError,
} from './recipe-v1'

export const CURATED_RECIPE_LAYOUTS_V1 = SLIDE_LAYOUTS

const WIDTH = 10_000
const HEIGHT = 5_625

type ContentWarningCode = 'placeholder-copy' | 'near-empty-slide' | 'layout-content-overflow'

export interface RecipeCompilerWarning {
  code: ContentWarningCode
  message: string
  path: string
}

export type CompileSlideRecipeResult =
  | {
      ok: true
      value: NativeSlideIR
      layoutId: `recipe-v1:${SlideLayout}`
      warnings: RecipeCompilerWarning[]
    }
  | { ok: false; errors: ValidationError[] }

interface LayoutPlan {
  title: NativeBoxIR
  slots: NativeBoxIR[]
  titleAlign?: NativeTextElementIR['align']
  titleSize: 'hero' | 'title'
}

const box = (id: string, x: number, y: number, w: number, h: number): NativeBoxIR => ({ id, x, y, w, h })

const LAYOUTS: Record<SlideLayout, LayoutPlan> = {
  cover_typography_hero: {
    title: box('title', 700, 850, 8_600, 1_650),
    slots: [box('content', 700, 2_850, 8_600, 1_750)],
    titleAlign: 'center',
    titleSize: 'hero',
  },
  three_column_cards: {
    title: box('title', 550, 350, 8_900, 700),
    slots: [box('card-1', 550, 1_400, 2_800, 3_500), box('card-2', 3_600, 1_400, 2_800, 3_500), box('card-3', 6_650, 1_400, 2_800, 3_500)],
    titleSize: 'title',
  },
  hero_big_number: {
    title: box('title', 550, 350, 8_900, 700),
    slots: [box('hero-number', 550, 1_350, 5_500, 3_600), box('insight', 6_400, 1_350, 3_050, 3_600)],
    titleSize: 'title',
  },
  comparison: {
    title: box('title', 550, 350, 8_900, 700),
    slots: [box('left', 550, 1_350, 4_275, 3_700), box('right', 5_175, 1_350, 4_275, 3_700)],
    titleSize: 'title',
  },
  timeline: {
    title: box('title', 550, 350, 8_900, 700),
    slots: [box('step-1', 550, 1_700, 2_050, 2_800), box('step-2', 2_850, 1_700, 2_050, 2_800), box('step-3', 5_150, 1_700, 2_050, 2_800), box('step-4', 7_450, 1_700, 2_000, 2_800)],
    titleSize: 'title',
  },
  kpi_cards: {
    title: box('title', 550, 350, 8_900, 700),
    slots: [box('kpi-1', 550, 1_500, 2_050, 3_100), box('kpi-2', 2_850, 1_500, 2_050, 3_100), box('kpi-3', 5_150, 1_500, 2_050, 3_100), box('kpi-4', 7_450, 1_500, 2_000, 3_100)],
    titleSize: 'title',
  },
  content_text_image: {
    title: box('title', 550, 350, 8_900, 700),
    slots: [box('text', 550, 1_350, 4_250, 3_700), box('image', 5_200, 1_350, 4_250, 3_700)],
    titleSize: 'title',
  },
  closing_cta: {
    title: box('title', 1_000, 1_150, 8_000, 1_300),
    slots: [box('cta', 1_750, 2_750, 6_500, 1_500)],
    titleAlign: 'center',
    titleSize: 'hero',
  },
}

const PLACEHOLDER_COPY = /\b(?:todo|tbd|lorem ipsum|placeholder|insert (?:text|copy)|xx+%|\[.+?\])\b/i

function auditRecipe(recipe: SlideRecipeV1, slotCount: number): RecipeCompilerWarning[] {
  const warnings: RecipeCompilerWarning[] = []
  const strings = [recipe.title]
  recipe.blocks.forEach((block) => {
    if (block.kind === 'text') strings.push(block.text)
    else if (block.kind === 'bullets') strings.push(...block.items)
    else if (block.kind === 'metric') strings.push(block.label, String(block.value), block.detail ?? '')
    else if (block.kind === 'chart') strings.push(block.insight ?? '', ...block.categories, ...block.series.map((series) => series.name))
    else strings.push(block.alt)
  })
  strings.forEach((text, index) => {
    if (PLACEHOLDER_COPY.test(text)) {
      warnings.push({ code: 'placeholder-copy', message: 'Placeholder-like copy should be replaced before publishing.', path: index === 0 ? '$.title' : '$.blocks' })
    }
  })
  const meaningfulLength = strings.join(' ').replace(/\s+/g, ' ').trim().length
  if (recipe.blocks.length === 0 || meaningfulLength < 24) {
    warnings.push({ code: 'near-empty-slide', message: 'Slide has too little content for a useful presentation page.', path: '$.blocks' })
  }
  if (recipe.blocks.length > slotCount) {
    warnings.push({ code: 'layout-content-overflow', message: 'Content exceeds the layout slot count and will share regions.', path: '$.blocks' })
  }
  return warnings
}

type NativeElementWithoutId = NativeSlideElementIR extends infer Element
  ? Element extends NativeSlideElementIR
    ? Omit<Element, 'id'>
    : never
  : never

function withId(layout: SlideLayout, suffix: string, spec: NativeElementWithoutId): NativeSlideElementIR {
  return { ...spec, id: `${layout}_${suffix}` } as NativeSlideElementIR
}

function inset(slot: NativeBoxIR, amount = 180): Omit<NativeBoxIR, 'id'> {
  return { x: slot.x + amount, y: slot.y + amount, w: slot.w - amount * 2, h: slot.h - amount * 2 }
}

function blockElements(
  block: SlideBlockV1,
  slot: NativeBoxIR,
  layout: SlideLayout,
  index: number,
  theme: RecipeThemeV1,
): NativeSlideElementIR[] {
  const id = `block_${index + 1}`
  const content = inset(slot)
  const surface = theme.surface ?? '#FFFFFF'
  const result: NativeSlideElementIR[] = []

  if (block.kind !== 'image' && block.kind !== 'chart') {
    result.push(withId(layout, `${id}_surface`, { kind: 'shape', ...slot, shape: 'roundRect', fill: surface }))
  }
  if (block.kind === 'text') {
    result.push(withId(layout, `${id}_text`, { kind: 'text', ...content, text: block.text, role: block.role, color: block.emphasis === 'muted' ? (theme.secondaryAccent ?? theme.text) : theme.text }))
  } else if (block.kind === 'bullets') {
    if (block.items.length > 0) result.push(withId(layout, `${id}_bullets`, { kind: 'text', ...content, text: block.items.map((item) => `• ${item}`).join('\n'), role: 'body', color: theme.text }))
  } else if (block.kind === 'metric') {
    const valueHeight = Math.max(500, Math.round(content.h * 0.48))
    result.push(withId(layout, `${id}_value`, { kind: 'text', x: content.x, y: content.y, w: content.w, h: valueHeight, text: String(block.value), role: 'title', color: theme.accent, align: 'center' }))
    const label = [block.label, block.detail].filter(Boolean).join('\n')
    result.push(withId(layout, `${id}_label`, { kind: 'text', x: content.x, y: content.y + valueHeight, w: content.w, h: content.h - valueHeight, text: label, role: 'caption', color: theme.text, align: 'center' }))
  } else if (block.kind === 'image') {
    result.push(withId(layout, `${id}_image`, { kind: 'image', ...slot, assetId: block.assetId, alt: block.alt, fit: block.crop ?? 'cover' }))
  } else {
    result.push(withId(layout, `${id}_chart`, { kind: 'chart', ...slot, chartKind: block.chartKind, categories: [...block.categories], series: block.series.map((series) => ({ name: series.name, values: [...series.values] })) }))
    if (block.insight) result.push(withId(layout, `${id}_insight`, { kind: 'text', x: slot.x + 180, y: slot.y + slot.h - 700, w: slot.w - 360, h: 520, text: block.insight, role: 'caption', color: theme.text }))
  }
  return result
}

export function compileSlideRecipeV1(recipeInput: unknown, themeInput: unknown): CompileSlideRecipeResult {
  const recipeResult = validateSlideRecipeV1(recipeInput)
  const themeResult = validateRecipeThemeV1(themeInput)
  if (!recipeResult.ok || !themeResult.ok) {
    return { ok: false, errors: [...(!recipeResult.ok ? recipeResult.errors : []), ...(!themeResult.ok ? themeResult.errors.map((error) => ({ ...error, path: `$theme${error.path.slice(1)}` })) : [])] }
  }

  const recipe = recipeResult.value
  const theme = themeResult.value
  const plan = LAYOUTS[recipe.layout]
  const elements: NativeSlideElementIR[] = [
    withId(recipe.layout, 'accent', { kind: 'shape', x: plan.title.x, y: plan.title.y + plan.title.h + 80, w: Math.min(1_600, plan.title.w), h: 50, shape: 'rect', fill: theme.accent }),
    withId(recipe.layout, 'title', { kind: 'text', x: plan.title.x, y: plan.title.y, w: plan.title.w, h: plan.title.h, text: recipe.title, role: 'title', color: theme.text, ...(plan.titleAlign ? { align: plan.titleAlign } : {}) }),
  ]
  recipe.blocks.forEach((block, index) => {
    const slot = plan.slots[index % plan.slots.length]!
    elements.push(...blockElements(block, slot, recipe.layout, index, theme))
  })

  const value: NativeSlideIR = { schema: NATIVE_SLIDE_IR_SCHEMA, width: WIDTH, height: HEIGHT, background: theme.background, elements }
  const irResult = validateNativeSlideIR(value)
  if (!irResult.ok) return { ok: false, errors: irResult.errors.map((error) => ({ ...error, path: `$compiled${error.path.slice(1)}` })) }
  return { ok: true, value: irResult.value, layoutId: `recipe-v1:${recipe.layout}`, warnings: auditRecipe(recipe, plan.slots.length) }
}
