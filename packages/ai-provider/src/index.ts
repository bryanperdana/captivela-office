export type {
  AiChatRequest,
  AiChatResponse,
  AiImageGenerationSettings,
  AiProviderConfig,
  AiProviderId,
  AiProviderMeta,
  AiSettings,
  AiStreamChunk,
  AiStreamRequest,
  AppSurface,
  GenSparkAccountStatus,
  LegacyAiSettings,
} from './types'
export {
  AI_PROVIDERS,
  BYOK_PRESET_IDS,
  GENSPARK_LLM_BASE_URLS,
  PROVIDER_META_BY_ID,
  defaultAiSettings,
  resolveAiSettings,
} from './providers'
export { GENSPARK_CLOUD_ENABLED, PRODUCT_NAME } from './byok'
export {
  AI_SETTINGS_LIMITS,
  APP_SURFACES,
  REDACTED,
  composeSystemSuffix,
  isLoopbackHost,
  redactAiSettings,
  redactSecrets,
  sanitizeAiSettingsForRenderer,
  validateAiSettings,
  validateBaseUrl,
} from './settings'
export type { Validated } from './settings'
export { TOOL_CALL_PROBE, classifyProviderError, testConnection, testToolCalling } from './compat'
export type {
  AiCheckFailureKind,
  AiCheckOptions,
  AiCheckRequest,
  AiCheckResult,
  AiSettingsSaveResult,
} from './compat'
export { chatForProvider } from './chat'
export { AiCreditsError, sseLines, streamForProvider } from './stream'
export type { StreamCallbacks } from './stream'
export {
  AI_CHAT_RESPONSE_TIMEOUT_MS,
  AI_CONNECT_TIMEOUT_MS,
  AI_IDLE_TIMEOUT_MS,
  AiTimeoutError,
  createStreamWatchdog,
} from './watchdog'
export type { StreamWatchdog } from './watchdog'
export {
  IMAGE_GENERATION_LIMITS,
  ImageGenerationError,
  classifyImageGenerationError,
  generateImage,
  normalizeImageGenerationEndpoint,
  testImageGenerationCapability,
  validateImageGenerationConfig,
  validateImageGenerationProvider,
  validateImageGenerationRequest,
} from './image-generation'
export type {
  GeneratedImageFormat,
  GeneratedImageSize,
  ImageGenerationCapabilityFailureKind,
  ImageGenerationCapabilityResult,
  ImageGenerationConfig,
  ImageGenerationErrorKind,
  ImageGenerationOptions,
  ImageGenerationPayload,
  ImageGenerationProtocol,
  ImageGenerationProvider,
  ImageGenerationRequest,
} from './image-generation'
