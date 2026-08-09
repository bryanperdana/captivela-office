import type { AgentMessage, AgentToolCall, AgentToolDef } from '@genoffice/agent-core'

/**
 * BYOK (bring-your-own-key) OpenAI-compatible presets are the default, exposed
 * surface: 'openai' | 'openrouter' | 'ollama' | 'litellm' | 'custom'. 'genspark' |
 * 'anthropic' | 'gemini' | 'deepseek' are native/legacy providers kept internally
 * (routing + gsk login) but are not part of the default BYOK preset menu — see
 * `BYOK_PRESET_IDS` in ./providers.
 */
export type AiProviderId =
  | 'genspark'
  | 'anthropic'
  | 'gemini'
  | 'deepseek'
  | 'openai'
  | 'openrouter'
  | 'ollama'
  | 'litellm'
  | 'custom'

/** hosted service account status (gsk login state; the sole auth source for AI features) */
export interface GenSparkAccountStatus {
  loggedIn: boolean
  email?: string
}

export interface AiProviderConfig {
  apiKey: string
  model: string
  /** editable for every OpenAI-compatible preset (openai/openrouter/ollama/litellm/custom); undefined only for the fixed-endpoint native providers (anthropic/gemini/genspark) */
  baseUrl?: string | undefined
}

export interface AiProviderMeta {
  id: AiProviderId
  label: string
  models: string[]
  defaultModel: string
  keyPlaceholder: string
  /** the base URL field is shown and user-editable for this preset */
  needsBaseUrl?: boolean
  /** pre-filled base URL shown when the preset is first selected (still editable) */
  defaultBaseUrl?: string
  /** true when the provider can work with an empty API key (e.g. local Ollama) */
  apiKeyOptional?: boolean
}

export interface AiSettings {
  provider: AiProviderId
  providers: Record<AiProviderId, AiProviderConfig>
  /** applies to every app; appended after the built-in system prompt via AgentLoop.systemSuffix */
  globalInstructions?: string
  /** per-app additions to the global instruction, keyed by app surface */
  perAppInstructions?: Partial<Record<AppSurface, string>>
  /**
   * Main→renderer only: whether a key is stored for each provider. The key
   * itself never leaves the main process, so this is the entire secret state
   * the Settings UI gets (it drives the "saved / not set" hint on the field).
   */
  apiKeyPresent?: Partial<Record<AiProviderId, boolean>>
}

export type AppSurface = 'docs' | 'sheets' | 'slides' | 'pdf'

/** pre-provider settings shape (single OpenAI-compatible endpoint); migrated into "custom" */
export interface LegacyAiSettings {
  baseUrl?: string
  apiKey?: string
  model?: string
}

export interface AiChatRequest {
  settings: AiSettings
  system: string
  user: string
}

export interface AiChatResponse {
  ok: boolean
  content?: string
  error?: string
}

export interface AiStreamRequest {
  requestId: string
  settings: AiSettings
  system: string
  messages: AgentMessage[]
  tools?: AgentToolDef[]
  maxTokens?: number
}

export interface AiStreamChunk {
  requestId: string
  /** 'ping' = wire-level keepalive so the renderer can tell a live stream from a dead one */
  type: 'delta' | 'tool-call' | 'done' | 'error' | 'ping'
  text?: string
  /** complete parsed tool call (emitted once its arguments finish streaming) */
  toolCall?: AgentToolCall
  error?: string
  /** machine-readable error cause ('timeout', exhausted 'credits'); lets the renderer localize the message */
  errorCode?: 'timeout' | 'credits'
  /** normalized stop reason carried on 'done' ('max_tokens' = output cut off by the token limit) */
  stopReason?: string
}
