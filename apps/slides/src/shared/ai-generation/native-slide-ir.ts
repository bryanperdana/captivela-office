import type { ValidationError, ValidationResult } from './recipe-v1'

export const NATIVE_SLIDE_IR_SCHEMA = 'captivela.native-slide-ir/v1' as const
export const NATIVE_SLIDE_COORD_MAX = 10_000
export const NATIVE_SLIDE_ELEMENT_MAX = 200

export interface NativeBoxIR {
  id: string
  x: number
  y: number
  w: number
  h: number
}

export interface NativeTextElementIR extends NativeBoxIR {
  kind: 'text'
  text: string
  role: 'title' | 'subtitle' | 'body' | 'caption' | 'quote' | 'source' | 'cta'
  color: string
  align?: 'left' | 'center' | 'right'
}

export interface NativeImageElementIR extends NativeBoxIR {
  kind: 'image'
  assetId: string
  alt: string
  fit: 'cover' | 'contain'
}

export interface NativeShapeElementIR extends NativeBoxIR {
  kind: 'shape'
  shape: 'rect' | 'roundRect' | 'ellipse' | 'line'
  fill: string
  stroke?: string
}

export interface NativeChartSeriesIR {
  name: string
  values: number[]
}

export interface NativeChartElementIR extends NativeBoxIR {
  kind: 'chart'
  chartKind: 'bar' | 'line' | 'area' | 'pie' | 'doughnut'
  categories: string[]
  series: NativeChartSeriesIR[]
}

export type NativeSlideElementIR =
  | NativeTextElementIR
  | NativeImageElementIR
  | NativeShapeElementIR
  | NativeChartElementIR

/** Trusted compiler output. This is intentionally separate from untrusted model recipes. */
export interface NativeSlideIR {
  schema: typeof NATIVE_SLIDE_IR_SCHEMA
  width: number
  height: number
  background: string
  elements: NativeSlideElementIR[]
}

type RecordValue = Record<string, unknown>
const HEX = /^#[0-9A-Fa-f]{6}$/
const ID = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/

function isObject(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function add(errors: ValidationError[], path: string, message: string): void {
  errors.push({ path, message })
}

function rejectUnknown(
  value: RecordValue,
  keys: readonly string[],
  path: string,
  errors: ValidationError[],
): void {
  const allowed = new Set(keys)
  Object.keys(value).forEach((key) => {
    if (!allowed.has(key)) add(errors, `${path}.${key}`, 'unknown key')
  })
}

function stringField(
  value: unknown,
  path: string,
  errors: ValidationError[],
  max: number,
  pattern?: RegExp,
  allowEmpty = false,
): value is string {
  if (
    typeof value !== 'string' ||
    (!allowEmpty && value.length === 0) ||
    value.length > max ||
    (pattern !== undefined && !pattern.test(value))
  ) {
    add(errors, path, 'invalid string')
    return false
  }
  return true
}

function enumField<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
  errors: ValidationError[],
): value is T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    add(errors, path, `must be one of: ${allowed.join(', ')}`)
    return false
  }
  return true
}

function integerField(
  value: unknown,
  path: string,
  errors: ValidationError[],
  min: number,
  max: number,
): value is number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    add(errors, path, `must be an integer in ${min}-${max}`)
    return false
  }
  return true
}

function finiteField(value: unknown, path: string, errors: ValidationError[]): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    add(errors, path, 'must be a finite number')
    return false
  }
  return true
}

function colorField(value: unknown, path: string, errors: ValidationError[]): value is string {
  return stringField(value, path, errors, 7, HEX)
}

function baseElement(
  element: RecordValue,
  path: string,
  errors: ValidationError[],
): void {
  stringField(element.id, `${path}.id`, errors, 128, ID)
  integerField(element.x, `${path}.x`, errors, 0, NATIVE_SLIDE_COORD_MAX)
  integerField(element.y, `${path}.y`, errors, 0, NATIVE_SLIDE_COORD_MAX)
  integerField(element.w, `${path}.w`, errors, 1, NATIVE_SLIDE_COORD_MAX)
  integerField(element.h, `${path}.h`, errors, 1, NATIVE_SLIDE_COORD_MAX)
}

