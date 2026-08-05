# Facecam (camera/)

## Visão geral

A facecam abre diretamente como **Document Picture-in-Picture** — sem janela popup intermediária. Um único checkbox no popup ativa tudo: preview PiP + inclusão na gravação.

## Componentes

| Arquivo                  | Papel                                                      |
| ------------------------ | ---------------------------------------------------------- |
| `camera/camera-pip.html` | Página carregada dentro da janela PiP                      |
| `camera/camera-pip.js`   | Lógica completa: inicia câmera, mirror, close, escuta stop |
| `camera/camera.css`      | Estilos (apenas modo PiP)                                  |

## Funcionamento

- **popup.js** chama `documentPictureInPicture.requestWindow()` direto no clique do Record (tem user gesture). Navega a janela PiP para `camera/camera-pip.html`.
- **camera-pip.js** auto-inicia `getUserMedia({video: 1280x720})` ao carregar. Botões: **Espelhar** (toggle `.mirrored`) e **Fechar** (`window.close()` + parar stream).
- **Sincronização com gravação:** o popup seta `chrome.storage.local.cameraPipActive = true` ao iniciar e `= false` ao parar. O `camera-pip.js` escuta `chrome.storage.onChanged` e fecha o PiP automaticamente quando a gravação termina.
- **Facecam na gravação:** `offscreen.js` usa `msg.withCamera` (mesmo flag do checkbox único) para capturar `getUserMedia({video: 640x480})` e desenhar o overlay no canvas (22% da largura, canto inferior direito). Streams de preview (PiP) e gravação (offscreen) são independentes.

## Fluxo

```
popup.js (Record click)
  │
  ├─▶ chrome.runtime.sendMessage({ type: 'START_RECORDING', withCamera: true }) → background.js → offscreen.js
  │     └─▶ offscreen.js: withCameraInRecording = true → getUserMedia → draw no canvas
  │
  └─▶ documentPictureInPicture.requestWindow() → pipWin.location = 'camera/camera-pip.html'
        └─▶ camera-pip.js: getUserMedia → exibe facecam no PiP
              └─▶ chrome.storage.onChanged → fecha PiP quando cameraPipActive = false

popup.js (Stop click)
  └─▶ chrome.storage.local.set({ cameraPipActive: false }) → PiP fecha automaticamente
```

## Fallback

Se `documentPictureInPicture` não existir no browser, o PiP não abre — a gravação continua normalmente sem preview da facecam (apenas com o overlay no vídeo final, se `withCamera=true`).