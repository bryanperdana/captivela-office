/**
 * AI IPC for the slides main process, extracted from slides-main.ts:
 * settings persistence, the streaming proxy (main process does the networking
 * to avoid renderer CORS), search tools, and the slides-only ai:* channels
 * (image generation, media analysis, style templates).
 */
import { app, ipcMain, safeStorage, shell } from 'electron'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  AiCreditsError,
  AiTimeoutError,
  GENSPARK_CLOUD_ENABLED,
  generateImage,
  streamForProvider,
  type AiCheckRequest,
  type AiSettings,
  type AiStreamChunk,
  type AiStreamRequest,
  type GenSparkAccountStatus,
  type ImageGenerationConfig,
  type ImageGenerationProvider,
} from '@genoffice/ai-provider'
import {
  clearApiKeyFromRenderer,
  createAiSettingsStore,
  fetchRemoteImage,
  getSettingsForRenderer,
  redactRequestError,
  resolveRequestConfig,
  runConnectionCheck,
  runImageGenerationCheck,
  runToolCallingCheck,
  setSettingsFromRenderer,
  type AiSettingsStore,
} from '@genoffice/electron-utils'
import {
  webSearch,
  imageSearch,
  ensureGenofficeLogin,
  gskApiKey,

  gskAnalyzeMedia,
  gskLoginInfo,
  hasGskAuth,
} from '@genoffice/ai-search'
import { addPicture } from '@genoffice/pptx-engine'
import { EMU_PER_PX_96 } from '@genoffice/pptx-render'
import { tm } from './i18n-main'
import {
  pushHistory,
  rebuildSlide,
  sessionGenerationId,
  sessionRevision,
  sessions,
} from './session-state'
import { fetchGeneratedImage } from './ai-generation/generated-image-fetch'
import { normalizeGeneratedImage } from './ai-generation/image-normalizer'
import { decodeGeneratedImageBase64 } from './ai-generation/image-security'

// ---- AI settings + streaming proxy (the main process does the networking to avoid renderer CORS; implementation shared via @genoffice/ai-provider) ----

const AI_SETTINGS_PATH = () => join(app.getPath('userData'), 'ai-settings.json')

function readJson<T>(path: string, fallback: T): T {
  try {
    if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf-8')) as T
  } catch {
    /* Corrupted state file: fall back to defaults */
  }
  return fallback
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, JSON.stringify(value, null, 2))
}

const activeAiStreams = new Map<string, AbortController>()

/** Lazily created: userData is only valid once Electron is ready. */
let aiSettingsStore: AiSettingsStore | null = null

function getAiSettingsStore(): AiSettingsStore {
  if (!aiSettingsStore) {
    aiSettingsStore = createAiSettingsStore({
      settingsPath: AI_SETTINGS_PATH(),
      cipher: safeStorage,
    })
  }
  return aiSettingsStore
}

export type ResolvedStoredImageGeneration =
  | { ok: true; provider: ImageGenerationProvider; config: ImageGenerationConfig }
  | { ok: false; error: string }

/** Main-process-only image config. Secrets are resolved fresh and never cross IPC. */
export function resolveStoredImageGeneration(): ResolvedStoredImageGeneration {
  const store = getAiSettingsStore()
  const stored = store.read()
  const image = stored.imageGeneration
  if (!image?.enabled) return { ok: false, error: 'BYOK image generation is disabled.' }
  const resolved = resolveRequestConfig(store, {
    provider: stored.provider,
    providers: stored.providers,
  })
  if (!resolved.ok) return { ok: false, error: resolved.error }
  const baseUrl =
    resolved.config.baseUrl ??
    (resolved.provider === 'openai' ? 'https://api.openai.com/v1' : '')
  if (!baseUrl) return { ok: false, error: 'The selected provider has no Images API base URL.' }
  return {
    ok: true,
    provider: { baseUrl, apiKey: resolved.config.apiKey },
    config: {
      protocol: image.protocol,
      model: image.model || resolved.config.model,
      size: image.size,
      format: image.format,
    },
  }
}

