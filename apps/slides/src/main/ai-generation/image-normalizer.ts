import jpeg from 'jpeg-js'
import { PNG } from 'pngjs'
import {
  inspectGeneratedImage,
  type GeneratedImageExtension,
  type InspectGeneratedImageOptions,
} from './image-security'

export interface NormalizedGeneratedImage {
  bytes: Uint8Array
  ext: GeneratedImageExtension
  width: number
  height: number
}

export interface NormalizeGeneratedImageOptions extends InspectGeneratedImageOptions {
  jpegQuality?: number
}

/**
 * Fully decodes and re-encodes an inspected image. Only raw pixels survive, so EXIF/GPS,
 * comments, ICC profiles, text chunks, and provider-specific metadata are discarded.
 */
export function normalizeGeneratedImage(
  bytes: Uint8Array,
  options: NormalizeGeneratedImageOptions = {},
): NormalizedGeneratedImage {
  const inspected = inspectGeneratedImage(bytes, options)
  try {
    if (inspected.ext === 'png') {
      const decoded = PNG.sync.read(Buffer.from(bytes), {
        checkCRC: true,
        skipRescale: false,
      })
      if (decoded.width !== inspected.width || decoded.height !== inspected.height)
        throw new Error('decoded PNG geometry mismatch')
      const clean = new PNG({ width: decoded.width, height: decoded.height })
      clean.data = Buffer.from(decoded.data)
      const encoded = PNG.sync.write(clean, { colorType: 6, inputColorType: 6 })
      return {
        bytes: new Uint8Array(encoded),
        ext: 'png',
        width: decoded.width,
        height: decoded.height,
      }
    }

    const quality = options.jpegQuality ?? 90
    if (!Number.isInteger(quality) || quality < 1 || quality > 100)
      throw new Error('invalid JPEG quality')
    const decoded = jpeg.decode(bytes, {
      useTArray: true,
      formatAsRGBA: true,
      tolerantDecoding: false,
      maxResolutionInMP: Math.ceil(options.maxPixels ?? 16_777_216) / 1_000_000,
      maxMemoryUsageInMB: 192,
    })
    if (decoded.width !== inspected.width || decoded.height !== inspected.height)
      throw new Error('decoded JPEG geometry mismatch')
    const encoded = jpeg.encode(
      { width: decoded.width, height: decoded.height, data: decoded.data },
      quality,
    )
    return {
      bytes: new Uint8Array(encoded.data),
      ext: 'jpg',
      width: decoded.width,
      height: decoded.height,
    }
  } catch (error) {
    if (error instanceof Error && /quality|geometry mismatch/.test(error.message)) throw error
    throw new Error('generated image decode or normalization failed', { cause: error })
  }
}
