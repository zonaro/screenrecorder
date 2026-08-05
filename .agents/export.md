# Exportação (lib/export.js)

## Visão geral

Módulo de re-renderização via canvas + MediaRecorder. Exportado como IIFE global `EXPORT`.

## Fluxo de exportação

1. Percorre as **regions** (merged runs de vídeo sobrevivente)
2. Faz `seek` no vídeo para o início de cada region
3. Desenha cada frame no canvas (com crop, pan/zoom e overlays)
4. Grava o stream do canvas com `MediaRecorder`
5. Retorna o `Blob` final

## Função principal

```js
EXPORT.render(opts) → Blob
```

### Parâmetros

| Parâmetro       | Tipo              | Descrição                                 |
| --------------- | ----------------- | ----------------------------------------- |
| `video`         | HTMLVideoElement  | Vídeo fonte                               |
| `canvas`        | HTMLCanvasElement | Canvas de renderização                    |
| `regions`       | Array             | Regiões merged (do editor-core)           |
| `fps`           | number            | Frames por segundo                        |
| `format`        | string            | `'mp4'` ou `'webm'`                       |
| `vbps`          | number            | Bitrate de vídeo                          |
| `abps`          | number            | Bitrate de áudio                          |
| `drawFrame`     | Function          | Callback que desenha cada frame no canvas |
| `onProgress`    | Function          | Callback de progresso (0 → 1)             |
| `totalDuration` | number            | Duração total do vídeo de saída           |

## Detalhes técnicos

- **MIME type:** `pickMime(format)` testa codecs em ordem de preferência:
  - MP4: `avc1.42E01E,mp4a.40.2` → fallback `video/mp4`
  - WebM: `vp9,opus` → `vp8,opus` → fallback `video/webm`
- **Stream:** combina `canvas.captureStream(fps)` (vídeo) com `video.captureStream()` (áudio)
- **Seek assíncrono:** espera até que o playback realmente atinja a região antes de desenhar (evita frames de partes deletadas)
- **Timing:** usa `requestAnimationFrame` para sincronizar draw com playback
- **Áudio:** incluído apenas se o vídeo fonte tiver tracks de áudio capturáveis

## Observações

- O tempo de exportação ≈ duração do vídeo
- A re-renderização aplica crop, pan/zoom e overlays sobre cada frame
- O bitrate final é controlado pelas configurações de preset/avançado