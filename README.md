# Screen Recorder Pro (Chrome Extension)

Gravador de tela estilo [Scre.io](https://app.scre.io/): grava tela cheia, abas ou programas,
facecam em janela flutuante, exportação **MP4/WebM** com controle de qualidade × tamanho,
editor simples (cortes, crop, pan/zoom, doodles e texto) e integração com
**Google Drive, OneDrive e YouTube**.

## Funcionalidades

- Gravação de tela cheia, janela (programa) ou aba
- Facecam em janela flutuante (arrastável), com opção de incluir a câmera no vídeo
- Áudio do sistema + microfone (mixados)
- Exportação MP4 ou WebM com presets de qualidade (Alta / Equilibrada / Compacta)
  e modo avançado (resolução, FPS e bitrate)
- Editor de vídeo com timeline multi-pista: cortes (trim/split/apagar), crop,
  pan & zoom (Ken Burns), rabiscos (doodles) e textos — cada item com sua própria
  linha do tempo e ordem de empilhamento
- Editor de legendas completo (criar, dividir, unir, sincronizar, importar) com
  exportação do vídeo + arquivo `.srt` / `.vtt`
- Upload para Google Drive, OneDrive e YouTube (uploads resumable)
- Interface em Inglês, Português (Brasil) e Espanhol

## Instalação (modo desenvolvedor)

1. Abra `chrome://extensions`
2. Ative o **Modo do desenvolvedor**
3. Clique em **Carregar sem compactação** e selecione a pasta do projeto
4. (Opcional) Adicione ícones `icons/icon16.png`, `icons/icon48.png`, `icons/icon128.png`
   e referencie-os no `manifest.json`

> Requer Chrome 126+ (para gravação MP4 nativa via MediaRecorder).

## Configuração das integrações

### Google Drive + YouTube
1. Em [Google Cloud Console](https://console.cloud.google.com/), crie um projeto
2. Ative as APIs: **Drive API** e **YouTube Data API v3**
3. Crie uma credencial **OAuth Client ID** (tipo "Web application")
4. No `manifest.json`, substitua `YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com`
   no bloco `oauth2.client_id`
5. Na página de opções da extensão, clique em **Conectar Google** e autorize

### OneDrive
1. Em [Azure Portal / App registrations](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps),
   crie um app (plataforma **Mobile and desktop applications**)
2. Adicione o redirect URI: `https://<SEU-EXTENSION-ID>.chromiumapp.org/onedrive`
   (o ID da extensão aparece em `chrome://extensions`)
3. Permissão delegada: `Files.ReadWrite`
4. Em `lib/auth.js`, substitua `YOUR_MICROSOFT_CLIENT_ID`
5. Na página de opções, clique em **Conectar OneDrive** e autorize

## Uso

1. Clique no ícone da extensão
2. Escolha a fonte (tela cheia / programa / aba), opções de câmera/áudio e qualidade
3. Clique em **Iniciar gravação** e selecione a fonte na janela do Chrome
4. Para parar, abra o popup e clique em **Parar**
5. Baixe, edite ou envie para Drive / OneDrive / YouTube

## Editor de vídeo

A timeline usa o **tempo do vídeo original** como escala: cada faixa fica alinhada
com o trecho que ela anota.

### Cortes

- **Dividir** parte o clipe sob o cursor em dois, e os dois ficam *colados*.
- Arrastar uma divisa do meio move o fim de um corte **e o início do outro ao
  mesmo tempo** (roll edit) — nunca aparece um buraco no meio do vídeo.
- Só as pontas são livres: o primeiro corte pode **começar depois** e o último
  pode **terminar antes**.
- **Apagar corte** remove aquele trecho do vídeo: o corte anterior passa a pular
  direto para o próximo, na prévia e na exportação.
- As alças coladas aparecem em âmbar; as livres, em branco. `Ctrl+Z` / `Ctrl+Shift+Z`
  desfazem e refazem.

### Textos e rabiscos

Cada texto ou rabisco ganha uma faixa própria, onde se arrasta o início, o fim e a
posição do item. As faixas são listadas da frente para trás — **▲**/**▼** mudam
qual item fica por cima do outro.

### Legendas

Legendas são escritas sobre o vídeo original e convertidas para o tempo final na
exportação: uma legenda dentro de um trecho apagado some, e uma legenda cortada ao
meio é aparada. Dá para importar `.srt`/`.vtt` (convertidos de volta para o tempo
original), dividir, unir, deslocar tudo para sincronizar, escolher estilo/posição e
opcionalmente **gravar as legendas no vídeo** (burn-in) além do arquivo separado.

## Observações técnicas

- A gravação roda em um *offscreen document* (requisito do Manifest V3)
- O arquivo mestre fica em memória enquanto a extensão estiver ativa;
  baixe/edite/envie logo após a gravação
- A exportação editada re-renderiza via canvas (aplica crop, pan/zoom e overlays)
  e re-encoda com o bitrate escolhido — o tempo de exportação ≈ duração do vídeo