export function registerAiIpc(): void {
  // BYOK: the stored provider choice is returned as-is (fresh installs default
  // to the 'openai' preset) and API keys are stripped — the renderer gets only
  // an "is a key stored" flag per provider.
  ipcMain.handle('ai:get-settings', (): AiSettings => getSettingsForRenderer(getAiSettingsStore()))

  // hosted service account: reports signed-out in the BYOK build, so nothing can gate
  // an AI feature on a hosted service login
  ipcMain.handle(
    'ai:gsk-status',
    async (_event, withEmail?: boolean): Promise<GenSparkAccountStatus> => {
      if (!GENSPARK_CLOUD_ENABLED || !hasGskAuth()) return { loggedIn: false }
      if (!withEmail) return { loggedIn: true }
      const info = await gskLoginInfo()
      return info?.email ? { loggedIn: true, email: info.email } : { loggedIn: true }
    },
  )

  ipcMain.handle('ai:gsk-login', () => {
    if (!GENSPARK_CLOUD_ENABLED) return
    ensureGenofficeLogin((url) => void shell.openExternal(url))
  })

  ipcMain.handle('ai:set-settings', (_event, settings: unknown) =>
    setSettingsFromRenderer(getAiSettingsStore(), settings),
  )

  ipcMain.handle('ai:clear-api-key', (_event, provider: unknown) =>
    clearApiKeyFromRenderer(getAiSettingsStore(), provider),
  )

  ipcMain.handle('ai:test-connection', (_event, request: AiCheckRequest) =>
    runConnectionCheck(getAiSettingsStore(), request ?? {}),
  )

  ipcMain.handle('ai:test-tool-calling', (_event, request: AiCheckRequest) =>
    runToolCallingCheck(getAiSettingsStore(), request ?? {}),
  )

  ipcMain.handle('ai:test-image-generation', (_event, request: unknown) =>
    runImageGenerationCheck(getAiSettingsStore(), request ?? {}),
  )

  ipcMain.handle('ai:stream', async (event, request: AiStreamRequest) => {
    const { requestId, system, messages } = request
    const tools = request.tools ?? []
    const maxTokens = request.maxTokens ?? 8192
    const send = (chunk: AiStreamChunk) => {
      if (!event.sender.isDestroyed()) event.sender.send('ai:stream-chunk', chunk)
    }
    // the API key never travels through the renderer: it is read from secure
    // storage here (or, for genspark, from the gsk login state)
    const resolved = resolveRequestConfig(getAiSettingsStore(), request.settings, (p) =>
      p === 'genspark' && GENSPARK_CLOUD_ENABLED ? gskApiKey() : '',
    )
    if (!resolved.ok) {
      send({
        requestId,
        type: 'error',
        error:
          resolved.kind === 'model'
            ? tm('errNoModel')
            : request.settings?.provider === 'genspark'
              ? tm('errGskNotLoggedIn')
              : resolved.error,
      })
      return
    }
    const { provider, config } = resolved
    const controller = new AbortController()
    activeAiStreams.set(requestId, controller)
    // wire-activity keepalive: lets the renderer's silence watchdog tell a slow turn from a dead one
    let lastPing = 0
    const ping = () => {
      const now = Date.now()
      if (now - lastPing < 5_000) return
      lastPing = now
      send({ requestId, type: 'ping' })
    }
    try {
      await streamForProvider(provider, config, system, messages, tools, maxTokens, {
        signal: controller.signal,
        onDelta: (text) => send({ requestId, type: 'delta', text }),
        onToolCall: (toolCall) => send({ requestId, type: 'tool-call', toolCall }),
        onActivity: ping,
      })
      send({ requestId, type: 'done' })
    } catch (err) {
      if (controller.signal.aborted) {
        send({ requestId, type: 'done' })
      } else {
        const msg = redactRequestError(err instanceof Error ? err.message : String(err), config)
        console.error(`[ai-stream] ${requestId} (${provider}/${config.model}) failed:`, msg)
        send({
          requestId,
          type: 'error',
          error: msg,
          ...(err instanceof AiTimeoutError
            ? { errorCode: 'timeout' as const }
            : err instanceof AiCreditsError
              ? { errorCode: 'credits' as const }
              : {}),
        })
      }
    } finally {
      activeAiStreams.delete(requestId)
    }
  })

  ipcMain.handle('ai:stream-cancel', (_event, requestId: string) => {
    activeAiStreams.get(requestId)?.abort()
  })

  // Search tools (content + images), Serper with DuckDuckGo fallback
  ipcMain.handle('ai:web-search', async (_event, query: string, maxResults?: number) => {
    try {
      return await webSearch(String(query), typeof maxResults === 'number' ? maxResults : 6)
    } catch (err) {
      return { results: [], method: 'error', error: String(err) }
    }
  })

  ipcMain.handle('ai:image-search', async (_event, query: string, maxResults?: number) => {
    try {
      return await imageSearch(String(query), typeof maxResults === 'number' ? maxResults : 8)
    } catch (err) {
      return { images: [], method: 'error', error: String(err) }
    }
  })
}

