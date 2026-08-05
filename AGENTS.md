# Screen Recorder Pro — Convenções do Projeto

## Visão rápida

Extensão Chrome (Manifest V3) para gravação de tela com facecam, edição e exportação.
Vanilla JS puro — zero dependências, sem bundler.

## Arquitetura

```
popup.js → background.js (SW) → offscreen.js (MediaRecorder)
```

- **popup.js** — UI de controle (setup → recording → result)
- **background.js** — orquestração, estado, uploads, gerenciamento de janelas
- **offscreen.js** — gravação (MediaRecorder + canvas draw com setInterval)
- **editor/editor.js** — edição de vídeo (timeline multi-pista)
- **lib/*.js** — módulos IIFE globais (AUTH, UPLOAD, I18n, EXPORT, EditorCore)

## Convenções de código

- **IIFE modules** — cada módulo em `lib/` exporta um objeto global
- **Vanilla JS** — sem frameworks, sem transpilação
- **Chrome APIs** — `chrome.storage`, `chrome.runtime`, `chrome.identity`, `chrome.offscreen`
- **i18n** — `data-i18n` / `data-i18n-attr` no HTML, `I18n.t(key)` no JS
- **CSS vanilla** — um arquivo por componente (popup, editor, camera, options)

## Documentação detalhada

| Arquivo                    | Tema                                 |
| -------------------------- | ------------------------------------ |
| `.agents/architecture.md`  | Arquitetura, message passing, estado |
| `.agents/recording.md`     | Gravação, offscreen, MediaRecorder   |
| `.agents/camera.md`        | Facecam, Document PiP API            |
| `.agents/editor.md`        | Editor de vídeo, timeline, cortes    |
| `.agents/editor-core.md`   | Lógica pura do editor                |
| `.agents/export.md`        | Re-renderização e exportação         |
| `.agents/i18n.md`          | Internacionalização                  |
| `.agents/auth-upload.md`   | Autenticação e uploads               |
| `.agents/popup-options.md` | Popup e Options                      |
| `.agents/manifest.md`      | Manifest V3                          |
| `.agents/stack.md`         | Stack técnica completa               |