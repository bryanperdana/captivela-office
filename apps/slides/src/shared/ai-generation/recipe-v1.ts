export const DECK_RECIPE_V1_SCHEMA = 'captivela.deck-recipe/v1' as const
export const SLIDE_RECIPE_V1_SCHEMA = 'captivela.slide-recipe/v1' as const

export const AI_GENERATION_LIMITS = {
  title: 200,
  body: 4_000,
  shortString: 500,
  id: 128,
  slides: 60,
  blocksPerSlide: 40,
  assets: 120,
  bullets: 30,
  categories: 30,
  series: 12,
  imagePrompt: 2_000,
  generatedImagesPerSlide: 4,
} as const

export const SLIDE_ROLES = ['cover', 'content', 'data', 'comparison', 'process', 'closing'] as const
export type SlideRole = (typeof SLIDE_ROLES)[number]

export const SLIDE_LAYOUTS = [
  'cover_typography_hero',
  'three_column_cards',
  'hero_big_number',
  'comparison',
  'timeline',
  'kpi_cards',
  'content_text_image',
  'closing_cta',
] as const
export type SlideLayout = (typeof SLIDE_LAYOUTS)[number]

export const TEXT_BLOCK_ROLES = ['title', 'subtitle', 'body', 'caption', 'quote', 'source', 'cta'] as const
export type TextBlockRole = (typeof TEXT_BLOCK_ROLES)[number]

export type RecipeAssetSource = string

export interface RecipeAssetV1 {
  id: string
  source: RecipeAssetSource
  alt?: string
}

export interface RecipeThemeV1 {
  background: string
  text: string
  accent: string
  secondaryAccent?: string
  surface?: string
}

export interface TextBlockV1 {
  kind: 'text'
  role: TextBlockRole
  text: string
  emphasis?: 'normal' | 'strong' | 'muted'
}

export interface BulletsBlockV1 {
  kind: 'bullets'
  role: 'body' | 'steps' | 'features'
  items: string[]
}

export const GENERATED_IMAGE_ASPECT_RATIOS = ['1:1', '3:2', '2:3', '16:9', '9:16'] as const
export const GENERATED_IMAGE_STYLES = ['photo', 'illustration', 'editorial', 'diagram-background'] as const

export interface GeneratedImageIntentV1 {
  prompt: string
  aspectRatio: (typeof GENERATED_IMAGE_ASPECT_RATIOS)[number]
  style?: (typeof GENERATED_IMAGE_STYLES)[number]
}

export interface ImageBlockV1 {
  kind: 'image'
  assetId: string
  alt: string
  crop?: 'cover' | 'contain'
  /** Semantic generation intent only. Provider, endpoint, credentials, paths, URLs, and bytes are forbidden. */
  intent?: GeneratedImageIntentV1
}

export interface MetricBlockV1 {
  kind: 'metric'
  label: string
  value: string | number
  detail?: string
}

export interface ChartSeriesV1 {
  name: string
  values: number[]
}

export interface ChartBlockV1 {
  kind: 'chart'
  chartKind: 'bar' | 'line' | 'area' | 'pie' | 'doughnut'
  categories: string[]
  series: ChartSeriesV1[]
  insight?: string
}

export type SlideBlockV1 =
  | TextBlockV1
  | BulletsBlockV1
  | ImageBlockV1
  | MetricBlockV1
  | ChartBlockV1

export interface SlideRecipeV1 {
  schema: typeof SLIDE_RECIPE_V1_SCHEMA
  id: string
  role: SlideRole
  layout: SlideLayout
  title: string
  blocks: SlideBlockV1[]
  speakerNotes?: string
}

/** Untrusted provider output. Validate before it enters any compiler or renderer. */
export interface DeckRecipeV1 {
  schema: typeof DECK_RECIPE_V1_SCHEMA
  title: string
  theme: RecipeThemeV1
  assets: RecipeAssetV1[]
  slides: SlideRecipeV1[]
}

export interface ValidationError {
  path: string
  message: string
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: ValidationError[] }

type ObjectRecord = Record<string, unknown>

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/
const OPAQUE_ID = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/

