// background.js - service worker: orchestration, auth and uploads.
importScripts('lib/auth.js', 'lib/upload.js');

// The service worker can be killed by Chrome at any time while idle; any
// state kept only in JS variables (like a plain object here) is lost when
// that happens, even mid-recording. Persist the active/startTime flags in
// chrome.storage.session, which survives service worker restarts.
async function getRecordingState() {
    const { recActive, recStartTime } = await chrome.storage.session.get(['recActive', 'recStartTime']);
    return { active: !!recActive, startTime: recStartTime || 0 };
}
async function setRecordingState(active, startTime) {
    await chrome.storage.session.set({ recActive: active, recStartTime: startTime || 0 });
}

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

// chrome.runtime.sendMessage() can hang forever if no listener ever calls
// sendResponse (e.g. the offscreen document failed to load). Never let an
// internal round-trip block the UI indefinitely - surface a real error
// instead of a silent hang.
// Pass timeoutMs = 0 for calls that legitimately wait on the user (the
// source picker), where any deadline would be wrong.
function sendToOffscreen(msg, timeoutMs = 8000) {
    if (!timeoutMs) return chrome.runtime.sendMessage(msg);
    return Promise.race([
        chrome.runtime.sendMessage(msg),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Offscreen document did not respond in time')), timeoutMs))
    ]);
}

async function ensureOffscreen() {
    const has = await chrome.offscreen.hasDocument();
    if (!has) {
        await chrome.offscreen.createDocument({
            url: 'offscreen.html',
            // USER_MEDIA covers the getUserMedia calls for tab capture, mic
            // and camera; DISPLAY_MEDIA covers desktop capture.
            reasons: ['USER_MEDIA', 'DISPLAY_MEDIA'],
            justification: 'Screen recording'
        });
    }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    // START/STOP are sent by this same script to the offscreen document;
    // sendMessage echoes them back to our own listener too. Ignore them
    // here so we don't answer on the offscreen document's behalf.
    if (msg.type === 'START' || msg.type === 'STOP') return false;
    handleMessage(msg)
        .then(sendResponse)
        .catch(e => sendResponse({ ok: false, error: e && e.message ? e.message : String(e) }));
    return true;
});

async function handleMessage(msg) {
    switch (msg.type) {
        case 'START_RECORDING': {
            const cur = await getRecordingState();
            if (cur.active) return { ok: false, error: 'Already recording' };
            await ensureOffscreen();
            let startRes;
            try {
                // The offscreen document opens the picker itself, so this can
                // block for as long as the user takes to choose a source.
                startRes = await sendToOffscreen({ type: 'START', format: msg.format, resolution: msg.resolution, fps: msg.fps, videoBitsPerSecond: msg.videoBitsPerSecond, audioBitsPerSecond: msg.audioBitsPerSecond, withCamera: msg.withCamera, includeCamera: msg.includeCamera, withMic: msg.withMic, withSystemAudio: msg.withSystemAudio }, 0);
            } catch (e) {
                return { ok: false, error: e && e.message ? e.message : String(e) };
            }
            // The offscreen document reports failures (e.g. getUserMedia
            // rejected) via its response - don't tell the popup recording
            // started unless it actually did.
            if (!startRes || !startRes.ok) {
                return { ok: false, error: (startRes && startRes.error) || 'Failed to start recording' };
            }
            await setRecordingState(true, Date.now());
            chrome.action.setBadgeText({ text: 'REC' });
            chrome.action.setBadgeBackgroundColor({ color: '#e53935' });
            return { ok: true, warnings: startRes.warnings || [] };
        }
        case 'STOP_RECORDING': {
            const cur = await getRecordingState();
            if (!cur.active) return { ok: false, error: 'Not recording' };
            // Mark inactive and acknowledge right away rather than blocking on
            // the full stop pipeline (MediaRecorder flush + blob creation) -
            // that wait used to live in an in-memory Promise which is lost if
            // the service worker gets killed while waiting. The popup already
            // listens for the RECORDING_STOPPED broadcast to know when the
            // finished recording is actually ready.
            await setRecordingState(false, 0);
            chrome.action.setBadgeText({ text: '' });
            try {
                await sendToOffscreen({ type: 'STOP' });
            } catch (e) {
                return { ok: false, error: e && e.message ? e.message : String(e) };
            }
            return { ok: true };
        }
        case 'GET_STATUS': {
            const cur = await getRecordingState();
            const data = await chrome.storage.local.get(['elapsed', 'lastRecording']);
            return {
                ok: true,
                recording: cur.active,
                elapsed: cur.active ? (Date.now() - cur.startTime) / 1000 : (data.elapsed || 0),
                last: data.lastRecording || null
            };
        }
        case 'CLEAR_LAST': {
            await chrome.storage.local.remove(['lastRecording', 'elapsed']);
            return { ok: true };
        }
        case 'PREPARE_OFFSCREEN': {
            await ensureOffscreen();
            return { ok: true };
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
            const cur = await getRecordingState();
            if (cur.active) await chrome.storage.local.set({ elapsed: msg.elapsed });
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
            await setRecordingState(false, 0);
            chrome.action.setBadgeText({ text: '' });
            await chrome.storage.local.set({ lastRecording: last, elapsed: 0 });
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