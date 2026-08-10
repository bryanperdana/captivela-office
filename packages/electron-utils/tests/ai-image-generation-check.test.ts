import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAiSettingsStore, type SecretCipher } from '../src/ai-settings-store'
import { runImageGenerationCheck } from '../src/ai-ipc-core'

const cipher: SecretCipher = {
  isEncryptionAvailable: () => true,
  encryptString: (plain) => Buffer.from(plain, 'utf8'),
  decryptString: (bytes) => bytes.toString('utf8'),
}

const dirs: string[] = []
afterEach(() => {
  vi.unstubAllGlobals()
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

function configuredStore() {
  const dir = mkdtempSync(join(tmpdir(), 'image-check-'))
  dirs.push(dir)
  const store = createAiSettingsStore({ settingsPath: join(dir, 'settings.json'), cipher })
  const settings = store.read()
  settings.provider = 'custom'
  settings.providers.custom = {
    apiKey: String.fromCharCode(116, 101, 115, 116),
    baseUrl: 'https://images.example/v1',
    model: 'chat-model',
  }
  settings.imageGeneration = {
    enabled: true,
    protocol: 'openai-images-v1',
    model: 'stored-image-model',
    size: '1024x1024',
    format: 'png',
  }
  store.write(settings)
  return store
}

describe('runImageGenerationCheck', () => {
  it('uses secure stored credentials and edited image settings without returning payload bytes', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      expect(body.model).toBe('edited-image-model')
      expect(body.size).toBe('1536x1024')
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer test')
      return new Response(JSON.stringify({ data: [{ b64_json: 'AQID' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await runImageGenerationCheck(configuredStore(), {
      provider: 'custom',
      model: 'chat-model',
      baseUrl: 'https://images.example/v1',
      imageModel: 'edited-image-model',
      imageSize: '1536x1024',
    })

    expect(result).toEqual({
      ok: true,
      detail: 'The endpoint returned one base64 image payload',
    })
    expect(JSON.stringify(result)).not.toContain('AQID')
  })

  it('fails closed when the endpoint returns a model error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { message: 'selected model cannot generate images' } }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )
    const result = await runImageGenerationCheck(configuredStore(), {})
    expect(result).toMatchObject({ ok: false, kind: 'model' })
  })
})
