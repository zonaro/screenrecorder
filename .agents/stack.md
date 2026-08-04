# Stack Técnica

## Tecnologias

| Componente | Tecnologia                                                         |
| ---------- | ------------------------------------------------------------------ |
| Plataforma | Chrome Extension **Manifest V3**                                   |
| Gravação   | `MediaRecorder` API (MP4 nativo Chrome 126+)                       |
| Canvas     | `setInterval` (offscreen), `requestAnimationFrame` (editor/export) |
| Áudio      | `AudioContext` + `MediaStreamDestination` (mix system+mic)         |
| Câmera     | `getUserMedia` + **Document Picture-in-Picture API**               |
| Auth       | `chrome.identity` (Google), `launchWebAuthFlow` + PKCE (Microsoft) |
| Upload     | Fetch API com chunks de 8MB, resumable uploads                     |
| Storage    | `chrome.storage.local` + `chrome.storage.session` + **IndexedDB** |
| Build      | **Zero** — sem bundler, sem frameworks, vanilla JS puro            |
| i18n       | Custom lib + `chrome.i18n` + `_locales/`                           |
| CSS        | 4 arquivos vanilla CSS (popup, editor, camera, options)            |

## O que NÃO existe

- Sem `package.json`
- Sem `node_modules`
- Sem bundler (Webpack, Vite, etc.)
- Sem framework (React, Vue, etc.)
- Sem testes automatizados
- Sem linting configurado
- Sem AGENTS.md ou .instructions.md (antes desta reorganização)

## Decisões de arquitetura

- **Vanilla JS puro** — zero dependências, máxima compatibilidade
- **IIFE modules** — cada `lib/*.js` exporta um objeto global (`AUTH`, `UPLOAD`, `I18n`, `EXPORT`, `EditorCore`)
- **Message passing** — comunicação entre contextos via `chrome.runtime.sendMessage`
- **Offscreen document** — necessário para MediaRecorder no Manifest V3
- **Canvas draw loop com setInterval** — `requestAnimationFrame` não dispara em offscreen
- **Uploads resumable** — chunks de 8MB para arquivos grandes
- **PKCE para Microsoft** — fluxo seguro sem client secret

## APIs Chrome utilizadas

- `chrome.offscreen` — criar offscreen document
- `chrome.storage.local` / `chrome.storage.session` — persistência de configurações e estado
- `chrome.downloads` — salvar arquivo
- `chrome.identity` — OAuth
- `chrome.windows` — janela da facecam
- `chrome.runtime` — message passing e service worker lifecycle
- `chrome.i18n` — traduções nativas
- **IndexedDB** — persistência de blobs de vídeo (Biblioteca de Gravações)