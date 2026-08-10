/**
 * The BYOK settings dialog, shared by every app (docs, sheets, slides, pdf and
 * the shell home). It is the only place a user configures which model answers:
 * preset, base URL, API key, model, and the custom instructions appended to
 * every skill's system prompt.
 *
 * It talks to the main process exclusively through the injected `api` bridge,
 * so each app passes its own preload surface (`window.desktop`,
 * `window.desktopApi`, `window.slidesApi`, `window.pdfApi`, `window.aiOffice`)
 * and this component stays free of any app-specific global.
 *
 * Validation runs against @genoffice/ai-provider's `validateBaseUrl` — the same
 * function the IPC handler enforces — so a URL the dialog accepts is never
 * rejected on save.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AI_PROVIDERS,
  AI_SETTINGS_LIMITS,
  APP_SURFACES,
  BYOK_PRESET_IDS,
  PROVIDER_META_BY_ID,
  validateBaseUrl,
  type AiCheckRequest,
  type AiCheckResult,
  type AiProviderId,
  type AiSettings,
  type AiSettingsSaveResult,
  type AppSurface,
} from '@genoffice/ai-provider'
import { AI_SETTINGS_DIALOG_CSS } from './ai-settings-dialog-css'

/** The preload methods the dialog needs; every app already exposes these names. */
export interface AiSettingsBridge {
  getAiSettings(): Promise<AiSettings>
  setAiSettings(settings: AiSettings): Promise<AiSettingsSaveResult>
  clearAiApiKey(provider: AiProviderId): Promise<AiSettingsSaveResult>
  testAiConnection(request?: AiCheckRequest): Promise<AiCheckResult>
  testAiToolCalling(request?: AiCheckRequest): Promise<AiCheckResult>
  testAiImageGeneration?(request?: AiCheckRequest & { imageModel?: string; imageSize?: string }): Promise<AiCheckResult>
}

/**
 * Every user-visible string, so an app can localize the dialog without this
 * package depending on @genoffice/i18n. Defaults are English: the fields below
 * (base URL, API key, model id) are the vocabulary of the provider docs a user
 * is copying from, and those are English everywhere.
 */
export interface AiSettingsDialogLabels {
  title: string
  provider: string
  model: string
  modelHint: string
  baseUrl: string
  baseUrlHint: string
  apiKey: string
  apiKeySaved: string
  apiKeyUnchanged: string
  removeKey: string
  testConnection: string
  testToolCalling: string
  testImageGeneration: string
  testing: string
  imageGeneration: string
  imageGenerationEnabled: string
  imageModel: string
  imageModelHint: string
  imageSize: string
  instructions: string
  globalInstructions: string
  globalInstructionsHint: string
  perAppInstructions: string
  perAppInstructionsHint: string
  save: string
  saving: string
  cancel: string
  saved: string
  close: string
}

const DEFAULT_LABELS: AiSettingsDialogLabels = {
  title: 'AI Settings',
  provider: 'Provider',
  model: 'Model',
  modelHint: 'The model id exactly as your provider spells it.',
  baseUrl: 'Base URL',
  baseUrlHint: 'OpenAI-compatible endpoint, e.g. https://api.openai.com/v1',
  apiKey: 'API Key',
  apiKeySaved: 'A key is saved for this provider.',
  apiKeyUnchanged: 'Leave blank to keep the saved key.',
  removeKey: 'Remove key',
  testConnection: 'Test Connection',
  testToolCalling: 'Test Tool Calling',
  testImageGeneration: 'Test Image Generation',
  testing: 'Testing…',
  imageGeneration: 'Image generation',
  imageGenerationEnabled: 'Generate images for AI Slides',
  imageModel: 'Image model override',
  imageModelHint: 'Optional. Leave blank to reuse the selected model; support is verified separately.',
  imageSize: 'Default image size',
  instructions: 'Custom instructions',
  globalInstructions: 'All apps',
  globalInstructionsHint: 'Added to the AI system prompt in every app.',
  perAppInstructions: 'This app only',
  perAppInstructionsHint: 'Added after the global instructions when working in this app.',
  save: 'Save',
  saving: 'Saving…',
  cancel: 'Cancel',
  saved: 'Saved',
  close: 'Close',
}

