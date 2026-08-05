// lib/upload.js
const UPLOAD = (() => {
    const CHUNK = 8 * 1024 * 1024; // 8 MB

    async function uploadResumable(url, token, blob, mime, onProgress, extra) {
        extra = extra || {};
        const init = await fetch(url, {
            method: 'POST',
            headers: {
                Authorization: 'Bearer ' + token,
                'Content-Type': 'application/json; charset=UTF-8',
                'X-Upload-Content-Type': mime,
                'X-Upload-Content-Length': String(blob.size)
            },
            body: extra._body || '{}'
        });
        const location = init.headers.get('Location');
        if (!location) throw new Error('Upload session not created (HTTP ' + init.status + ')');
        let offset = 0;
        while (offset < blob.size) {
            const end = Math.min(offset + CHUNK, blob.size);
            const chunk = blob.slice(offset, end);
            const r = await fetch(location, {
                method: 'PUT',
                headers: { 'Content-Range': 'bytes ' + offset + '-' + (end - 1) + '/' + blob.size, 'Content-Type': mime },
                body: chunk
            });
            if (r.status === 308) {
                offset = end;
                if (onProgress) onProgress(offset / blob.size);
                continue;
            }
            if (r.status >= 200 && r.status < 300) {
                if (onProgress) onProgress(1);
                return await r.json();
            }
            throw new Error('Upload failed: HTTP ' + r.status);
        }
    }

    async function driveUpload(token, blob, name, mime, folderId, onProgress) {
        const meta = { name: name, mimeType: mime };
        if (folderId) meta.parents = [folderId];
        const url = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable';
        return uploadResumable(url, token, blob, mime, onProgress, { _body: JSON.stringify(meta) });
    }

    async function youtubeUpload(token, blob, opts, onProgress) {
        const meta = {
            snippet: { title: opts.title, description: opts.description || '' },
            status: { privacyStatus: opts.privacyStatus || 'private' }
        };
        const url = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';
        return uploadResumable(url, token, blob, 'video/mp4', onProgress, { _body: JSON.stringify(meta) });
    }

    async function oneDriveUpload(accessToken, blob, name, folderPath, onProgress) {
        const clean = (folderPath || '').replace(/^\/+|\/+$/g, '');
        const path = (clean ? clean + '/' : '') + name;
        const sessionUrl = 'https://graph.microsoft.com/v1.0/me/drive/root:/' + path + ':/createUploadSession';
        const sr = await fetch(sessionUrl, {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
            body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'rename' } })
        });
        const session = await sr.json();
        if (!session.uploadUrl) throw new Error('OneDrive session failed');
        let offset = 0;
        while (offset < blob.size) {
            const end = Math.min(offset + CHUNK, blob.size);
            const r = await fetch(session.uploadUrl, {
                method: 'PUT',
                headers: {
                    'Content-Range': 'bytes ' + offset + '-' + (end - 1) + '/' + blob.size,
                    'Content-Length': String(end - offset)
                },
                body: blob.slice(offset, end)
            });
            if (r.status === 202) {
                offset = end;
                if (onProgress) onProgress(offset / blob.size);
                continue;
            }
            if (r.status === 200 || r.status === 201) {
                if (onProgress) onProgress(1);
                return await r.json();
            }
            throw new Error('OneDrive upload failed: HTTP ' + r.status);
        }
    }

    return { driveUpload, youtubeUpload, oneDriveUpload };
})();