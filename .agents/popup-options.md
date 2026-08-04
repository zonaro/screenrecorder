# Popup e Options

## Popup (popup/)

A interface principal da extensão. IIFE async.

### 3 telas

| Tela          | Descrição                                                        |
| ------------- | ---------------------------------------------------------------- |
| **Setup**     | Configuração antes da gravação (fonte, câmera, áudio, qualidade) |
| **Recording** | Em andamento (timer, botão parar)                                |
| **Result**    | Pós-gravação (download, editar, upload)                          |

### Presets de qualidade

| Preset     | FPS | Resolução | Bitrate  |
| ---------- | --- | --------- | -------- |
| `high`     | 30  | 1080p     | 8 Mbps   |
| `balanced` | 30  | 1080p     | 5 Mbps   |
| `compact`  | 30  | 720p      | 2.5 Mbps |

### Fluxo

1. Inicializa i18n
2. Carrega configurações do storage (camera, mic, format, preset, bitrate, etc.)
3. **Record** → envia `START_RECORDING` ao background
4. Escuta broadcasts: `TIMER_TICK`, `RECORDING_STOPPED`, `UPLOAD_PROGRESS`
5. **Stop** → envia `STOP_RECORDING`
6. **Result** → Download / Edit / Upload (Drive/OneDrive/YouTube) / New Recording

### Footer

O footer do popup contém dois links:
- **Minhas gravações** → abre `recordings.html` em nova aba
- **Configurações e conexões** → abre `options.html`

---

## Biblioteca de Gravações (popup/recordings.html)

Página dedicada para gerenciar todas as gravações salvas.

### Funcionalidades

| Ação | Descrição |
| --- | --- |
| **Listar** | Mostra todas as gravações salvas (mais recentes primeiro) com nome, data, tamanho e duração |
| **Baixar** | Faz download do vídeo via `chrome.downloads` |
| **Editar** | Abre o editor com a gravação selecionada |
| **Enviar** | Solicita o serviço (Drive/OneDrive/YouTube) e faz upload |
| **Excluir** | Remove a gravação do IndexedDB (com confirmação) |
| **Excluir todas** | Limpa toda a biblioteca (com confirmação) |

### Persistência

- Gravações são salvas automaticamente no IndexedDB quando a gravação para
- Sobrevive fechamento/reinício do navegador
- Limite de 50 gravações (evição automática das mais antigas)
- Blob URLs são criadas on-demand e revogadas após uso (sem memory leaks)

### Mensagens

| Mensagem | Descrição |
| --- | --- |
| `GET_ALL_RECORDINGS` | Retorna lista de metadados de todas as gravações |
| `GET_RECORDING` | Retorna gravação com blob URL para uma ação |
| `DELETE_RECORDING` | Remove uma gravação do IndexedDB |
| `DELETE_ALL_RECORDINGS` | Limpa todas as gravações |
| `SAVE_RECORDING` | Salva uma gravação manualmente (uso avançado) |

---

## Options (options/options.html)

Página de configurações da extensão.

### Seções

| Seção                   | Configurações                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Idioma**              | Seleciona idioma manual ou "auto" (default do browser)                                                       |
| **Permissões de mídia** | Botão para grant `getUserMedia({audio, video})` — necessário porque o offscreen não consegue mostrar prompts |
| **Conexões**            | Google (connect/disconnect), Microsoft/OneDrive (connect/disconnect), status visual                          |
| **Pastas**              | Google Drive folder ID, OneDrive folder path                                                                 |
| **YouTube**             | Privacidade (private/unlisted/public)                                                                        |