function isObject(value: unknown): value is ObjectRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function error(errors: ValidationError[], path: string, message: string): void {
  errors.push({ path, message })
}

function objectAt(value: unknown, path: string, errors: ValidationError[]): ObjectRecord | null {
  if (!isObject(value)) {
    error(errors, path, 'must be an object')
    return null
  }
  return value
}

function rejectUnknown(
  value: ObjectRecord,
  allowed: readonly string[],
  path: string,
  errors: ValidationError[],
): void {
  const allowedSet = new Set(allowed)
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) error(errors, `${path}.${key}`, 'unknown key')
  }
}

function stringAt(
  value: unknown,
  path: string,
  errors: ValidationError[],
  max: number,
  options: { min?: number; pattern?: RegExp } = {},
): value is string {
  const min = options.min ?? 1
  if (typeof value !== 'string') {
    error(errors, path, 'must be a string')
    return false
  }
  if (value.length < min || value.length > max) {
    error(errors, path, `length must be ${min}-${max}`)
    return false
  }
  if (options.pattern && !options.pattern.test(value)) {
    error(errors, path, 'has invalid format')
    return false
  }
  return true
}

function enumAt<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
  errors: ValidationError[],
): value is T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    error(errors, path, `must be one of: ${allowed.join(', ')}`)
    return false
  }
  return true
}

function finiteNumberAt(value: unknown, path: string, errors: ValidationError[]): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    error(errors, path, 'must be a finite number')
    return false
  }
  return true
}

function colorAt(value: unknown, path: string, errors: ValidationError[]): value is string {
  return stringAt(value, path, errors, 7, { min: 7, pattern: HEX_COLOR })
}

function arrayAt(
  value: unknown,
  path: string,
  errors: ValidationError[],
  max: number,
  min = 0,
): value is unknown[] {
  if (!Array.isArray(value)) {
    error(errors, path, 'must be an array')
    return false
  }
  if (value.length < min || value.length > max) {
    error(errors, path, `item count must be ${min}-${max}`)
    return false
  }
  return true
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.')
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false
  const octets = parts.map(Number)
  if (octets.some((part) => part > 255)) return true
  const [a, b] = octets as [number, number, number, number]
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  )
}

function isUnsafeIpv6Literal(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (!host.includes(':')) return false
  if (host === '::' || host === '::1') return true
  if (host.startsWith('fc') || host.startsWith('fd')) return true
  if (/^fe[89ab]/.test(host)) return true
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(host)
  return mapped ? isPrivateIpv4(mapped[1]) : false
}

export function isSafeRecipeAssetSource(source: string): boolean {
  if (OPAQUE_ID.test(source)) return true
  let url: URL
  try {
    url = new URL(source)
  } catch {
    return false
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '')
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost')) return false
  if (isPrivateIpv4(hostname) || isUnsafeIpv6Literal(hostname)) return false
  return true
}

function validateAsset(value: unknown, path: string, errors: ValidationError[]): void {
  const asset = objectAt(value, path, errors)
  if (!asset) return
  rejectUnknown(asset, ['id', 'source', 'alt'], path, errors)
  stringAt(asset.id, `${path}.id`, errors, AI_GENERATION_LIMITS.id, { pattern: OPAQUE_ID })
  if (stringAt(asset.source, `${path}.source`, errors, 2_048) && !isSafeRecipeAssetSource(asset.source)) {
    error(errors, `${path}.source`, 'must be an opaque asset ID or safe public HTTPS URL')
  }
  if (asset.alt !== undefined) stringAt(asset.alt, `${path}.alt`, errors, AI_GENERATION_LIMITS.shortString, { min: 0 })
}

function validateTheme(value: unknown, path: string, errors: ValidationError[]): void {
  const theme = objectAt(value, path, errors)
  if (!theme) return
  rejectUnknown(theme, ['background', 'text', 'accent', 'secondaryAccent', 'surface'], path, errors)
  colorAt(theme.background, `${path}.background`, errors)
  colorAt(theme.text, `${path}.text`, errors)
  colorAt(theme.accent, `${path}.accent`, errors)
  if (theme.secondaryAccent !== undefined) colorAt(theme.secondaryAccent, `${path}.secondaryAccent`, errors)
  if (theme.surface !== undefined) colorAt(theme.surface, `${path}.surface`, errors)
}

