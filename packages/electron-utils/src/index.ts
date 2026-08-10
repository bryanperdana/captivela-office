export {
  buildContextMenuItems,
  contextMenuLabels,
  installContextMenu,
  type ContextMenuItem,
  type ContextMenuLabels,
} from './context-menu'
export {
  appMenuLabels,
  editMenuTemplate,
  viewMenuTemplate,
  windowMenuTemplate,
  type AppMenuLabels,
} from './app-menu'
export { installNavigationGuard } from './navigation-guard'
export { safeExternalUrl, type SafeExternalUrlOptions } from './safe-external-url'
export {
  fetchWithSsrfGuard,
  isBlockedAddress,
  isSafeRemoteUrl,
  type FetchWithSsrfGuardOptions,
} from './safe-remote-url'
export { fetchRemoteImage, remoteImageHeaders } from './remote-image'
export { createAiSettingsStore } from './ai-settings-store'
export type { AiSettingsStore, AiSettingsStoreOptions, SecretCipher } from './ai-settings-store'
export {
  clearApiKeyFromRenderer,
  getSettingsForRenderer,
  redactRequestError,
  resolveRequestConfig,
  runConnectionCheck,
  runImageGenerationCheck,
  runToolCallingCheck,
  setSettingsFromRenderer,
} from './ai-ipc-core'
export type { IpcResult } from './ai-ipc-core'
export {
  CAPTIVELA_DEV_USER_DATA_DIRNAME,
  CAPTIVELA_DOCUMENTS_DIRNAME,
  CAPTIVELA_PRODUCT_NAME,
  LEGACY_DOCUMENTS_DIRNAME,
  ensureProductDocumentsDir,
  legacyDocumentsDir,
  migrateLegacyDirectory,
  productDevUserDataDir,
  productDocumentsDir,
  readProductEnvironment,
  type ProductEnvironment,
} from './product-paths'
