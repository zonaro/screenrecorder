# Editor Core (lib/editor-core.js)

## Visão geral

Módulo de **lógica pura** (sem DOM) que implementa o modelo de timeline do editor. Exportado como IIFE global `EditorCore`.

## Constantes

- `EPS = 1e-4` — tolerância para comparações de tempo
- `LINK_EPS = 1e-3` — tolerância para considerar dois clips "colados" (glued)
- `MIN_SEG = 0.05` — duração mínima de um segmento

## Funções principais

### Modelo de timeline

Cada segmento holda **tempos da fonte** (source times). Os clips que sobrevivem são reproduzidos um após o outro, então cada tempo da fonte também tem um **tempo de saída** (output time).

```js
buildRegions(segments) → regions[]
```
Converte segmentos em regiões com `srcStart`, `srcEnd`, `outStart`, `outEnd`. Ignora segmentos com duração <= EPS.

```js
outputDuration(regions) → number
```
Retorna a duração total do vídeo de saída.

```js
mergeRegions(regions) → ranges[]
```
Junta clips adjacentes (glued clips) em runs contínuos para playback e exportação.

### Mapeamento de tempo

```js
srcToOut(regions, t) → number
```
Converte tempo da fonte → tempo de saída.

```js
outToSrc(regions, t) → number
```
Converte tempo de saída → tempo da fonte.

```js
snapToRegions(regions, t) → number
```
Encontra o tempo da fonte mais próximo que ainda existe na saída.

### Manipulação de segmentos

```js
trimSegment(segments, id, edge, t)
```
Recorta o início ou fim de um segmento.

```js
splitSegment(segments, id, t)
```
Divide um segmento em dois na posição `t`.

### Rendering helpers

```js
drawStroke(ctx, points, color, width)
```
Desenha um stroke no canvas.

```js
textMetrics(ctx, text, font, size)
```
Calcula métricas de texto para posicionamento.

```js
timecode(seconds) → string
```
Formata segundos como `HH:MM:SS.mmm`.

### Geometria

```js
sourceRectFor(segment, videoW, videoH, canvasW, canvasH)
```
Calcula o retângulo fonte considerando crop e pan/zoom.