/** Human-readable heading for the failure layer a check reported. */
const FAILURE_TITLES: Record<string, string> = {
  connectivity: 'Cannot reach the endpoint',
  auth: 'The endpoint rejected the API key',
  model: 'The model is not available',
  protocol: 'Not an OpenAI-compatible response',
  streaming: 'Streaming failed',
  'tool-calling': 'Tool calling is not usable',
  config: 'Incomplete settings',
}

const SURFACE_LABELS: Record<AppSurface, string> = {
  docs: 'Docs',
  sheets: 'Sheets',
  slides: 'Slides',
  pdf: 'PDF',
}

/** Styles ship with the component: the four apps have unrelated stylesheets. */
const STYLE_ID = 'genoffice-ai-settings-dialog-css'

function useDialogStyles(): void {
  useEffect(() => {
    if (document.getElementById(STYLE_ID)) return
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = AI_SETTINGS_DIALOG_CSS
    document.head.appendChild(style)
  }, [])
}

type CheckState = { running: false; result: AiCheckResult | null } | { running: true; result: null }

const IDLE: CheckState = { running: false, result: null }

/** Provider order: the BYOK presets first, then whatever else is configured. */
function providerOptions(current: AiProviderId): AiProviderId[] {
  const ids = [...BYOK_PRESET_IDS]
  if (!ids.includes(current) && PROVIDER_META_BY_ID.has(current)) ids.push(current)
  return ids
}

