(async () => {
    await I18n.init();
    const $ = (id) => document.getElementById(id);
    const params = new URLSearchParams(location.search);
    const src = params.get('src');
    const recName = params.get('name') || 'recording';

    const video = $('video');
    const previewBox = $('previewBox');
    const canvas = $('preview');
    const ctx = canvas.getContext('2d');
    const timelineEl = $('timeline');

    const state = {
        segments: [],
        overlays: [],
        currentTime: 0,
        playing: false,
        tool: 'select',
        liveStroke: null,
        cropDrag: null,
        selectedSegmentId: null,
        selectedOverlayId: null,
        exportUrl: null,
        exportName: null
    };

    let duration = 0;
    function uid() { return 'id-' + Math.random().toString(36).slice(2, 10); }
    function segById(id) { return state.segments.find(s => s.id === id); }
    function activeSeg() { return segById(state.selectedSegmentId) || state.segments[0]; }

    // --- load media ---
    const metaLoaded = new Promise((res) => { video.onloadedmetadata = () => res(); });
    const dataLoaded = new Promise((res) => { video.onloadeddata = () => res(); });
    video.src = src;
    await metaLoaded;
    duration = video.duration || 1;
    state.segments = [{ id: uid(), start: 0, end: duration, crop: null, panZoom: null }];
    state.selectedSegmentId = state.segments[0].id;
    await dataLoaded;

    function fitCanvas() {
        const vw = video.videoWidth, vh = video.videoHeight;
        if (!vw || !vh) return;
        const scale = Math.min(previewBox.clientWidth / vw, previewBox.clientHeight / vh);
        canvas.width = Math.max(2, Math.floor(vw * scale));
        canvas.height = Math.max(2, Math.floor(vh * scale));
    }
    fitCanvas();
    window.addEventListener('resize', fitCanvas);

    // --- playback ---
    function seek(t) {
        t = Math.max(0, Math.min(t, duration));
        video.currentTime = t;
        state.currentTime = t;
        updateScrub();
    }
    function play() {
        if (video.ended) video.currentTime = state.segments[0].start;
        state.playing = true;
        video.play().catch(() => { });
        $('playBtn').textContent = '⏸';
    }
    function pause() {
        state.playing = false;
        video.pause();
        $('playBtn').textContent = '▶';
    }
    $('playBtn').onclick = () => (state.playing ? pause() : play());
    $('stopBtn').onclick = () => { pause(); seek(state.segments[0].start); };
    $('backBtn').onclick = () => window.close();
    video.addEventListener('timeupdate', () => { state.currentTime = video.currentTime; updateScrub(); });
    video.addEventListener('ended', () => pause());

    const scrub = $('scrub');
    scrub.min = 0; scrub.max = duration; scrub.step = 0.001;
    scrub.addEventListener('input', () => { video.currentTime = Number(scrub.value); state.currentTime = Number(scrub.value); });
    function updateScrub() { scrub.value = state.currentTime; $('timeLabel').textContent = fmt(state.currentTime) + ' / ' + fmt(duration); }
    function fmt(s) {
        if (isNaN(s)) s = 0;
        const m = Math.floor(s / 60), ss = Math.floor(s % 60);
        return String(m).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
    }

    // --- render loop ---
    function renderLoop() {
        EditorCore.drawFrame(ctx, canvas, video, state.segments, state.overlays, state.currentTime, state.liveStroke);
        if (state.tool === 'crop' && state.cropDrag) {
            const d = state.cropDrag;
            ctx.strokeStyle = '#00e5ff'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
            ctx.strokeRect(d.x, d.y, d.w, d.h);
            ctx.setLineDash([]);
        }
        requestAnimationFrame(renderLoop);
    }
    renderLoop();

    // --- timeline ---
    function renderTimeline() {
        timelineEl.innerHTML = '';
        state.segments.forEach((s) => {
            const el = document.createElement('div');
            el.className = 'segment' + (s.id === state.selectedSegmentId ? ' active' : '');
            el.style.left = (s.start / duration) * 100 + '%';
            el.style.width = Math.max(((s.end - s.start) / duration) * 100, 0.5) + '%';
            el.title = fmt(s.start) + ' - ' + fmt(s.end);
            const hl = document.createElement('div'); hl.className = 'handle left';
            const hr = document.createElement('div'); hr.className = 'handle right';
            el.appendChild(hl); el.appendChild(hr);
            el.addEventListener('mousedown', (e) => {
                if (e.target.classList.contains('handle')) return;
                state.selectedSegmentId = s.id;
                renderTimeline();
                seek(s.start);
            });
            hl.addEventListener('mousedown', (e) => startTrim(e, s, 'left'));
            hr.addEventListener('mousedown', (e) => startTrim(e, s, 'right'));
            timelineEl.appendChild(el);
        });
    }

    function startTrim(e, seg, side) {
        e.stopPropagation();
        const box = timelineEl.getBoundingClientRect();
        const onMove = (ev) => {
            const pct = Math.max(0, Math.min(1, (ev.clientX - box.left) / box.width));
            const t = pct * duration;
            if (side === 'left') seg.start = Math.max(0, Math.min(t, seg.end - 0.1));
            else seg.end = Math.min(duration, Math.max(t, seg.start + 0.1));
            renderTimeline();
        };
        const onUp = () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    }

    $('splitBtn').onclick = () => {
        const seg = activeSeg();
        const t = state.currentTime;
        if (!seg || t <= seg.start + 0.1 || t >= seg.end - 0.1) return;
        const a = { id: uid(), start: seg.start, end: t, crop: seg.crop, panZoom: seg.panZoom };
        const b = { id: uid(), start: t, end: seg.end, crop: seg.crop, panZoom: seg.panZoom };
        state.segments.splice(state.segments.indexOf(seg), 1, a, b);
        state.selectedSegmentId = a.id;
        renderTimeline();
    };
    $('deleteBtn').onclick = () => {
        if (state.segments.length <= 1) return;
        const seg = activeSeg();
        state.segments = state.segments.filter(s => s.id !== seg.id);
        state.selectedSegmentId = state.segments[0].id;
        renderTimeline();
    };
    $('clearCrop').onclick = () => { const seg = activeSeg(); if (seg) seg.crop = null; };
    $('clearCrop2').onclick = () => { const seg = activeSeg(); if (seg) seg.crop = null; };
    $('clearPanZoom').onclick = () => { const seg = activeSeg(); if (seg) seg.panZoom = null; };

    // --- tools ---
    function setTool(tool) {
        state.tool = tool;
        document.querySelectorAll('.tool').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
        $('panelCrop').hidden = tool !== 'crop';
        $('panelPanZoom').hidden = tool !== 'panzoom';
        $('panelDoodle').hidden = tool !== 'doodle';
        $('panelText').hidden = tool !== 'text';
    }
    document.querySelectorAll('.tool').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));

    function canvasPos(e) {
        const r = canvas.getBoundingClientRect();
        return {
            x: (e.clientX - r.left) * (canvas.width / r.width),
            y: (e.clientY - r.top) * (canvas.height / r.height)
        };
    }

    canvas.addEventListener('mousedown', (e) => {
        if (state.tool === 'crop') {
            const p = canvasPos(e);
            state.cropDrag = { x: p.x, y: p.y, w: 0, h: 0 };
            const ar = canvas.width / canvas.height;
            const onMove = (ev) => {
                const p2 = canvasPos(ev);
                let x = Math.min(p.x, p2.x), y = Math.min(p.y, p2.y);
                let w = Math.abs(p2.x - p.x), h = Math.abs(p2.y - p.y);
                if (w / Math.max(h, 1) > ar) h = w / ar; else w = h * ar;
                if (x + w > canvas.width) x = canvas.width - w;
                if (y + h > canvas.height) y = canvas.height - h;
                state.cropDrag = { x: x, y: y, w: w, h: h };
            };
            const onUp = () => {
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('mouseup', onUp);
                const d = state.cropDrag;
                state.cropDrag = null;
                if (d && d.w > 8 && d.h > 8) {
                    const seg = activeSeg();
                    if (seg) seg.crop = { x: d.x / canvas.width, y: d.y / canvas.height, w: d.w / canvas.width, h: d.h / canvas.height };
                }
            };
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
        } else if (state.tool === 'doodle') {
            const p = canvasPos(e);
            const stroke = {
                id: uid(), type: 'doodle',
                color: $('doodleColor').value,
                width: Number($('doodleWidth').value),
                points: [{ t: state.currentTime, x: p.x / canvas.width, y: p.y / canvas.height }],
                start: 0, end: duration
            };
            state.liveStroke = stroke;
            const onMove = (ev) => {
                const p2 = canvasPos(ev);
                stroke.points.push({ t: state.currentTime, x: p2.x / canvas.width, y: p2.y / canvas.height });
            };
            const onUp = () => {
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('mouseup', onUp);
                state.liveStroke = null;
                if (stroke.points.length > 1) { state.overlays.push(stroke); renderOverlays(); }
            };
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
        } else if (state.tool === 'text' && state.selectedOverlayId) {
            const ov = state.overlays.find(o => o.id === state.selectedOverlayId);
            if (ov && ov.type === 'text') {
                const startPos = canvasPos(e);
                const onMove = (ev) => {
                    const p2 = canvasPos(ev);
                    ov.x = Math.max(0, Math.min(1, ov.x + (p2.x - startPos.x) / canvas.width));
                    ov.y = Math.max(0, Math.min(1, ov.y + (p2.y - startPos.y) / canvas.height));
                };
                const onUp = () => {
                    window.removeEventListener('mousemove', onMove);
                    window.removeEventListener('mouseup', onUp);
                };
                window.addEventListener('mousemove', onMove);
                window.addEventListener('mouseup', onUp);
            }
        }
    });

    // --- pan/zoom ---
    const pz = {
        fromZoom: $('pzFromZoom'), fromX: $('pzFromX'), fromY: $('pzFromY'),
        toZoom: $('pzToZoom'), toX: $('pzToX'), toY: $('pzToY')
    };
    pz.fromZoom.oninput = () => $('pzFromZoomV').textContent = pz.fromZoom.value;
    pz.toZoom.oninput = () => $('pzToZoomV').textContent = pz.toZoom.value;
    $('applyPanZoom').onclick = () => {
        const seg = activeSeg();
        if (!seg) return;
        seg.panZoom = {
            from: { x: Number(pz.fromX.value), y: Number(pz.fromY.value), zoom: Number(pz.fromZoom.value) },
            to: { x: Number(pz.toX.value), y: Number(pz.toY.value), zoom: Number(pz.toZoom.value) }
        };
    };

    // --- text overlays ---
    $('addTextBtn').onclick = () => {
        const seg = activeSeg();
        const ov = { id: uid(), type: 'text', text: 'Text', x: 0.5, y: 0.5, color: '#ffffff', size: 0.06, font: 'sans-serif', bold: true, start: seg.start, end: seg.end };
        state.overlays.push(ov);
        state.selectedOverlayId = ov.id;
        renderOverlays();
        updateTextPanel();
    };

    function renderOverlays() {
        const list = $('overlayList');
        list.innerHTML = '';
        state.overlays.forEach((o, i) => {
            const el = document.createElement('div');
            el.className = 'overlay-item' + (o.id === state.selectedOverlayId ? ' active' : '');
            el.textContent = (o.type === 'text' ? 'T · ' + o.text : '✏️ Doodle #' + (i + 1));
            el.onclick = () => { state.selectedOverlayId = o.id; renderOverlays(); updateTextPanel(); };
            const del = document.createElement('button');
            del.textContent = '✕';
            del.className = 'mini';
            del.onclick = (e) => {
                e.stopPropagation();
                state.overlays = state.overlays.filter(x => x.id !== o.id);
                if (state.selectedOverlayId === o.id) state.selectedOverlayId = null;
                renderOverlays();
                updateTextPanel();
            };
            el.appendChild(del);
            list.appendChild(el);
        });
    }

    function selectedText() {
        return state.overlays.find(o => o.id === state.selectedOverlayId && o.type === 'text') || null;
    }
    function updateTextPanel() {
        const ov = selectedText();
        if (!ov) { $('textProps').hidden = true; return; }
        $('textProps').hidden = false;
        $('textValue').value = ov.text;
        $('textColor').value = ov.color;
        $('textSize').value = ov.size;
        $('textStart').value = ov.start;
        $('textEnd').value = ov.end;
    }
    $('textValue').oninput = () => { const ov = selectedText(); if (ov) ov.text = $('textValue').value; };
    $('textColor').oninput = () => { const ov = selectedText(); if (ov) ov.color = $('textColor').value; };
    $('textSize').oninput = () => { const ov = selectedText(); if (ov) ov.size = Number($('textSize').value); };
    $('textStart').onchange = () => { const ov = selectedText(); if (ov) ov.start = Number($('textStart').value); };
    $('textEnd').onchange = () => { const ov = selectedText(); if (ov) ov.end = Number($('textEnd').value); };

    // --- export ---
    $('exportBtn').onclick = () => { $('exportPanel').hidden = false; };
    $('exportCancel').onclick = () => { $('exportPanel').hidden = true; };
    $('exportBitrate').oninput = () => { $('exportBitrateVal').textContent = $('exportBitrate').value + ' Mbps'; };

    $('runExport').onclick = async () => {
        const format = $('exportFormat').value;
        const resolution = $('exportResolution').value;
        const bitrate = Number($('exportBitrate').value);
        const fps = Number($('exportFps').value);
        const vw = video.videoWidth, vh = video.videoHeight;
        let w = vw, h = vh;
        if (resolution !== 'original') {
            const target = parseInt(resolution, 10);
            if (vh > target) { const ratio = target / vh; h = target; w = Math.round(vw * ratio); }
        }
        if (w % 2) w--; if (h % 2) h--;
        const expCanvas = document.createElement('canvas');
        expCanvas.width = w; expCanvas.height = h;
        const expCtx = expCanvas.getContext('2d');
        const regions = EditorCore.computeRegions(state.segments);
        const total = regions.reduce((a, r) => a + (r.end - r.start), 0);

        $('runExport').disabled = true;
        $('exportProgressWrap').hidden = false;
        $('exportResult').hidden = true;
        state.exportUrl = null;

        const drawFrame = () => EditorCore.drawFrame(expCtx, expCanvas, video, state.segments, state.overlays, video.currentTime, null);

        try {
            const blob = await EXPORT.render({
                video: video,
                canvas: expCanvas,
                regions: regions,
                totalDuration: total,
                fps: fps,
                format: format,
                vbps: Math.round(bitrate * 1000000),
                abps: 160000,
                drawFrame: drawFrame,
                onProgress: (p) => { $('exportProgress').value = p; $('exportPct').textContent = Math.round(p * 100) + '%'; }
            });
            state.exportUrl = URL.createObjectURL(blob);
            state.exportName = recName.replace(/\.[^.]+$/, '') + '_edited.' + (format === 'mp4' ? 'mp4' : 'webm');
            $('exportResult').hidden = false;
        } catch (e) {
            alert('Export failed: ' + (e && e.message ? e.message : e));
        } finally {
            $('runExport').disabled = false;
        }
    };

    $('dlExport').onclick = () => {
        if (state.exportUrl) chrome.runtime.sendMessage({ type: 'DOWNLOAD', url: state.exportUrl, filename: state.exportName });
    };
    $('upExportDrive').onclick = () => uploadExport('drive');
    $('upExportOneDrive').onclick = () => uploadExport('onedrive');
    $('upExportYoutube').onclick = () => uploadExport('youtube');

    async function uploadExport(service) {
        if (!state.exportUrl) return;
        const res = await chrome.runtime.sendMessage({
            type: 'UPLOAD', service: service, url: state.exportUrl,
            name: state.exportName, ext: state.exportName.split('.').pop()
        });
        if (res && res.ok) alert('Upload complete ✓');
        else alert(res && res.error ? res.error : 'Upload failed');
    }

    // --- init ---
    renderTimeline();
    renderOverlays();
    setTool('select');
    updateScrub();
    pause();
})();