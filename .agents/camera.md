# Facecam (camera/)

## Visão geral

A facecam é uma janela flutuante (arrastável) que mostra a câmera do usuário durante a gravação.

## Componentes

| Arquivo | Papel |
|---|---|
| `camera/camera.html` | Página da janela flutuante |
| `camera/camera.js` | Lógica principal da janela |
| `camera/camera-pip.js` | Executa dentro da janela PiP |
| `camera/camera.css` | Estilos |

## Funcionamento

- **camera.html/js:** aberta como `chrome.windows.create({type: 'popup'})`. Usa `getUserMedia({video: 1280x720})`. Botões: **Espelhar** e **Fechar**
- **Document PiP API:** se suportado, o botão "Start facecam" cria `documentPictureInPicture.requestWindow()` e move o `<video>` para lá. A janela host é minimizada
- **camera-pip.js:** copia estilos da janela host. Pode chamar `window.closeCamera()` (injetado pelo `camera.js`) para notificar o background

## Gerenciamento pelo background

- `openCamera()` / `closeCamera()` com `cameraWindowId`
- Escuta `onRemoved` para limpar o ID da janela