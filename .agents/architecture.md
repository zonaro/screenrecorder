# Arquitetura

## Visão geral

**Screen Recorder Pro** é uma extensão Chrome **Manifest V3** que grava tela com facecam, edita o vídeo e exporta para serviços cloud (Google Drive, OneDrive, YouTube). O projeto é **vanilla JavaScript puro** — sem bundler, sem frameworks, sem dependências externas.

A arquitetura é baseada em **message passing** entre contextos isolados:

```
┌──────────────┐  chrome.runtime.sendMessage()  ┌──────────────┐
│   popup.js   │ ───────────────────────────────▶│ background.js│
│  (UI popup)  │ ◀─────── response ──────────────│ (SW orch.)   │
└──────────────┘                                 └──────┬───────┘
                                                        │
                                          chrome.runtime.sendMessage()
                                                        │
                                                  ┌─────▼────────┐
                                                  │ offscreen.js │
                                                  │ (MediaRecorder│
                                                  │  canvas draw) │
                                                  └──────────────┘
```

## Contextos isolados

| Contexto           | Arquivo                | Responsabilidade                                               |
| ------------------ | ---------------------- | -------------------------------------------------------------- |
| Service Worker     | `background.js`        | Orquestração, estado global, uploads, gerenciamento de janelas |
| Offscreen document | `offscreen.js`         | Gravação (MediaRecorder + canvas draw)                         |
| Popup              | `popup/popup.js`       | UI de controle (setup → recording → result)                    |
| Options            | `options/options.js`   | Configurações, idioma, conexões OAuth                          |
| Editor             | `editor/editor.js`     | Edição de vídeo (timeline, cortes, overlays)                   |
| Camera             | `camera/camera-pip.js` | Facecam em Document Picture-in-Picture                         |

## Fluxo de gravação

1. **Popup** envia `START_RECORDING` ao **background** (service worker)
2. **Background** garante o offscreen document via `chrome.offscreen` e reenvia `START` com as configurações
3. **Offscreen** abre o picker (`getDisplayMedia`), captura tela + áudio, desenha no canvas via `setInterval` (não `requestAnimationFrame`, pois o offscreen não renderiza), grava com `MediaRecorder`
4. **Offscreen** envia `TIMER_TICK` e `RECORDING_STOPPED` de volta ao background, que atualiza `chrome.storage.local`
5. **Popup** escuta broadcasts e atualiza a UI

## Estado persistente

- `chrome.storage.session` — `recActive` / `recStartTime` (sobrevive a restarts do service worker)
- `chrome.storage.local` — `lastRecording`, configurações, tokens OAuth
- **IndexedDB** (`screenrecorder-db`) — armazena blobs de vídeo das gravações (sobrevive fechamento do navegador)
  - Object store: `recordings` com schema `{ id, name, blob, size, duration, mime, ext, createdAt }`
  - Limite de 50 gravações (evição automática das mais antigas)
  - Acesse via `RecordingsDB` (wrapper em `lib/recordings-db.js`)

## Mensagens com timeout

`sendToOffscreen()` implementa `Promise.race` com timeout de 8s (ou `timeoutMs=0` para o source picker, que bloqueia indefinidamente).

## Módulos em `lib/`

| Módulo                 | Responsabilidade                                                       |
| ---------------------- | ---------------------------------------------------------------------- |
| `lib/auth.js`          | Autenticação Google (chrome.identity) e Microsoft (PKCE)               |
| `lib/editor-core.js`   | Lógica pura do editor (sem DOM)                                        |
| `lib/export.js`        | Re-renderização via canvas + MediaRecorder                             |
| `lib/i18n.js`          | Internacionalização                                                    |
| `lib/recordings-db.js` | Wrapper IndexedDB para persistência de gravações (CRUD + limite de 50) |
| `lib/upload.js`        | Uploads resumable (Drive, YouTube, OneDrive)                           |

## Instalação (modo desenvolvedor)

1. Abra `chrome://extensions`
2. Ative o **Modo do desenvolvedor**
3. Clique em **Carregar sem compactação** e selecione a pasta do projeto

> Requer Chrome 126+ (para gravação MP4 nativa via MediaRecorder).

## Configuração das integrações

### Google Drive + YouTube

1. Em [Google Cloud Console](https://console.cloud.google.com/), crie um projeto
2. Ative as APIs: **Drive API** e **YouTube Data API v3**
3. Crie uma credencial **OAuth Client ID** (tipo "Web application")
4. No `manifest.json`, substitua `YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com` no bloco `oauth2.client_id`
5. Na página de opções da extensão, clique em **Conectar Google** e autorize

### OneDrive

1. Em [Azure Portal / App registrations](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps), crie um app (plataforma **Mobile and desktop applications**)
2. Adicione o redirect URI: `https://<SEU-EXTENSION-ID>.chromiumapp.org/onedrive` (o ID da extensão aparece em `chrome://extensions`)
3. Permissão delegada: `Files.ReadWrite`
4. Em `lib/auth.js`, substitua `YOUR_MICROSOFT_CLIENT_ID`
5. Na página de opções, clique em **Conectar OneDrive** e autorize

## Uso

1. Clique no ícone da extensão
2. Escolha a fonte (tela cheia / programa / aba), opções de câmera/áudio e qualidade
3. Clique em **Iniciar gravação** e selecione a fonte na janela do Chrome
4. Para parar, abra o popup e clique em **Parar**
5. Baixe, edite ou envie para Drive / OneDrive / YouTube