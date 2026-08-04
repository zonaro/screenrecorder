# Editor de Vídeo (editor/)

## Visão geral

Editor de vídeo completo no browser, com timeline multi-pista e diversas ferramentas de edição. O editor usa o **tempo do vídeo original** como escala — cada faixa fica alinhada com o trecho que ela anota.

## Componentes

| Arquivo              | Papel                           |
| -------------------- | ------------------------------- |
| `editor/editor.html` | Página do editor                |
| `editor/editor.js`   | Lógica principal (~800+ linhas) |
| `editor/editor.css`  | Estilos                         |

## Estado do editor

```js
state = {
    segments: [],         // cortes no vídeo original
    overlays: [],         // doodles/textos (ordem de pintura: último = topo)
    captions: [],         // legendas (criadas contra a timeline original)
    captionStyle: {...},  // estilo padrão das legendas
    currentTime: 0,
    playing: false,
    tool: 'select',       // ferramenta ativa
    liveStroke: null,
    cropDrag: null,
    selectedSegmentId: null,
    selectedOverlayId: null,
    selectedCueId: null,
    exportUrl: null,
    exportName: null,
    subsUrl: null,
    subsName: null
}
```

## Funcionalidades

### Cortes

- **Dividir (Split):** parte o clipe sob o cursor em dois, e os dois ficam *colados*
- Arrastar uma divisa do meio move o fim de um corte **e o início do outro ao mesmo tempo** (roll edit) — nunca aparece um buraco
- Só as pontas são livres: o primeiro corte pode **começar depois** e o último pode **terminar antes**
- **Apagar corte** remove aquele trecho: o corte anterior passa a pular direto para o próximo, na prévia e na exportação
- As alças coladas aparecem em âmbar; as livres, em branco

### Crop

Arrastar um retângulo no canvas para definir a área de recorte.

### Pan & Zoom (Ken Burns)

Keyframes `from` e `to` com interpolação linear. Cada segmento pode ter sua própria configuração de pan/zoom.

### Doodles (rabiscos)

Drawing no canvas, gravados com timestamp. Opção "animate" desenha progressivamente. Cada doodle ganha sua própria faixa na timeline.

### Textos

Overlay com cor, tamanho, bold, fonte e posição. Cada texto ganha sua própria faixa na timeline.

### Legendas

- Criação, divisão, união e sincronização de cues
- Importação de `.srt` / `.vtt`
- Conversão do tempo original para o tempo final na exportação
- Uma legenda dentro de um trecho apagado some
- Uma legenda cortada ao meio é aparada
- Opção de **gravar legendas no vídeo** (burn-in) além do arquivo separado
- Estilo configurável: tamanho, cor, fundo, posição, fonte

### Undo/Redo

Histórico com snapshot/restore (máx 60 estados). `Ctrl+Z` / `Ctrl+Shift+Z`.

### Playback

- Pula deletados via `enforcePlayback()`
- Playhead snap para boundaries de segmentos

## Timeline

- As faixas são listadas da frente para trás
- **▲**/**▼** mudam qual item fica por cima do outro
- Cada texto ou rabisco ganha uma faixa própria, onde se arrasta o início, o fim e a posição do item

## Inicialização

O editor recebe o vídeo via query string (`?src=...&name=...`), carrega metadata, cria o segmento inicial (0 → duração completa) e reconstrói a timeline.