export function validateRecipeThemeV1(value: unknown): ValidationResult<RecipeThemeV1> {
  const errors: ValidationError[] = []
  validateTheme(value, '$', errors)
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: value as RecipeThemeV1 }
}

function validateStringArray(
  value: unknown,
  path: string,
  errors: ValidationError[],
  maxItems: number,
  maxLength = AI_GENERATION_LIMITS.shortString,
): void {
  if (!arrayAt(value, path, errors, maxItems)) return
  value.forEach((item, index) => stringAt(item, `${path}[${index}]`, errors, maxLength))
}

function validateBlock(value: unknown, path: string, errors: ValidationError[]): void {
  const block = objectAt(value, path, errors)
  if (!block) return
  if (typeof block.kind !== 'string') {
    error(errors, `${path}.kind`, 'must be a supported block kind')
    rejectUnknown(block, ['kind'], path, errors)
    return
  }
  switch (block.kind) {
    case 'text':
      rejectUnknown(block, ['kind', 'role', 'text', 'emphasis'], path, errors)
      enumAt(block.role, TEXT_BLOCK_ROLES, `${path}.role`, errors)
      stringAt(block.text, `${path}.text`, errors, AI_GENERATION_LIMITS.body)
      if (block.emphasis !== undefined)
        enumAt(block.emphasis, ['normal', 'strong', 'muted'], `${path}.emphasis`, errors)
      return
    case 'bullets':
      rejectUnknown(block, ['kind', 'role', 'items'], path, errors)
      enumAt(block.role, ['body', 'steps', 'features'], `${path}.role`, errors)
      validateStringArray(block.items, `${path}.items`, errors, AI_GENERATION_LIMITS.bullets)
      return
    case 'image': {
      rejectUnknown(block, ['kind', 'assetId', 'alt', 'crop', 'intent'], path, errors)
      stringAt(block.assetId, `${path}.assetId`, errors, AI_GENERATION_LIMITS.id, { pattern: OPAQUE_ID })
      stringAt(block.alt, `${path}.alt`, errors, AI_GENERATION_LIMITS.shortString, { min: 0 })
      if (block.crop !== undefined) enumAt(block.crop, ['cover', 'contain'], `${path}.crop`, errors)
      if (block.intent !== undefined) {
        const intent = objectAt(block.intent, `${path}.intent`, errors)
        if (intent) {
          rejectUnknown(intent, ['prompt', 'aspectRatio', 'style'], `${path}.intent`, errors)
          stringAt(intent.prompt, `${path}.intent.prompt`, errors, AI_GENERATION_LIMITS.imagePrompt)
          enumAt(intent.aspectRatio, GENERATED_IMAGE_ASPECT_RATIOS, `${path}.intent.aspectRatio`, errors)
          if (intent.style !== undefined)
            enumAt(intent.style, GENERATED_IMAGE_STYLES, `${path}.intent.style`, errors)
        }
      }
      return
    }
    case 'metric':
      rejectUnknown(block, ['kind', 'label', 'value', 'detail'], path, errors)
      stringAt(block.label, `${path}.label`, errors, AI_GENERATION_LIMITS.shortString)
      if (typeof block.value === 'number') finiteNumberAt(block.value, `${path}.value`, errors)
      else stringAt(block.value, `${path}.value`, errors, AI_GENERATION_LIMITS.shortString)
      if (block.detail !== undefined)
        stringAt(block.detail, `${path}.detail`, errors, AI_GENERATION_LIMITS.shortString)
      return
    case 'chart': {
      rejectUnknown(block, ['kind', 'chartKind', 'categories', 'series', 'insight'], path, errors)
      enumAt(block.chartKind, ['bar', 'line', 'area', 'pie', 'doughnut'], `${path}.chartKind`, errors)
      validateStringArray(block.categories, `${path}.categories`, errors, AI_GENERATION_LIMITS.categories)
      if (arrayAt(block.series, `${path}.series`, errors, AI_GENERATION_LIMITS.series, 1)) {
        block.series.forEach((rawSeries, seriesIndex) => {
          const seriesPath = `${path}.series[${seriesIndex}]`
          const series = objectAt(rawSeries, seriesPath, errors)
          if (!series) return
          rejectUnknown(series, ['name', 'values'], seriesPath, errors)
          stringAt(series.name, `${seriesPath}.name`, errors, AI_GENERATION_LIMITS.shortString)
          if (arrayAt(series.values, `${seriesPath}.values`, errors, AI_GENERATION_LIMITS.categories)) {
            series.values.forEach((number, numberIndex) =>
              finiteNumberAt(number, `${seriesPath}.values[${numberIndex}]`, errors),
            )
          }
        })
      }
      if (block.insight !== undefined)
        stringAt(block.insight, `${path}.insight`, errors, AI_GENERATION_LIMITS.body)
      return
    }
    default:
      error(errors, `${path}.kind`, 'must be one of: text, bullets, image, metric, chart')
      rejectUnknown(block, ['kind'], path, errors)
  }
}