// ── ai:* handlers unique to slides ──────────────────────────────────────
// Must be registered inside registerSlidesIpc (not registerAiIpc): in shell aggregate mode the
// generic ai:* channels are registered by docs-main.registerAiIpc, and slides' registerAiIpc is
// never called; docs does not have these channels, so putting them in the wrong place raises
// "No handler registered".
export function registerSlidesOnlyAiIpc(): void {
  // BYOK image generation stays entirely in main: provider payloads are normalized
  // and inserted as native picture elements without exposing bytes or URLs to renderer.
  ipcMain.handle(
    'ai:generate-image',
    async (
      event,
      op: {
        prompt: string
        slideIndex: number
        xPx: number
        yPx: number
        wPx: number
        hPx: number
        fitWidthPx: number
        aspectRatio?: string
      },
    ) => {
      const session = sessions.get(event.sender.id)
      if (!session) return { error: 'No open slide session.' }
      const slideIndex = Number(op?.slideIndex)
      const slide = session.opened.deck.slides[slideIndex]
      if (!slide) return { error: 'Target slide is unavailable.' }
      const prompt = String(op?.prompt ?? '').trim()
      if (!prompt || prompt.length > 2_000) return { error: 'Invalid image prompt.' }
      const geometry = [op.xPx, op.yPx, op.wPx, op.hPx, op.fitWidthPx].map(Number)
      if (geometry.some((value) => !Number.isFinite(value)) || geometry[2] <= 0 || geometry[3] <= 0 || geometry[4] <= 0)
        return { error: 'Invalid image placement.' }
      const expectedSession = session
      const expectedGenerationId = sessionGenerationId(session)
      const expectedRevision = sessionRevision(session)
      const resolved = resolveStoredImageGeneration()
      if (!resolved.ok) return { error: resolved.error }
      const ratio = String(op.aspectRatio ?? '')
      const size = ratio === '16:9' || ratio === '3:2'
        ? '1536x1024'
        : ratio === '9:16' || ratio === '2:3'
          ? '1024x1536'
          : resolved.config.size
      try {
        const payload = await generateImage(
          resolved.provider,
          { ...resolved.config, size },
          { prompt, count: 1 },
        )
        const source = payload.kind === 'base64'
          ? { bytes: decodeGeneratedImageBase64(payload.data), declaredContentType: null }
          : await fetchGeneratedImage(payload.url)
        const normalized = normalizeGeneratedImage(source.bytes, {
          declaredContentType: source.declaredContentType,
        })
        const current = sessions.get(event.sender.id)
        if (
          current !== expectedSession ||
          sessionGenerationId(current) !== expectedGenerationId ||
          sessionRevision(current) !== expectedRevision
        ) return { error: 'Image generation became stale because the deck changed.' }
        const baseWidthPx = session.opened.deck.size.cx / EMU_PER_PX_96
        const scale = geometry[4] / baseWidthPx
        const toEmu = (px: number) => Math.round((px / scale) * EMU_PER_PX_96)
        pushHistory(session)
        const el = addPicture(session.opened, slide, {
          bytes: normalized.bytes,
          ext: normalized.ext,
          offset: {
            x: toEmu(geometry[0]),
            y: toEmu(geometry[1]),
            cx: Math.max(1, toEmu(geometry[2])),
            cy: Math.max(1, toEmu(geometry[3])),
          },
        })
        if (!el) {
          session.undoStack.pop()
          return { error: 'Could not insert generated image.' }
        }
        session.fitWidthPx = geometry[4]
        const rebuilt = rebuildSlide(session, slideIndex)
        return rebuilt
          ? { slide: rebuilt, sourceId: el.id }
          : { error: 'Could not rebuild target slide.' }
      } catch (err) {
        return { error: err instanceof Error ? err.message.slice(0, 400) : String(err).slice(0, 400) }
      }
    },
  )

  ipcMain.handle(
    'ai:analyze-media',
    async (_event, op: { mediaUrls: string[]; requirements: string }) => {
      if (!GENSPARK_CLOUD_ENABLED)
        return { error: 'Cloud media analysis is unavailable in this build.' }
      if (!hasGskAuth()) return { error: tm('errGskCli') }
      try {
        const text = await gskAnalyzeMedia({
          mediaUrls: (op.mediaUrls ?? []).map(String),
          requirements: String(op.requirements ?? ''),
        })
        return { text }
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  // Download an image from a URL and insert it into the given page (image search -> insert in one step; download in the main process avoids CORS)
  ipcMain.handle(
    'ai:insert-image-url',
    async (
      e,
      op: {
        slideIndex: number
        url: string
        xPx: number
        yPx: number
        wPx: number
        hPx: number
        fitWidthPx: number
      },
    ) => {
      const session = sessions.get(e.sender.id)
      if (!session) return null
      const slide = session.opened.deck.slides[op.slideIndex]
      if (!slide) return null
      try {
        // the URL originates from AI tool calls (prompt-injectable via image
        // search results), so refuse non-http schemes and private/link-local
        // targets; redirects are followed manually so every hop is validated.
        // fetchRemoteImage adds CDN-friendly headers and transient-error retries.
        const resp = await fetchRemoteImage(String(op.url))
        if (!resp || !resp.ok) return null
        const buf = Buffer.from(await resp.arrayBuffer())
        const ct = resp.headers.get('content-type') ?? ''
        const ext = ct.includes('png') ? 'png' : ct.includes('gif') ? 'gif' : 'jpg'
        const baseWidthPx = session.opened.deck.size.cx / EMU_PER_PX_96
        const scale = op.fitWidthPx / baseWidthPx
        const toEmu = (px: number) => Math.round((px / scale) * EMU_PER_PX_96)
        pushHistory(session)
        const el = addPicture(session.opened, slide, {
          bytes: new Uint8Array(buf),
          ext,
          offset: {
            x: toEmu(op.xPx),
            y: toEmu(op.yPx),
            cx: Math.max(1, toEmu(op.wPx)),
            cy: Math.max(1, toEmu(op.hPx)),
          },
        })
        if (!el) {
          session.undoStack.pop()
          return null
        }
        session.fitWidthPx = op.fitWidthPx
        const rebuilt = rebuildSlide(session, op.slideIndex)
        return rebuilt ? { slide: rebuilt, sourceId: el.id } : null
      } catch {
        return null
      }
    },
  )

  // ── Style Skill sidecar persistence: write a same-named .styleskill.json next to the draft (fail-open)
  ipcMain.handle(
    'ai:save-sidecar',
    async (
      event,
      data: { topic: string; styleSkill: string; createdAt: string },
    ): Promise<{ ok: boolean }> => {
      try {
        const session = sessions.get(event.sender.id)
        const draftPath = session?.path
        if (!draftPath || !draftPath.endsWith('.pptx')) return { ok: false }
        const sidecarPath = draftPath.replace(/\.pptx$/i, '.styleskill.json')
        writeFileSync(sidecarPath, JSON.stringify(data, null, 2))
        return { ok: true }
      } catch {
        return { ok: false }
      }
    },
  )

  // ── Style template save: stored in userData/style-templates/<name>.json
  const STYLE_TEMPLATES_DIR = () => join(app.getPath('userData'), 'style-templates')

  ipcMain.handle(
    'ai:save-style-template',
    (
      _event,
      name: string,
      data: { topic: string; styleSkill: string; createdAt: string },
    ): { ok: boolean; error?: string } => {
      try {
        const dir = STYLE_TEMPLATES_DIR()
        mkdirSync(dir, { recursive: true })
        // Filename: replace illegal characters in the name with _ then truncate to 64 chars
        const safeName = name.replace(/[/\\:*?"<>|]/g, '_').slice(0, 64)
        if (!safeName) return { ok: false, error: tm('errTplNameInvalid') }
        writeJson(join(dir, `${safeName}.json`), { ...data, name: safeName })
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  // ── Style template list
  ipcMain.handle(
    'ai:list-style-templates',
    (): Array<{ name: string; topic: string; createdAt: string }> => {
      try {
        const dir = STYLE_TEMPLATES_DIR()
        if (!existsSync(dir)) return []
        const files = readdirSync(dir).filter((f) => f.endsWith('.json'))
        return files
          .map((f) => {
            try {
              const raw = readJson<{
                name?: string
                topic?: string
                createdAt?: string
                styleSkill?: string
              }>(join(dir, f), {})
              return {
                name: raw.name ?? f.replace(/\.json$/, ''),
                topic: raw.topic ?? '',
                createdAt: raw.createdAt ?? '',
              }
            } catch {
              return null
            }
          })
          .filter(Boolean) as Array<{ name: string; topic: string; createdAt: string }>
      } catch {
        return []
      }
    },
  )

  // ── Style template load
  ipcMain.handle(
    'ai:load-style-template',
    (
      _event,
      name: string,
    ): { ok: boolean; styleSkill?: string; topic?: string; error?: string } => {
      try {
        const dir = STYLE_TEMPLATES_DIR()
        const safeName = name.replace(/[/\\:*?"<>|]/g, '_').slice(0, 64)
        const filePath = join(dir, `${safeName}.json`)
        if (!existsSync(filePath)) return { ok: false, error: tm('errTplMissing', { name }) }
        const raw = readJson<{ styleSkill?: string; topic?: string }>(filePath, {})
        if (!raw.styleSkill) return { ok: false, error: tm('errTplNoSkill', { name }) }
        return { ok: true, styleSkill: raw.styleSkill, topic: raw.topic ?? '' }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  )
}