export function AiSettingsDialog({
  api,
  surface,
  labels: labelOverrides,
  onClose,
  onSaved,
}: {
  readonly api: AiSettingsBridge
  /** the app hosting the dialog; its per-app instruction tab opens first */
  readonly surface: AppSurface
  readonly labels?: Partial<AiSettingsDialogLabels> | undefined
  readonly onClose: () => void
  /** the reloaded (key-free) settings, so the host can refresh its own copy */
  readonly onSaved?: ((settings: AiSettings) => void) | undefined
}): React.JSX.Element {
  useDialogStyles()
  const t = useMemo(() => ({ ...DEFAULT_LABELS, ...labelOverrides }), [labelOverrides])

  const [settings, setSettings] = useState<AiSettings | null>(null)
  const [provider, setProvider] = useState<AiProviderId>('openai')
  const [model, setModel] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  /** typed key; blank means "keep whatever is in secure storage" */
  const [apiKey, setApiKey] = useState('')
  const [globalInstructions, setGlobalInstructions] = useState('')
  const [perApp, setPerApp] = useState<Partial<Record<AppSurface, string>>>({})
  const [instructionTab, setInstructionTab] = useState<AppSurface>(surface)
  const [connection, setConnection] = useState<CheckState>(IDLE)
  const [toolCalling, setToolCalling] = useState<CheckState>(IDLE)
  const [imageGenerationCheck, setImageGenerationCheck] = useState<CheckState>(IDLE)
  const [imageEnabled, setImageEnabled] = useState(false)
  const [imageModel, setImageModel] = useState('')
  const [imageSize, setImageSize] = useState<NonNullable<AiSettings['imageGeneration']>['size']>('1024x1024')
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [error, setError] = useState('')
  const dialogRef = useRef<HTMLDivElement>(null)
  const imageCheckReportRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!imageGenerationCheck.running && imageGenerationCheck.result) {
      imageCheckReportRef.current?.scrollIntoView({ block: 'nearest' })
    }
  }, [imageGenerationCheck])

  const meta = PROVIDER_META_BY_ID.get(provider)

  /** Load the current provider's fields out of `next` into the edit state. */
  const hydrateProvider = useCallback((next: AiSettings, id: AiProviderId) => {
    const config = next.providers[id]
    const providerMeta = PROVIDER_META_BY_ID.get(id)
    setModel(config?.model ?? providerMeta?.defaultModel ?? '')
    setBaseUrl(config?.baseUrl ?? providerMeta?.defaultBaseUrl ?? '')
    setApiKey('')
    setConnection(IDLE)
    setToolCalling(IDLE)
    setImageGenerationCheck(IDLE)
  }, [])

  useEffect(() => {
    let alive = true
    void api
      .getAiSettings()
      .then((loaded) => {
        if (!alive) return
        setSettings(loaded)
        setProvider(loaded.provider)
        setGlobalInstructions(loaded.globalInstructions ?? '')
        setPerApp(loaded.perAppInstructions ?? {})
        setImageEnabled(loaded.imageGeneration?.enabled ?? false)
        setImageModel(loaded.imageGeneration?.model ?? '')
        setImageSize(loaded.imageGeneration?.size ?? '1024x1024')
        hydrateProvider(loaded, loaded.provider)
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      alive = false
    }
  }, [api, hydrateProvider])

  // Esc closes; focus starts inside so the dialog is keyboard-reachable at once
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    dialogRef.current?.querySelector('select')?.focus()
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  // Live URL check with the exact rule the main process enforces on save, so a
  // typo is caught here rather than as a rejected save.
  const baseUrlError = useMemo(() => {
    if (!meta?.needsBaseUrl || !baseUrl.trim()) return ''
    const checked = validateBaseUrl(baseUrl)
    return checked.ok ? '' : checked.error
  }, [meta?.needsBaseUrl, baseUrl])

  const keyStored = Boolean(settings?.apiKeyPresent?.[provider])

  const switchProvider = (id: AiProviderId) => {
    if (!settings) return
    setProvider(id)
    setError('')
    hydrateProvider(settings, id)
  }

  /** What both checks are run against: the edited values, not the saved ones. */
  const checkRequest = (): AiCheckRequest => ({
    provider,
    model: model.trim(),
    ...(meta?.needsBaseUrl ? { baseUrl: baseUrl.trim() } : {}),
    ...(apiKey ? { apiKey } : {}),
  })

  const runCheck = (
    kind: 'connection' | 'toolCalling',
    run: (request: AiCheckRequest) => Promise<AiCheckResult>,
  ) => {
    const setState = kind === 'connection' ? setConnection : setToolCalling
    setState({ running: true, result: null })
    void run(checkRequest())
      .then((result) => setState({ running: false, result }))
      .catch((err: unknown) =>
        setState({
          running: false,
          result: {
            ok: false,
            kind: 'config',
            error: err instanceof Error ? err.message : String(err),
          },
        }),
      )
  }

  const runImageCheck = () => {
    if (!api.testAiImageGeneration) return
    setImageGenerationCheck({ running: true, result: null })
    void api
      .testAiImageGeneration({
        ...checkRequest(),
        imageModel: imageModel.trim(),
        imageSize,
      })
      .then((result) => setImageGenerationCheck({ running: false, result }))
      .catch((err: unknown) =>
        setImageGenerationCheck({
          running: false,
          result: {
            ok: false,
            kind: 'config',
            error: err instanceof Error ? err.message : String(err),
          },
        }),
      )
  }

  const removeKey = () => {
    setError('')
    void api
      .clearAiApiKey(provider)
      .then((result) => {
        if (!result.ok) {
          setError(result.error ?? 'Could not remove the key')
          return
        }
        setApiKey('')
        return api.getAiSettings().then(setSettings)
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }

  const save = () => {
    if (!settings || baseUrlError) return
    setSaveState('saving')
    setError('')
    const providers = { ...settings.providers }
    providers[provider] = {
      ...providers[provider],
      // a blank key means "unchanged": the renderer never received the stored
      // one, so it must not be able to wipe it by saving the form untouched
      apiKey,
      model: model.trim(),
      ...(meta?.needsBaseUrl ? { baseUrl: baseUrl.trim() } : {}),
    }
    const perAppTrimmed: Partial<Record<AppSurface, string>> = {}
    for (const s of APP_SURFACES) {
      const text = perApp[s]?.trim()
      if (text) perAppTrimmed[s] = text
    }
    const next: AiSettings = {
      provider,
      providers,
      imageGeneration: {
        enabled: imageEnabled,
        protocol: 'openai-images-v1',
        size: imageSize,
        format: 'png',
        ...(imageModel.trim() ? { model: imageModel.trim() } : {}),
      },
      ...(globalInstructions.trim() ? { globalInstructions: globalInstructions.trim() } : {}),
      ...(Object.keys(perAppTrimmed).length > 0 ? { perAppInstructions: perAppTrimmed } : {}),
    }
    void api
      .setAiSettings(next)
      .then((result) => {
        if (!result.ok) {
          setSaveState('idle')
          setError(result.error ?? 'Could not save the settings')
          return
        }
        // re-read so apiKeyPresent and the normalized base URL reflect what the
        // main process actually stored
        return api.getAiSettings().then((reloaded) => {
          setSettings(reloaded)
          setApiKey('')
          setSaveState('saved')
          onSaved?.(reloaded)
        })
      })
      .catch((err: unknown) => {
        setSaveState('idle')
        setError(err instanceof Error ? err.message : String(err))
      })
  }

  const dirty = () => {
    setSaveState('idle')
    setError('')
  }

  return (
    <div
      className="byok-settings-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="byok-settings"
        role="dialog"
        aria-modal="true"
        aria-label={t.title}
        ref={dialogRef}
      >
        <div className="byok-settings-head">
          <h2>{t.title}</h2>
          <button className="byok-settings-close" onClick={onClose} aria-label={t.close}>
            ×
          </button>
        </div>

        {!settings ? (
          <div className="byok-settings-body byok-settings-loading">…</div>
        ) : (
          <div className="byok-settings-body">
            <label className="byok-field">
              <span className="byok-field-label">{t.provider}</span>
              <select
                value={provider}
                onChange={(e) => switchProvider(e.target.value as AiProviderId)}
              >
                {providerOptions(provider).map((id) => (
                  <option key={id} value={id}>
                    {AI_PROVIDERS.find((p) => p.id === id)?.label ?? id}
                  </option>
                ))}
              </select>
            </label>

            {meta?.needsBaseUrl && (
              <label className="byok-field">
                <span className="byok-field-label">{t.baseUrl}</span>
                <input
                  type="url"
                  spellCheck={false}
                  value={baseUrl}
                  placeholder={meta.defaultBaseUrl ?? 'https://…/v1'}
                  onChange={(e) => {
                    setBaseUrl(e.target.value)
                    dirty()
                  }}
                />
                <span className={`byok-field-hint${baseUrlError ? ' byok-error' : ''}`}>
                  {baseUrlError || t.baseUrlHint}
                </span>
              </label>
            )}

            <label className="byok-field">
              <span className="byok-field-label">{t.apiKey}</span>
              <div className="byok-field-row">
                <input
                  type="password"
                  spellCheck={false}
                  autoComplete="off"
                  value={apiKey}
                  placeholder={meta?.keyPlaceholder ?? ''}
                  onChange={(e) => {
                    setApiKey(e.target.value)
                    dirty()
                  }}
                />
                {keyStored && (
                  <button className="byok-btn byok-btn-quiet" onClick={removeKey}>
                    {t.removeKey}
                  </button>
                )}
              </div>
              <span className="byok-field-hint">
                {keyStored ? `${t.apiKeySaved} ${t.apiKeyUnchanged}` : (meta?.keyPlaceholder ?? '')}
              </span>
            </label>

            <label className="byok-field">
              <span className="byok-field-label">{t.model}</span>
              <input
                list={`byok-models-${provider}`}
                spellCheck={false}
                value={model}
                placeholder={meta?.defaultModel ?? ''}
                onChange={(e) => {
                  setModel(e.target.value)
                  dirty()
                }}
              />
              <datalist id={`byok-models-${provider}`}>
                {(meta?.models ?? []).map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
              <span className="byok-field-hint">{t.modelHint}</span>
            </label>

            <div className="byok-checks">
              <button
                className="byok-btn"
                disabled={connection.running || !!baseUrlError}
                onClick={() => runCheck('connection', (r) => api.testAiConnection(r))}
              >
                {connection.running ? t.testing : t.testConnection}
              </button>
              <button
                className="byok-btn"
                disabled={toolCalling.running || !!baseUrlError}
                onClick={() => runCheck('toolCalling', (r) => api.testAiToolCalling(r))}
              >
                {toolCalling.running ? t.testing : t.testToolCalling}
              </button>
            </div>
            <CheckReport label={t.testConnection} state={connection} />
            <CheckReport label={t.testToolCalling} state={toolCalling} />

            <div className="byok-section">
              <div className="byok-section-title">{t.imageGeneration}</div>
              <label className="byok-checkbox-field">
                <input
                  type="checkbox"
                  checked={imageEnabled}
                  onChange={(e) => {
                    setImageEnabled(e.target.checked)
                    dirty()
                  }}
                />
                <span>{t.imageGenerationEnabled}</span>
              </label>
              <label className="byok-field">
                <span className="byok-field-label">{t.imageModel}</span>
                <input
                  spellCheck={false}
                  value={imageModel}
                  maxLength={AI_SETTINGS_LIMITS.model}
                  placeholder={model || 'image-model-id'}
                  onChange={(e) => {
                    setImageModel(e.target.value)
                    dirty()
                  }}
                />
                <span className="byok-field-hint">{t.imageModelHint}</span>
              </label>
              <label className="byok-field">
                <span className="byok-field-label">{t.imageSize}</span>
                <select
                  value={imageSize}
                  onChange={(e) => {
                    setImageSize(e.target.value as NonNullable<AiSettings['imageGeneration']>['size'])
                    dirty()
                  }}
                >
                  <option value="1024x1024">1024 × 1024</option>
                  <option value="1536x1024">1536 × 1024</option>
                  <option value="1024x1536">1024 × 1536</option>
                </select>
              </label>
              {api.testAiImageGeneration && (
                <>
                  <button
                    className="byok-btn"
                    disabled={imageGenerationCheck.running || !!baseUrlError}
                    onClick={runImageCheck}
                  >
                    {imageGenerationCheck.running ? t.testing : t.testImageGeneration}
                  </button>
                  <div ref={imageCheckReportRef} className="byok-image-check-report">
                    <CheckReport label={t.testImageGeneration} state={imageGenerationCheck} />
                  </div>
                </>
              )}
            </div>

            <div className="byok-section">
              <div className="byok-section-title">{t.instructions}</div>
              <label className="byok-field">
                <span className="byok-field-label">{t.globalInstructions}</span>
                <textarea
                  rows={3}
                  maxLength={AI_SETTINGS_LIMITS.instructions}
                  value={globalInstructions}
                  onChange={(e) => {
                    setGlobalInstructions(e.target.value)
                    dirty()
                  }}
                />
                <span className="byok-field-hint">{t.globalInstructionsHint}</span>
              </label>

              <div className="byok-field">
                <span className="byok-field-label">{t.perAppInstructions}</span>
                <div className="byok-tabs" role="tablist">
                  {APP_SURFACES.map((s) => (
                    <button
                      key={s}
                      role="tab"
                      aria-selected={instructionTab === s}
                      className={`byok-tab${instructionTab === s ? ' active' : ''}`}
                      onClick={() => setInstructionTab(s)}
                    >
                      {SURFACE_LABELS[s]}
                      {perApp[s]?.trim() ? ' •' : ''}
                    </button>
                  ))}
                </div>
                <textarea
                  rows={3}
                  maxLength={AI_SETTINGS_LIMITS.instructions}
                  value={perApp[instructionTab] ?? ''}
                  onChange={(e) => {
                    const value = e.target.value
                    setPerApp((prev) => ({ ...prev, [instructionTab]: value }))
                    dirty()
                  }}
                />
                <span className="byok-field-hint">{t.perAppInstructionsHint}</span>
              </div>
            </div>
          </div>
        )}

        <div className="byok-settings-foot">
          {error && <span className="byok-foot-msg byok-error">{error}</span>}
          {!error && saveState === 'saved' && <span className="byok-foot-msg">{t.saved}</span>}
          <button className="byok-btn byok-btn-quiet" onClick={onClose}>
            {t.cancel}
          </button>
          <button
            className="byok-btn byok-btn-primary"
            disabled={!settings || saveState === 'saving' || !!baseUrlError}
            onClick={save}
          >
            {saveState === 'saving' ? t.saving : t.save}
          </button>
        </div>
      </div>
    </div>
  )
}

/** One check's verdict: which layer failed, and the endpoint's own words. */
function CheckReport({
  label,
  state,
}: {
  readonly label: string
  readonly state: CheckState
}): React.JSX.Element | null {
  if (state.running || !state.result) return null
  const { ok, kind, error, detail } = state.result
  return (
    <div className={`byok-check-report${ok ? ' ok' : ' fail'}`} role="status">
      <span className="byok-check-title">
        {ok ? `${label}: OK` : (FAILURE_TITLES[kind ?? ''] ?? `${label} failed`)}
      </span>
      {(detail ?? error) && <span className="byok-check-detail">{detail ?? error}</span>}
    </div>
  )
}
