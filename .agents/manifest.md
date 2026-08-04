# Manifest V3

## Configuração geral

| Campo                    | Valor             |
| ------------------------ | ----------------- |
| `manifest_version`       | 3                 |
| `name`                   | `__MSG_extName__` |
| `version`                | `1.0.0`           |
| `minimum_chrome_version` | 126               |
| `default_locale`         | en                |

## Background

```json
"background": { "service_worker": "background.js" }
```

## Popup e Options

```json
"action": { "default_popup": "popup/popup.html", "default_title": "__MSG_extName__" }
"options_page": "options/options.html"
```

## Permissões

| Permissão          | Uso                                         |
| ------------------ | ------------------------------------------- |
| `offscreen`        | Criar offscreen document para MediaRecorder |
| `storage`          | Persistir estado e configurações            |
| `unlimitedStorage` | Armazenar gravações                         |
| `downloads`        | Salvar arquivo local                        |
| `identity`         | OAuth Google/Microsoft                      |
| `notifications`    | Upload concluído/falhou                     |

## Host Permissions

```
https://www.googleapis.com/*
https://accounts.google.com/*
https://login.microsoftonline.com/*
https://graph.microsoft.com/*
```

## Comandos

```json
"toggle-recording": { "suggested_key": { "default": "Alt+Shift+R" } }
```

## Content Security Policy

```
script-src 'self'; object-src 'self'; media-src 'self' blob:; connect-src 'self' blob: https://www.googleapis.com https://accounts.google.com https://login.microsoftonline.com https://graph.microsoft.com
```

## OAuth2 (Google)

```json
"oauth2": {
    "client_id": "YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com",
    "scopes": ["https://www.googleapis.com/auth/drive.file", "https://www.googleapis.com/auth/youtube.upload"]
}
```