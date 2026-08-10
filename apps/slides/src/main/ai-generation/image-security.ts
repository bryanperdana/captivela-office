export type GeneratedImageExtension = 'png' | 'jpg'

export interface GeneratedImageLimits {
  maxEncodedBytes: number
  maxWidth: number
  maxHeight: number
  maxPixels: number
}

export interface InspectGeneratedImageOptions extends Partial<GeneratedImageLimits> {
  /** Advisory only. The detected format always comes from the encoded bytes. */
  declaredContentType?: string | null
}

export interface InspectedGeneratedImage {
  ext: GeneratedImageExtension
  mime: 'image/png' | 'image/jpeg'
  width: number
  height: number
  encodedBytes: number
}

export const DEFAULT_GENERATED_IMAGE_LIMITS: Readonly<GeneratedImageLimits> = Object.freeze({
  maxEncodedBytes: 12 * 1024 * 1024,
  maxWidth: 4096,
  maxHeight: 4096,
  maxPixels: 16_777_216,
})

const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])
const JPEG_SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
])

function hasPrefix(bytes: Uint8Array, prefix: Uint8Array): boolean {
  return bytes.byteLength >= prefix.byteLength && prefix.every((value, index) => bytes[index] === value)
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! * 0x1000000 +
    bytes[offset + 1]! * 0x10000 +
    bytes[offset + 2]! * 0x100 +
    bytes[offset + 3]!
  )
}

function readU16(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! * 0x100 + bytes[offset + 1]!
}

function parsePng(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.byteLength < 33) throw new Error('truncated PNG image')
  let offset = PNG_SIGNATURE.byteLength
  let width = 0
  let height = 0
  let sawIhdr = false
  let sawIdat = false

  while (offset < bytes.byteLength) {
    if (offset + 12 > bytes.byteLength) throw new Error('truncated PNG chunk')
    const length = readU32(bytes, offset)
    const dataStart = offset + 8
    const next = dataStart + length + 4
    if (!Number.isSafeInteger(next) || next > bytes.byteLength) throw new Error('truncated PNG chunk')
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8))

    if (!sawIhdr) {
      if (type !== 'IHDR' || length !== 13) throw new Error('invalid PNG header')
      width = readU32(bytes, dataStart)
      height = readU32(bytes, dataStart + 4)
      sawIhdr = true
    } else if (type === 'IHDR') {
      throw new Error('invalid duplicate PNG header')
    }
    if (type === 'IDAT') sawIdat = true
    if (type === 'IEND') {
      if (length !== 0 || !sawIdat || next !== bytes.byteLength) throw new Error('invalid PNG ending')
      return { width, height }
    }
    offset = next
  }
  throw new Error('truncated PNG image')
}

function parseJpeg(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8)
    throw new Error('invalid JPEG header')
  if (bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) throw new Error('truncated JPEG image')

  let offset = 2
  let dimensions: { width: number; height: number } | undefined
  while (offset < bytes.byteLength - 2) {
    if (bytes[offset] !== 0xff) {
      // Entropy-coded scan data continues until the final EOI. A decoder validates it later.
      offset++
      continue
    }
    while (bytes[offset] === 0xff) offset++
    const marker = bytes[offset++]
    if (marker === undefined) throw new Error('truncated JPEG marker')
    if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) continue
    if (offset + 2 > bytes.byteLength) throw new Error('truncated JPEG segment')
    const length = readU16(bytes, offset)
    if (length < 2 || offset + length > bytes.byteLength) throw new Error('truncated JPEG segment')
    if (JPEG_SOF_MARKERS.has(marker)) {
      if (length < 8) throw new Error('invalid JPEG frame')
      const height = readU16(bytes, offset + 3)
      const width = readU16(bytes, offset + 5)
      dimensions = { width, height }
    }
    offset += length
  }
  if (!dimensions) throw new Error('invalid JPEG dimensions')
  return dimensions
}

function resolvedLimits(options: InspectGeneratedImageOptions): GeneratedImageLimits {
  const limits = {
    maxEncodedBytes: options.maxEncodedBytes ?? DEFAULT_GENERATED_IMAGE_LIMITS.maxEncodedBytes,
    maxWidth: options.maxWidth ?? DEFAULT_GENERATED_IMAGE_LIMITS.maxWidth,
    maxHeight: options.maxHeight ?? DEFAULT_GENERATED_IMAGE_LIMITS.maxHeight,
    maxPixels: options.maxPixels ?? DEFAULT_GENERATED_IMAGE_LIMITS.maxPixels,
  }
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`invalid generated image ${name}`)
  }
  return limits
}

const STRICT_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

/** Strict, bounded decoder for provider b64_json. Rejects whitespace, data URLs, and non-canonical padding. */
export function decodeGeneratedImageBase64(
  encoded: unknown,
  maxDecodedBytes = DEFAULT_GENERATED_IMAGE_LIMITS.maxEncodedBytes,
): Uint8Array {
  if (typeof encoded !== 'string' || encoded.length === 0 || !STRICT_BASE64.test(encoded))
    throw new Error('generated image base64 payload is invalid')
  if (!Number.isSafeInteger(maxDecodedBytes) || maxDecodedBytes <= 0)
    throw new Error('invalid generated image base64 byte limit')
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0
  const estimated = (encoded.length / 4) * 3 - padding
  if (!Number.isSafeInteger(estimated) || estimated <= 0 || estimated > maxDecodedBytes)
    throw new Error('generated image base64 payload exceeds byte limit')
  const decoded = Buffer.from(encoded, 'base64')
  if (decoded.byteLength !== estimated)
    throw new Error('generated image base64 payload is invalid')
  return new Uint8Array(decoded)
}

/** Performs allocation-free format and geometry checks before any image decoder is invoked. */
export function inspectGeneratedImage(
  bytes: Uint8Array,
  options: InspectGeneratedImageOptions = {},
): InspectedGeneratedImage {
  // Buffer and test/runtime cross-realm Uint8Arrays are valid byte views even when
  // `instanceof Uint8Array` is false across VM boundaries.
  if (!ArrayBuffer.isView(bytes) || bytes.BYTES_PER_ELEMENT !== 1 || bytes.byteLength === 0)
    throw new Error('generated image bytes are empty')
  const limits = resolvedLimits(options)
  if (bytes.byteLength > limits.maxEncodedBytes)
    throw new Error('generated image exceeds encoded byte limit')

  let format: Pick<InspectedGeneratedImage, 'ext' | 'mime'>
  let dimensions: { width: number; height: number }
  if (hasPrefix(bytes, PNG_SIGNATURE)) {
    format = { ext: 'png', mime: 'image/png' }
    dimensions = parsePng(bytes)
  } else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    format = { ext: 'jpg', mime: 'image/jpeg' }
    dimensions = parseJpeg(bytes)
  } else {
    throw new Error('unsupported image format; only PNG and JPEG are accepted')
  }

  const { width, height } = dimensions
  if (width <= 0 || height <= 0 || width > limits.maxWidth || height > limits.maxHeight)
    throw new Error('generated image dimensions exceed allowed bounds')
  if (width * height > limits.maxPixels) throw new Error('generated image exceeds decoded pixel limit')
  return { ...format, width, height, encodedBytes: bytes.byteLength }
}
