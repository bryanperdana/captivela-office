/**
 * Styles for AiSettingsDialog, shipped as a string and injected once at mount.
 *
 * The other components in this package are themed by each app's own stylesheet
 * via shared class names. The settings dialog is different: it is one dialog
 * that must look the same in four apps whose stylesheets share nothing, so it
 * carries its own. Colours come from neutral literals plus a dark variant, so
 * it reads correctly against every app's chrome without app-specific tokens.
 */
export const AI_SETTINGS_DIALOG_CSS = `
.byok-settings-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(15, 18, 24, 0.42);
  font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
  color: #1c1f24;
}
.byok-settings {
  display: flex;
  flex-direction: column;
  width: min(560px, calc(100vw - 32px));
  max-height: calc(100vh - 64px);
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.28);
  overflow: hidden;
}
.byok-settings-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 10px;
  border-bottom: 1px solid #e6e8ec;
}
.byok-settings-head h2 { margin: 0; font-size: 15px; font-weight: 600; }
.byok-settings-close {
  border: 0;
  background: none;
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
  color: #6b7280;
  padding: 0 4px;
}
.byok-settings-close:hover { color: #1c1f24; }
.byok-settings-body {
  padding: 14px 16px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.byok-settings-loading { color: #6b7280; }
.byok-field { display: flex; flex-direction: column; gap: 4px; }
.byok-field-label { font-weight: 600; font-size: 12px; }
.byok-field-hint { font-size: 11px; color: #6b7280; }
.byok-field-row { display: flex; gap: 6px; align-items: center; }
.byok-field-row input { flex: 1; }
.byok-settings input,
.byok-settings select,
.byok-settings textarea {
  font: inherit;
  color: inherit;
  background: #fff;
  border: 1px solid #cfd4dc;
  border-radius: 6px;
  padding: 6px 8px;
  width: 100%;
  box-sizing: border-box;
}
.byok-settings textarea { resize: vertical; min-height: 56px; }
.byok-settings input:focus,
.byok-settings select:focus,
.byok-settings textarea:focus { outline: 2px solid #3b82f6; outline-offset: -1px; }
.byok-checks { display: flex; gap: 8px; flex-wrap: wrap; }
.byok-btn {
  font: inherit;
  padding: 6px 12px;
  border-radius: 6px;
  border: 1px solid #cfd4dc;
  background: #f7f8fa;
  cursor: pointer;
  white-space: nowrap;
}
.byok-btn:hover:not(:disabled) { background: #eef0f4; }
.byok-btn:disabled { opacity: 0.55; cursor: default; }
.byok-btn-primary { background: #2563eb; border-color: #2563eb; color: #fff; }
.byok-btn-primary:hover:not(:disabled) { background: #1d4ed8; }
.byok-btn-quiet { background: transparent; }
.byok-check-report {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid #cfd4dc;
  background: #f7f8fa;
}
.byok-check-report.ok { border-color: #86c79b; background: #f1f9f4; }
.byok-check-report.fail { border-color: #e2a1a1; background: #fdf3f3; }
.byok-check-title { font-weight: 600; font-size: 12px; }
.byok-check-detail { font-size: 11px; color: #4b5563; word-break: break-word; }
.byok-section { display: flex; flex-direction: column; gap: 10px; }
.byok-section-title {
  font-weight: 600;
  font-size: 12px;
  padding-top: 4px;
  border-top: 1px solid #e6e8ec;
}
.byok-tabs { display: flex; gap: 4px; }
.byok-tab {
  font: inherit;
  font-size: 12px;
  padding: 3px 9px;
  border-radius: 999px;
  border: 1px solid #cfd4dc;
  background: transparent;
  cursor: pointer;
}
.byok-tab.active { background: #e8eefc; border-color: #9dbcf5; }
.byok-settings-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: flex-end;
  padding: 10px 16px 14px;
  border-top: 1px solid #e6e8ec;
}
.byok-foot-msg { margin-right: auto; font-size: 12px; color: #4b5563; }
.byok-error { color: #b42318; }

@media (prefers-color-scheme: dark) {
  .byok-settings-backdrop { color: #e6e8ec; }
  .byok-settings { background: #1f2229; box-shadow: 0 16px 48px rgba(0, 0, 0, 0.55); }
  .byok-settings-head, .byok-settings-foot, .byok-section-title { border-color: #343842; }
  .byok-settings-close { color: #9aa1ac; }
  .byok-settings-close:hover { color: #e6e8ec; }
  .byok-settings input,
  .byok-settings select,
  .byok-settings textarea { background: #171a20; border-color: #3a3f4a; }
  .byok-field-hint, .byok-foot-msg, .byok-check-detail { color: #9aa1ac; }
  .byok-btn { background: #262a32; border-color: #3a3f4a; }
  .byok-btn:hover:not(:disabled) { background: #2f343d; }
  .byok-btn-primary { background: #2563eb; border-color: #2563eb; }
  .byok-check-report { background: #22262e; border-color: #3a3f4a; }
  .byok-check-report.ok { border-color: #2f6f47; background: #1b2b21; }
  .byok-check-report.fail { border-color: #8a3b3b; background: #2b1d1d; }
  .byok-tab { border-color: #3a3f4a; }
  .byok-tab.active { background: #263354; border-color: #3f5a9c; }
  .byok-error { color: #f2a2a2; }
}
`
