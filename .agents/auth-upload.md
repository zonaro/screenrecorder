# Autenticação e Upload

## Autenticação (lib/auth.js)

Módulo IIFE global `AUTH` com suporte a Google e Microsoft.

### Google

- Usa `chrome.identity.getAuthToken()` (built-in Chrome)
- `connectGoogle()` — fluxo interativo, busca userinfo
- `disconnectGoogle()` — revoga token e remove do storage
- Scopes: `drive.file` + `youtube.upload`

### Microsoft (OneDrive)

- Auth code flow com **PKCE** (Proof Key for Code Exchange)
- `connectMicrosoft()` — `launchWebAuthFlow()` → code → token exchange → refresh token
- `msAccessToken()` — renova automaticamente se expirado
- Scopes: `offline_access files.readwrite User.Read`
- Redirect URI: `chrome.identity.getRedirectURL('onedrive')`

### Configuração

- Google: substituir `YOUR_GOOGLE_CLIENT_ID` no `manifest.json` (bloco `oauth2.client_id`)
- Microsoft: substituir `YOUR_MICROSOFT_CLIENT_ID` no `lib/auth.js`

---

## Upload (lib/upload.js)

Módulo IIFE global `UPLOAD` com uploads resumable.

### uploadResumable(url, token, blob, mime, onProgress, extra)

Função comum de upload resumable em chunks de **8MB**:

1. POST para criar a sessão de upload
2. PUT em loop com `Content-Range` header
3. Retorna JSON ao completar

### Google Drive

```js
UPLOAD.driveUpload(token, blob, name, mime, folderId, onProgress)
```
- Endpoint: `googleapis.com/upload/drive/v3/files?uploadType=resumable`
- Suporta pasta destino via `folderId`

### YouTube

```js
UPLOAD.youtubeUpload(token, blob, opts, onProgress)
```
- Endpoint: `googleapis.com/upload/youtube/v3/videos`
- Opções: `title`, `description`, `privacyStatus`
- Força MIME `video/mp4`

### OneDrive

```js
UPLOAD.oneDriveUpload(accessToken, blob, name, folderPath, onProgress)
```
- Endpoint: `graph.microsoft.com/v1.0/me/drive/root:/{path}:/createUploadSession`
- Suporta pasta via `folderPath`
- Conflito: `@microsoft.graph.conflictBehavior: 'rename'`