function validateSlideInto(value: unknown, path: string, errors: ValidationError[]): void {
  const slide = objectAt(value, path, errors)
  if (!slide) return
  rejectUnknown(slide, ['schema', 'id', 'role', 'layout', 'title', 'blocks', 'speakerNotes'], path, errors)
  if (slide.schema !== SLIDE_RECIPE_V1_SCHEMA)
    error(errors, `${path}.schema`, `must equal ${SLIDE_RECIPE_V1_SCHEMA}`)
  stringAt(slide.id, `${path}.id`, errors, AI_GENERATION_LIMITS.id, { pattern: OPAQUE_ID })
  enumAt(slide.role, SLIDE_ROLES, `${path}.role`, errors)
  enumAt(slide.layout, SLIDE_LAYOUTS, `${path}.layout`, errors)
  stringAt(slide.title, `${path}.title`, errors, AI_GENERATION_LIMITS.title)
  if (arrayAt(slide.blocks, `${path}.blocks`, errors, AI_GENERATION_LIMITS.blocksPerSlide)) {
    slide.blocks.forEach((block, index) => validateBlock(block, `${path}.blocks[${index}]`, errors))
    const generatedImageCount = slide.blocks.filter((block) =>
      isObject(block) && block.kind === 'image' && block.intent !== undefined,
    ).length
    if (generatedImageCount > AI_GENERATION_LIMITS.generatedImagesPerSlide) {
      error(
        errors,
        `${path}.blocks`,
        `generated image intent count must be 0-${AI_GENERATION_LIMITS.generatedImagesPerSlide}`,
      )
    }
  }
  if (slide.speakerNotes !== undefined)
    stringAt(slide.speakerNotes, `${path}.speakerNotes`, errors, AI_GENERATION_LIMITS.body, { min: 0 })
}

export function validateSlideRecipeV1(value: unknown): ValidationResult<SlideRecipeV1> {
  const errors: ValidationError[] = []
  validateSlideInto(value, '$', errors)
  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, value: value as SlideRecipeV1 }
}

export function validateDeckRecipeV1(value: unknown): ValidationResult<DeckRecipeV1> {
  const errors: ValidationError[] = []
  const deck = objectAt(value, '$', errors)
  if (deck) {
    rejectUnknown(deck, ['schema', 'title', 'theme', 'assets', 'slides'], '$', errors)
    if (deck.schema !== DECK_RECIPE_V1_SCHEMA)
      error(errors, '$.schema', `must equal ${DECK_RECIPE_V1_SCHEMA}`)
    stringAt(deck.title, '$.title', errors, AI_GENERATION_LIMITS.title)
    validateTheme(deck.theme, '$.theme', errors)
    if (arrayAt(deck.assets, '$.assets', errors, AI_GENERATION_LIMITS.assets)) {
      deck.assets.forEach((asset, index) => validateAsset(asset, `$.assets[${index}]`, errors))
    }
    if (arrayAt(deck.slides, '$.slides', errors, AI_GENERATION_LIMITS.slides, 1)) {
      deck.slides.forEach((slide, index) => validateSlideInto(slide, `$.slides[${index}]`, errors))
    }
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: value as DeckRecipeV1 }
}
