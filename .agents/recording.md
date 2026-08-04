# Gravação (offscreen.js)

## Visão geral

A gravação roda em um **offscreen document** (requisito do Manifest V3). O `offscreen.js` é o coração da captura.

## Fluxo de captura

1. **Captura:** `getDisplayMedia()` com opção de áudio do sistema (`systemAudio: 'include'`)
2. **Resolução:** se a resolução escolhida ≠ original, escala proporcionalmente (ex: 1080p → `vh=1080`)
3. **Áudio:** `AudioContext` + `MediaStreamDestination` — mixa áudio do sistema + microfone via `createMediaStreamSource().connect(dest)`
4. **Câmera:** se `withCamera && includeCamera`, captura `getUserMedia({video: 640x480})` e desenha como PiP no canvas (canto inferior direito, 22% da largura)
5. **Canvas draw loop:** usa `setInterval` (não `requestAnimationFrame`, que não dispara em offscreen)
6. **MediaRecorder:** suporta MP4 (Chrome 126+) e WebM (VP9/VP8 fallback). Chunks a cada 1s
7. **Fim:** `onstop` cria `Blob`, gera `blobUrl` via `URL.createObjectURL()`, envia `RECORDING_STOPPED`

## Cadeia de fallback

Se `getUserMedia` de microfone/câmera falhar (permissão não concedida na página visível), grava só com tela — retorna warnings como códigos i18n.

## Persistência automática

Após o `RECORDING_STOPPED`, o background automaticamente:
1. Salva os metadados no `chrome.storage.local` (fluxo existente)
2. Baixa o blob via `fetch(blobUrl)` e salva no **IndexedDB** via `RecordingsDB.save()`
3. A gravação fica acessível na Biblioteca de Gravações mesmo após fechar o navegador

## Observações

- O blob fica em memória apenas durante a sessão atual, mas é persistido no IndexedDB para acesso futuro
- Requer Chrome 126+ para gravação MP4 nativa via MediaRecorder
- O offscreen document libera todos os recursos de captura imediatamente após a criação do blob (`cleanup()`)