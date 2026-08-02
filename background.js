// background.js - service worker: orchestration, auth and uploads.
importScripts('lib/auth.js', 'lib/upload.js');

const recording = { active: false, startTime: 0, stopResolve: null };
let cameraWindowId = null;

const NOTIF_ICON = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC';

function stamp() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
        '_' + p(d.getHours()) + '-' + p(d.getMinutes()) + '-' + p(d.getSeconds());
}

function notify(title, message) {
    try {
        chrome.notifications.create({
            type: 'basic', iconUrl: NOTIF_ICON, title: title, message: message
        });
    } catch (e) { }
}

async function ensureOffscreen() {
    const has = await chrome.offscreen.hasDocument();
    if (!has) {
        await chrome.offscreen.createDocument({
            url: 'offscreen.html',
            reasons: ['DISPLAY_MEDIA'],
            justification: 'Screen recording'
        });
    }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    handleMessage(msg)
        .then(sendResponse)
        .catch(e => sendResponse({ ok: false, error: e && e.message ? e.message : String(e) }));
    return true;
});

async function handleMessage(msg) {
    switch (msg.type) {
        case 'START_RECORDING': {
            if (recording.active) return { ok: false, error: 'Already recording' };
            await ensureOffscreen();
            recording.active = true;
            recording.startTime = Date.now();
            chrome.action.setBadgeText({ text: 'REC' });
            chrome.action.setBadgeBackgroundColor({ color: '#e53935' });
            await chrome.runtime.sendMessage({ type: 'START', streamId: msg.streamId, format: msg.format, resolution: msg.resolution, fps: msg.fps, videoBitsPerSecond: msg.videoBitsPerSecond, audioBitsPerSecond: msg.audioBitsPerSecond, withCamera: msg.withCamera, includeCamera: msg.includeCamera, withMic: msg.withMic, withSystemAudio: msg.withSystemAudio });
            return { ok: true };
        }
        case 'STOP_RECORDING': {
            if (!recording.active) return { ok: false, error: 'Not recording' };
            const stopped = new Promise((resolve) => { recording.stopResolve = resolve; });
            await chrome.runtime.sendMessage({ type: 'STOP' });
            const info = await stopped;
            recording.active = false;
            chrome.action.setBadgeText({ text: '' });
            return { ok: true, info: info };
        }
        case 'GET_STATUS': {
            const data = await chrome.storage.local.get(['elapsed', 'lastRecording']);
            return {
                ok: true,
                recording: recording.active,
                elapsed: recording.active ? (Date.now() - recording.startTime) / 1000 : (data.elapsed || 0),
                last: data.lastRecording || null
            };
        }
        case 'OPEN_CAMERA': return openCamera();
        case 'CLOSE_CAMERA': return closeCamera();
        case 'DOWNLOAD': {
            await chrome.downloads.download({ url: msg.url, filename: msg.filename, saveAs: true });
            return { ok: true };
        }
        case 'OPEN_EDITOR': {
            await chrome.tabs.create({
                url: 'editor/editor.html?src=' + encodeURIComponent(msg.url) + '&name=' + encodeURIComponent(msg.name || 'recording')
            });
            return { ok: true };
        }
        case 'UPLOAD': return uploadFlow(msg);
        case 'CONNECT_GOOGLE': {
            const r = await AUTH.connectGoogle();
            await chrome.storage.local.set({ google: { token: r.token, email: r.email, name: r.name } });
            return { ok: true, email: r.email };
        }
        case 'DISCONNECT_GOOGLE': {
            await AUTH.disconnectGoogle();
            return { ok: true };
        }
        case 'CHECK_GOOGLE': {
            const data = await chrome.storage.local.get('google');
            return { ok: true, connected: !!(data.google && data.google.token) };
        }
        case 'CONNECT_MICROSOFT': {
            await AUTH.connectMicrosoft();
            return { ok: true };
        }
        case 'DISCONNECT_MICROSOFT': {
            await chrome.storage.local.remove('msToken');
            return { ok: true };
        }
        case 'CHECK_MICROSOFT': {
            const data = await chrome.storage.local.get('msToken');
            return { ok: true, connected: !!data.msToken };
        }
        case 'RECORDING_STARTED': return { ok: true };
        case 'TIMER_TICK': {
            if (recording.active) await chrome.storage.local.set({ elapsed: msg.elapsed });
            return { ok: true };
        }
        case 'RECORDING_STOPPED': {
            const last = {
                url: msg.blobUrl,
                size: msg.size,
                duration: msg.duration,
                mime: msg.mime,
                ext: msg.ext,
                name: 'Recording_' + stamp() + '.' + msg.ext
            };
            await chrome.storage.local.set({ lastRecording: last });
            if (recording.stopResolve) { recording.stopResolve(last); recording.stopResolve = null; }
            return { ok: true };
        }
        default:
            return { ok: false, error: 'Unknown message: ' + msg.type };
    }
}

async function openCamera() {
    if (cameraWindowId != null) {
        try { await chrome.windows.update(cameraWindowId, { focused: true }); } catch (e) { }
        return { ok: true, windowId: cameraWindowId };
    }
    const win = await chrome.windows.create({
        url: 'camera/camera.html',
        type: 'popup',
        width: 400,
        height: 360,
        focused: false
    });
    cameraWindowId = win.id;
    return { ok: true, windowId: win.id };
}

async function closeCamera() {
    if (cameraWindowId != null) {
        try { await chrome.windows.remove(cameraWindowId); } catch (e) { }
        cameraWindowId = null;
    }
    return { ok: true };
}

chrome.windows.onRemoved.addListener((id) => {
    if (id === cameraWindowId) cameraWindowId = null;
});

async function uploadFlow(msg) {
    const blob = await (await fetch(msg.url)).blob();
    const ext = msg.ext || (blob.type.indexOf('mp4') !== -1 ? 'mp4' : 'webm');
    const name = msg.name || ('Recording_' + stamp() + '.' + ext);
    const mime = blob.type || (ext === 'webm' ? 'video/webm' : 'video/mp4');
    const progress = (p) => chrome.runtime.sendMessage({ type: 'UPLOAD_PROGRESS', progress: p, service: msg.service });
    try {
        if (msg.service === 'drive') {
            const data = await chrome.storage.local.get(['google', 'driveFolder']);
            if (!data.google || !data.google.token) throw new Error('Google not connected');
            await UPLOAD.driveUpload(data.google.token, blob, name, mime, data.driveFolder || undefined, progress);
        } else if (msg.service === 'youtube') {
            const data = await chrome.storage.local.get(['google', 'ytPrivacy']);
            if (!data.google || !data.google.token) throw new Error('Google not connected');
            await UPLOAD.youtubeUpload(data.google.token, blob, {
                title: name,
                description: '',
                privacyStatus: data.ytPrivacy || 'private'
            }, progress);
        } else if (msg.service === 'onedrive') {
            const token = await AUTH.msAccessToken();
            const data = await chrome.storage.local.get('odFolder');
            await UPLOAD.oneDriveUpload(token, blob, name, data.odFolder || '', progress);
        } else {
            throw new Error('Unknown service');
        }
        notify(chrome.i18n.getMessage('notifUploadDone'), name);
        return { ok: true };
    } catch (e) {
        const m = e && e.message ? e.message : String(e);
        notify(chrome.i18n.getMessage('notifUploadFail'), m);
        return { ok: false, error: m };
    }
}