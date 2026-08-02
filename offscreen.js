// offscreen.js - runs the actual MediaRecorder for screen + webcam + audio.
let desktopStream = null, micStream = null, cameraStream = null;
let cameraVideo = null;
let audioCtx = null, dest = null;
let videoEl = null, canvas = null, ctx = null;
let mediaRecorder = null, chunks = [];
let drawRaf = 0;
let recording = false;
let withCameraInRecording = false;
let startTime = 0, timerInterval = null;
let fps = 30;

function post(msg) { chrome.runtime.sendMessage(msg); }

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    (async () => {
        if (msg.type === 'START') return await start(msg);
        if (msg.type === 'STOP') return stop();
        return { ok: false, error: 'unknown' };
    })().then(sendResponse).catch(e => {
        post({ type: 'ERROR', error: e && e.message ? e.message : String(e) });
        sendResponse({ ok: false, error: e && e.message ? e.message : String(e) });
    });
    return true;
});

function pickMime(format) {
    const list = format === 'mp4'
        ? ['video/mp4;codecs="avc1.42E01E,mp4a.40.2"', 'video/mp4']
        : ['video/webm;codecs="vp9,opus"', 'video/webm;codecs="vp8,opus"', 'video/webm'];
    for (const m of list) if (MediaRecorder.isTypeSupported(m)) return m;
    return format === 'mp4' ? 'video/mp4' : 'video/webm';
}

async function start(msg) {
    if (recording) throw new Error('Already recording');
    chunks = [];
    fps = msg.fps || 30;
    withCameraInRecording = !!msg.includeCamera;
    const wantSystem = msg.withSystemAudio !== false;

    const videoConstraints = { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: msg.streamId } };
    const audioConstraints = wantSystem
        ? { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: msg.streamId } }
        : false;

    try {
        desktopStream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: audioConstraints });
    } catch (e) {
        if (!wantSystem) throw e;
        // Some sources have no audio track; retry video-only.
        desktopStream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints });
    }

    videoEl = document.getElementById('video');
    videoEl.srcObject = desktopStream;
    await videoEl.play();

    let vw = videoEl.videoWidth, vh = videoEl.videoHeight;
    const res = msg.resolution;
    if (res && res !== 'original') {
        const target = parseInt(res, 10);
        if (vh > target) {
            const ratio = target / vh;
            vh = target;
            vw = Math.round(vw * ratio);
        }
    }
    if (vw % 2) vw--;
    if (vh % 2) vh--;
    if (vw < 2) vw = 2;
    if (vh < 2) vh = 2;

    canvas = document.getElementById('canvas');
    canvas.width = vw;
    canvas.height = vh;
    ctx = canvas.getContext('2d');

    const recStream = new MediaStream();

    // Audio: system + mic mixed.
    if (wantSystem || msg.withMic) {
        audioCtx = new AudioContext();
        dest = audioCtx.createMediaStreamDestination();
        if (wantSystem && desktopStream.getAudioTracks().length) {
            audioCtx.createMediaStreamSource(desktopStream).connect(dest);
        }
        if (msg.withMic) {
            micStream = await navigator.mediaDevices.getUserMedia({
                audio: { echoCancellation: true, noiseSuppression: true }
            });
            audioCtx.createMediaStreamSource(micStream).connect(dest);
        }
        await audioCtx.resume();
        dest.stream.getAudioTracks().forEach(t => recStream.addTrack(t));
    }

    // Camera (only if it should be drawn into the recording).
    if (msg.withCamera && withCameraInRecording) {
        cameraStream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
        cameraVideo = document.createElement('video');
        cameraVideo.srcObject = cameraStream;
        cameraVideo.muted = true;
        cameraVideo.playsInline = true;
        await cameraVideo.play();
    }

    recStream.addTrack(canvas.captureStream(fps).getVideoTracks()[0]);

    const mime = pickMime(msg.format);
    const recOpts = { mimeType: mime, videoBitsPerSecond: msg.videoBitsPerSecond || 5000000 };
    if (recStream.getAudioTracks().length) recOpts.audioBitsPerSecond = msg.audioBitsPerSecond || 160000;

    mediaRecorder = new MediaRecorder(recStream, recOpts);
    mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    mediaRecorder.onstop = () => {
        cancelAnimationFrame(drawRaf);
        const type = mediaRecorder.mimeType || mime;
        const blob = new Blob(chunks, { type: type });
        const ext = type.indexOf('mp4') !== -1 ? 'mp4' : 'webm';
        const duration = (Date.now() - startTime) / 1000;
        recording = false;
        cleanup();
        post({
            type: 'RECORDING_STOPPED',
            blobUrl: URL.createObjectURL(blob),
            size: blob.size,
            duration: duration,
            mime: type,
            ext: ext
        });
    };

    mediaRecorder.start(1000);
    recording = true;
    startTime = Date.now();
    timerInterval = setInterval(() => {
        post({ type: 'TIMER_TICK', elapsed: (Date.now() - startTime) / 1000 });
    }, 500);
    drawLoop();
    post({ type: 'RECORDING_STARTED' });
    return { ok: true };
}

function stop() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    return { ok: true };
}

function drawLoop() {
    draw();
    drawRaf = requestAnimationFrame(drawLoop);
}

function draw() {
    if (!videoEl || !ctx) return;
    ctx.save();
    ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
    if (cameraStream && cameraVideo && withCameraInRecording) {
        const cw = Math.round(canvas.width * 0.22);
        const ch = Math.round(cw * (cameraVideo.videoHeight || Math.round(cw * 0.75)) / (cameraVideo.videoWidth || cw));
        const x = canvas.width - cw - 14;
        const y = canvas.height - ch - 14;
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(x - 3, y - 3, cw + 6, ch + 6);
        ctx.drawImage(cameraVideo, x, y, cw, ch);
    }
    ctx.restore();
}

function cleanup() {
    [desktopStream, micStream, cameraStream].forEach(s => {
        if (s) s.getTracks().forEach(t => t.stop());
    });
    if (audioCtx) { audioCtx.close().catch(() => { }); audioCtx = null; }
    desktopStream = micStream = cameraStream = null;
    cameraVideo = null;
    mediaRecorder = null;
    chunks = [];
}