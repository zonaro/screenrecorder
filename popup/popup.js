(async () => {
    await I18n.init();
    const $ = (id) => document.getElementById(id);

    const PRESETS = {
        high: { fps: 30, resolution: '1080', bitrate: 8 },
        balanced: { fps: 30, resolution: '1080', bitrate: 5 },
        compact: { fps: 30, resolution: '720', bitrate: 2.5 }
    };

    const settings = await chrome.storage.local.get({
        withCamera: false, includeCamera: false,
        withMic: true, withSystemAudio: true, format: 'mp4',
        preset: 'balanced', resolution: 'original', fps: 30, bitrate: 5
    });

    const state = { recording: false, last: null, elapsed: 0 };

    function save() { chrome.storage.local.set(settings); }

    // --- wire initial UI values ---
    $('withCamera').checked = settings.withCamera;
    $('includeCamera').checked = settings.includeCamera;
    $('withMic').checked = settings.withMic;
    $('withSystemAudio').checked = settings.withSystemAudio;
    $('format').value = settings.format;
    $('preset').value = settings.preset;
    $('resolution').value = settings.resolution;
    $('fps').value = String(settings.fps);
    $('bitrate').value = String(settings.bitrate);
    $('bitrateVal').textContent = settings.bitrate + ' Mbps';
    $('includeCamRow').style.display = settings.withCamera ? '' : 'none';

    $('withCamera').onchange = () => { settings.withCamera = $('withCamera').checked; $('includeCamRow').style.display = settings.withCamera ? '' : 'none'; save(); };
    $('includeCamera').onchange = () => { settings.includeCamera = $('includeCamera').checked; save(); };
    $('withMic').onchange = () => { settings.withMic = $('withMic').checked; save(); };
    $('withSystemAudio').onchange = () => { settings.withSystemAudio = $('withSystemAudio').checked; save(); };
    $('format').onchange = () => { settings.format = $('format').value; save(); };
    $('preset').onchange = () => { settings.preset = $('preset').value; save(); };
    $('resolution').onchange = () => { settings.resolution = $('resolution').value; save(); };
    $('fps').onchange = () => { settings.fps = Number($('fps').value); save(); };
    $('bitrate').oninput = () => {
        settings.bitrate = Number($('bitrate').value);
        $('bitrateVal').textContent = settings.bitrate + ' Mbps';
        save();
    };

    function buildSettings() {
        const p = PRESETS[settings.preset] || PRESETS.balanced;
        const advanced = $('advanced').open;
        const resolution = advanced ? settings.resolution : p.resolution;
        const fps = advanced ? settings.fps : p.fps;
        const bitrate = advanced ? settings.bitrate : p.bitrate;
        return {
            format: settings.format,
            resolution: resolution,
            fps: fps,
            videoBitsPerSecond: Math.round(bitrate * 1000000),
            audioBitsPerSecond: 160000,
            withCamera: settings.withCamera,
            includeCamera: settings.includeCamera,
            withMic: settings.withMic,
            withSystemAudio: settings.withSystemAudio
        };
    }

    // --- status ---
    async function refresh() {
        const r = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
        if (!r || !r.ok) return;
        state.recording = r.recording;
        state.last = r.last;
        state.elapsed = r.elapsed || 0;
        if (state.recording) showRecording();
        else if (state.last) showResult();
        else showSetup();
    }

    function showSetup() {
        $('setup').hidden = false; $('recording').hidden = true; $('result').hidden = true;
        $('recordBtn').disabled = false;
    }
    function showRecording() {
        $('setup').hidden = true; $('recording').hidden = false; $('result').hidden = true;
        startTimer();
    }
    function showResult() {
        $('setup').hidden = true; $('recording').hidden = true; $('result').hidden = false;
        stopTimer();
        $('progress').hidden = true;
    }

    let timerInt = null;
    function startTimer() { stopTimer(); timerInt = setInterval(() => { $('timer').textContent = fmt(state.elapsed); }, 500); }
    function stopTimer() { if (timerInt) { clearInterval(timerInt); timerInt = null; } }
    function fmt(s) {
        s = Math.max(0, s || 0);
        const m = Math.floor(s / 60), ss = Math.floor(s % 60);
        return String(m).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
    }

    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.type === 'TIMER_TICK' && state.recording) {
            state.elapsed = msg.elapsed;
            $('timer').textContent = fmt(msg.elapsed);
        }
        if (msg.type === 'RECORDING_STOPPED') refresh();
        if (msg.type === 'UPLOAD_PROGRESS') {
            $('progress').hidden = false;
            $('progressBar').value = msg.progress;
            $('progressText').textContent = Math.round(msg.progress * 100) + '%';
        }
    });

    // --- record / stop ---
    // The source picker is opened by the offscreen document itself (see
    // offscreen.js), so there is no stream id to hand around here.
    $('recordBtn').addEventListener('click', async () => {
        const res = await chrome.runtime.sendMessage({
            type: 'START_RECORDING', ...buildSettings()
        });
        if (res && res.ok) {
            state.recording = true;
            state.elapsed = 0;
            if (settings.withCamera) chrome.runtime.sendMessage({ type: 'OPEN_CAMERA' });
            showRecording();
            // Recording is already running - these only say a track is missing.
            // They arrive as i18n keys because the offscreen document that
            // raised them has no access to chrome.i18n.
            if (res.warnings && res.warnings.length) {
                alert(res.warnings.map((k) => I18n.t(k)).join('\n\n'));
            }
        } else if (!res || res.error !== 'Cancelled') {
            alert(res && res.error ? res.error : 'Error');
        }
    });

    $('stopBtn').addEventListener('click', async () => {
        $('stopBtn').disabled = true;
        const res = await chrome.runtime.sendMessage({ type: 'STOP_RECORDING' });
        $('stopBtn').disabled = false;
        if (res && res.ok) {
            state.recording = false;
            if (settings.withCamera) chrome.runtime.sendMessage({ type: 'CLOSE_CAMERA' });
            // Stopping is acknowledged immediately, but the file itself finishes
            // encoding a moment later - the RECORDING_STOPPED listener above
            // calls refresh() once it actually arrives and switches to the
            // result screen.
        } else {
            alert(res && res.error ? res.error : 'Error');
        }
    });

    // The finished recording is kept in storage, so without this the popup
    // would reopen on the result screen forever with no way back.
    $('newRecordingBtn').addEventListener('click', async () => {
        await chrome.runtime.sendMessage({ type: 'CLEAR_LAST' });
        state.last = null;
        state.elapsed = 0;
        $('timer').textContent = '00:00';
        showSetup();
    });

    // --- result actions ---
    $('downloadBtn').addEventListener('click', () => {
        if (state.last) chrome.runtime.sendMessage({ type: 'DOWNLOAD', url: state.last.url, filename: state.last.name });
    });
    $('editBtn').addEventListener('click', () => {
        if (state.last) chrome.runtime.sendMessage({ type: 'OPEN_EDITOR', url: state.last.url, name: state.last.name });
    });
    $('upDrive').addEventListener('click', () => upload('drive'));
    $('upOneDrive').addEventListener('click', () => upload('onedrive'));
    $('upYoutube').addEventListener('click', () => upload('youtube'));

    async function upload(service) {
        if (!state.last) return;
        const res = await chrome.runtime.sendMessage({
            type: 'UPLOAD', service: service, url: state.last.url, name: state.last.name, ext: state.last.ext
        });
        if (res && res.ok) { $('progress').hidden = false; $('progressBar').value = 1; $('progressText').textContent = '100%'; }
        else alert(res && res.error ? res.error : 'Upload failed');
    }

    await refresh();
})();