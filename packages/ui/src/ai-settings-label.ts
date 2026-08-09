import type { Lang } from '@genoffice/i18n'

/**
 * "AI Settings" in every UI language — the label of the entry point (the gear
 * in each AI panel header, the shell's account menu row) and the dialog's own
 * title.
 *
 * It lives here rather than in the four app dictionaries for the same reason
 * the menu labels live in @genoffice/electron-utils: one shared table instead
 * of the same key copied into four apps × 19 languages.
 *
 * The dialog's field labels stay English on purpose — base URL, API key and
 * model id are the vocabulary of the provider documentation the user is
 * copying from, and that documentation is English everywhere.
 */
const AI_SETTINGS_LABELS: Record<Lang, string> = {
  zh: 'AI 设置',
  en: 'AI Settings',
  ja: 'AI 設定',
  ko: 'AI 설정',
  fr: 'Paramètres IA',
  de: 'KI-Einstellungen',
  es: 'Ajustes de IA',
  th: 'การตั้งค่า AI',
  id: 'Pengaturan AI',
  ru: 'Настройки ИИ',
  ar: 'إعدادات الذكاء الاصطناعي',
  pt: 'Configurações de IA',
  it: 'Impostazioni IA',
  pl: 'Ustawienia AI',
  nl: 'AI-instellingen',
  ms: 'Tetapan AI',
  he: 'הגדרות AI',
  hi: 'AI सेटिंग्स',
  'zh-TW': 'AI 設定',
}

export function aiSettingsLabel(lang: Lang): string {
  return AI_SETTINGS_LABELS[lang] ?? AI_SETTINGS_LABELS.en
}