function validateElement(
  value: unknown,
  path: string,
  errors: ValidationError[],
  canvasWidth: number | null,
  canvasHeight: number | null,
): void {
  if (!isObject(value)) {
    add(errors, path, 'must be an object')
    return
  }
  if (typeof value.kind !== 'string') {
    add(errors, `${path}.kind`, 'must be a native element kind')
    rejectUnknown(value, ['kind'], path, errors)
    return
  }
  if (
    canvasWidth !== null &&
    canvasHeight !== null &&
    Number.isInteger(value.x) &&
    Number.isInteger(value.y) &&
    Number.isInteger(value.w) &&
    Number.isInteger(value.h)
  ) {
    if ((value.x as number) + (value.w as number) > canvasWidth)
      add(errors, `${path}.w`, 'element extends beyond canvas width')
    if ((value.y as number) + (value.h as number) > canvasHeight)
      add(errors, `${path}.h`, 'element extends beyond canvas height')
  }
  switch (value.kind) {
    case 'text':
      rejectUnknown(value, ['kind', 'id', 'x', 'y', 'w', 'h', 'text', 'role', 'color', 'align'], path, errors)
      baseElement(value, path, errors)
      stringField(value.text, `${path}.text`, errors, 4_000)
      enumField(value.role, ['title', 'subtitle', 'body', 'caption', 'quote', 'source', 'cta'], `${path}.role`, errors)
      colorField(value.color, `${path}.color`, errors)
      if (value.align !== undefined) enumField(value.align, ['left', 'center', 'right'], `${path}.align`, errors)
      return
    case 'image':
      rejectUnknown(value, ['kind', 'id', 'x', 'y', 'w', 'h', 'assetId', 'alt', 'fit'], path, errors)
      baseElement(value, path, errors)
      stringField(value.assetId, `${path}.assetId`, errors, 128, ID)
      stringField(value.alt, `${path}.alt`, errors, 500, undefined, true)
      enumField(value.fit, ['cover', 'contain'], `${path}.fit`, errors)
      return
    case 'shape':
      rejectUnknown(value, ['kind', 'id', 'x', 'y', 'w', 'h', 'shape', 'fill', 'stroke'], path, errors)
      baseElement(value, path, errors)
      enumField(value.shape, ['rect', 'roundRect', 'ellipse', 'line'], `${path}.shape`, errors)
      colorField(value.fill, `${path}.fill`, errors)
      if (value.stroke !== undefined) colorField(value.stroke, `${path}.stroke`, errors)
      return
    case 'chart':
      rejectUnknown(value, ['kind', 'id', 'x', 'y', 'w', 'h', 'chartKind', 'categories', 'series'], path, errors)
      baseElement(value, path, errors)
      enumField(value.chartKind, ['bar', 'line', 'area', 'pie', 'doughnut'], `${path}.chartKind`, errors)
      if (!Array.isArray(value.categories) || value.categories.length > 30) add(errors, `${path}.categories`, 'invalid categories')
      else value.categories.forEach((item, index) => stringField(item, `${path}.categories[${index}]`, errors, 500))
      if (!Array.isArray(value.series) || value.series.length === 0 || value.series.length > 12) {
        add(errors, `${path}.series`, 'invalid series')
      } else {
        value.series.forEach((seriesValue, seriesIndex) => {
          const seriesPath = `${path}.series[${seriesIndex}]`
          if (!isObject(seriesValue)) {
            add(errors, seriesPath, 'must be an object')
            return
          }
          rejectUnknown(seriesValue, ['name', 'values'], seriesPath, errors)
          stringField(seriesValue.name, `${seriesPath}.name`, errors, 500)
          if (!Array.isArray(seriesValue.values) || seriesValue.values.length > 30) {
            add(errors, `${seriesPath}.values`, 'invalid values')
          } else {
            if (
              Array.isArray(value.categories) &&
              seriesValue.values.length !== value.categories.length
            )
              add(errors, `${seriesPath}.values`, 'value count must match categories')
            seriesValue.values.forEach((number, index) =>
              finiteField(number, `${seriesPath}.values[${index}]`, errors),
            )
          }
        })
      }
      return
    default:
      add(errors, `${path}.kind`, 'unsupported native element kind')
      rejectUnknown(value, ['kind'], path, errors)
  }
}

export function validateNativeSlideIR(value: unknown): ValidationResult<NativeSlideIR> {
  const errors: ValidationError[] = []
  if (!isObject(value)) return { ok: false, errors: [{ path: '$', message: 'must be an object' }] }
  rejectUnknown(value, ['schema', 'width', 'height', 'background', 'elements'], '$', errors)
  if (value.schema !== NATIVE_SLIDE_IR_SCHEMA) add(errors, '$.schema', `must equal ${NATIVE_SLIDE_IR_SCHEMA}`)
  const widthOk = integerField(value.width, '$.width', errors, 1, NATIVE_SLIDE_COORD_MAX)
  const heightOk = integerField(value.height, '$.height', errors, 1, NATIVE_SLIDE_COORD_MAX)
  colorField(value.background, '$.background', errors)
  if (!Array.isArray(value.elements) || value.elements.length > NATIVE_SLIDE_ELEMENT_MAX) {
    add(errors, '$.elements', `must be an array with at most ${NATIVE_SLIDE_ELEMENT_MAX} items`)
  } else {
    value.elements.forEach((element, index) =>
      validateElement(
        element,
        `$.elements[${index}]`,
        errors,
        widthOk ? (value.width as number) : null,
        heightOk ? (value.height as number) : null,
      ),
    )
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: value as unknown as NativeSlideIR }
}
