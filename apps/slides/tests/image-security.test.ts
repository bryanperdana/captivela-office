import jpeg from 'jpeg-js'
import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_GENERATED_IMAGE_LIMITS,
  decodeGeneratedImageBase64,
  inspectGeneratedImage,
} from '../src/main/ai-generation/image-security'
import { normalizeGeneratedImage } from '../src/main/ai-generation/image-normalizer'

function png(width = 2, height = 2): Uint8Array {
  const image = new PNG({ width, height })
  image.data.fill(255)
  return new Uint8Array(PNG.sync.write(image))
}

function jpg(width = 2, height = 2): Uint8Array {
  return new Uint8Array(
    jpeg.encode({ width, height, data: Buffer.alloc(width * height * 4, 127) }, 90).data,
  )
}

function injectJpegExif(bytes: Uint8Array): Uint8Array {
  const payload = Buffer.from('Exif\0\0GPSLatitude=private')
  const marker = Buffer.alloc(4 + payload.length)
  marker[0] = 0xff
  marker[1] = 0xe1
  marker.writeUInt16BE(payload.length + 2, 2)
  payload.copy(marker, 4)
  return new Uint8Array(Buffer.concat([Buffer.from(bytes.subarray(0, 2)), marker, Buffer.from(bytes.subarray(2))]))
}

describe('generated image security and normalization', () => {
  it('strictly decodes bounded provider base64 payloads', () => {
    expect(decodeGeneratedImageBase64('AQID')).toEqual(new Uint8Array([1, 2, 3]))
    for (const invalid of ['', 'AQI', 'AQID\n', 'data:image/png;base64,AQID', '====']) {
      expect(() => decodeGeneratedImageBase64(invalid)).toThrow(/base64 payload is invalid/)
    }
    expect(() => decodeGeneratedImageBase64('AQID', 2)).toThrow(/exceeds byte limit/)
  })

  it.each([
    ['png', png(), 'image/png', 'png'],
    ['jpeg', jpg(), 'image/jpeg', 'jpg'],
  ] as const)('accepts a valid %s by magic bytes regardless of declared MIME', (_name, bytes, _mime, ext) => {
    expect(inspectGeneratedImage(bytes, { declaredContentType: 'text/html' })).toMatchObject({
      width: 2,
      height: 2,
      ext,
    })
  })

  it('rejects unsupported or disguised payloads', () => {
    const payloads = [
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
      Buffer.from('<html><script>alert(1)</script></html>'),
      Buffer.from('GIF89a'),
      Buffer.from('%PDF-1.7'),
    ]
    for (const bytes of payloads) {
      expect(() => inspectGeneratedImage(bytes, { declaredContentType: 'image/png' })).toThrow(
        /unsupported image format/,
      )
    }
  })

  it('rejects empty, truncated, and oversized encoded payloads', () => {
    expect(() => inspectGeneratedImage(new Uint8Array())).toThrow(/empty/)
    expect(() => inspectGeneratedImage(png().subarray(0, 25))).toThrow(/truncated|invalid/)
    expect(() => inspectGeneratedImage(jpg().subarray(0, 20))).toThrow(/truncated|invalid/)
    expect(() => inspectGeneratedImage(png(), { maxEncodedBytes: 8 })).toThrow(/encoded byte limit/)
  })

  it('rejects dimensions and decoded pixel counts before decoding', () => {
    const header = png(2, 2)
    Buffer.from(header.buffer, header.byteOffset, header.byteLength).writeUInt32BE(5000, 16)
    expect(() => inspectGeneratedImage(header)).toThrow(/dimensions/)

    expect(() =>
      inspectGeneratedImage(png(20, 20), { maxWidth: 20, maxHeight: 20, maxPixels: 399 }),
    ).toThrow(/pixel limit/)
  })

  it('fully decodes and re-encodes PNG/JPEG and strips JPEG EXIF/GPS metadata', () => {
    const dirty = injectJpegExif(jpg(3, 2))
    expect(Buffer.from(dirty).includes(Buffer.from('GPSLatitude=private'))).toBe(true)

    const normalizedJpeg = normalizeGeneratedImage(dirty)
    expect(normalizedJpeg).toMatchObject({ ext: 'jpg', width: 3, height: 2 })
    expect(Buffer.from(normalizedJpeg.bytes).includes(Buffer.from('Exif'))).toBe(false)
    expect(Buffer.from(normalizedJpeg.bytes).includes(Buffer.from('GPSLatitude'))).toBe(false)
    expect(inspectGeneratedImage(normalizedJpeg.bytes)).toMatchObject({ width: 3, height: 2 })

    const normalizedPng = normalizeGeneratedImage(png(3, 2))
    expect(normalizedPng).toMatchObject({ ext: 'png', width: 3, height: 2 })
    expect(PNG.sync.read(Buffer.from(normalizedPng.bytes))).toMatchObject({ width: 3, height: 2 })
  })

  it('rejects corrupt compressed image data during normalization', () => {
    const corrupt = png()
    corrupt[Math.floor(corrupt.length / 2)] ^= 0xff
    expect(() => normalizeGeneratedImage(corrupt)).toThrow(/decode|invalid|corrupt/i)
  })

  it('exports conservative default limits', () => {
    expect(DEFAULT_GENERATED_IMAGE_LIMITS).toEqual({
      maxEncodedBytes: 12 * 1024 * 1024,
      maxWidth: 4096,
      maxHeight: 4096,
      maxPixels: 16_777_216,
    })
  })
})
