(async () => {
    await I18n.init();
    const $ = (id) => document.getElementById(id);
    const t = (k) => I18n.t(k);
    const params = new URLSearchParams(location.search);
    const src = params.get('src');
    const recName = params.get('name') || 'recording';

    const video = $('video');
    const previewBox = $('previewBox');
    const canvas = $('preview');
    const ctx = canvas.getContext('2d');
    const tlLabels = $('tlLabels');
    const tlLanes = $('tlLanes');
    const tlLanesWrap = $('tlLanesWrap');
    const playhead = $('playhead');

    const EPS = EditorCore.EPS;
    const MIN_ITEM = 0.15;

    const state = {
        segments: [],
        overlays: [],   // painting order: last element is on top
        captions: [],   // cues authored against the source timeline
        captionStyle: { size: 0.055, color: '#ffffff', bg: 0.55, position: 'bottom', font: 'sans-serif' },
        previewCaptions: true,
        currentTime: 0,
        playing: false,
        tool: 'select',
        liveStroke: null,
        cropDrag: null,
        selectedSegmentId: null,
        selectedOverlayId: null,
        selectedCueId: null,
        exportUrl: null,
        exportName: null,
        subsUrl: null,
        subsName: null
    };

    let duration = 0;
    let regions = [];   // one entry per surviving clip, with its output times
    let ranges = [];    // the same, with glued clips merged into single runs
    let outDuration = 0;

    function uid() { return 'id-' + Math.random().toString(36).slice(2, 10); }
    function segById(id) { return state.segments.find(s => s.id === id) || null; }
    function activeSeg() { return segById(state.selectedSegmentId) || state.segments[0] || null; }
    function overlayById(id) { return state.overlays.find(o => o.id === id) || null; }
    function cueById(id) { return state.captions.find(c => c.id === id) || null; }
    function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

    // --- load media ---
    const metaLoaded = new Promise((res) => { video.onloadedmetadata = () => res(); });
    const dataLoaded = new Promise((res) => { video.onloadeddata = () => res(); });
    video.src = src;
    await metaLoaded;
    duration = video.duration || 1;
    state.segments = [{ id: uid(), start: 0, end: duration, crop: null, panZoom: null }];
    state.selectedSegmentId = state.segments[0].id;
    rebuild();
    await dataLoaded;

    function rebuild() {
        state.segments = EditorCore.sortSegments(state.segments);
        regions = EditorCore.buildRegions(state.segments);
        ranges = EditorCore.mergeRegions(regions);
        outDuration = EditorCore.outputDuration(regions);
    }

    function fitCanvas() {
        const vw = video.videoWidth, vh = video.videoHeight;
        if (!vw || !vh) return;
        const scale = Math.min(previewBox.clientWidth / vw, previewBox.clientHeight / vh);
        canvas.width = Math.max(2, Math.floor(vw * scale));
        canvas.height = Math.max(2, Math.floor(vh * scale));
    }
    fitCanvas();
    window.addEventListener('resize', () => { fitCanvas(); layoutTimeline(); });

    // ------------------------------------------------------------------
    // History
    // ------------------------------------------------------------------
    const history = { past: [], future: [] };
    function snapshot() {
        return JSON.stringify({ segments: state.segments, overlays: state.overlays, captions: state.captions });
    }
    function pushHistory() {
        history.past.push(snapshot());
        if (history.past.length > 60) history.past.shift();
        history.future.length = 0;
        updateHistoryButtons();
    }
    function restore(json) {
        const d = JSON.parse(json);
        state.segments = d.segments;
        state.overlays = d.overlays;
        state.captions = d.captions;
        if (!segById(state.selectedSegmentId)) state.selectedSegmentId = state.segments[0] ? state.segments[0].id : null;
        if (!overlayById(state.selectedOverlayId)) state.selectedOverlayId = null;
        if (!cueById(state.selectedCueId)) state.selectedCueId = null;
        rebuild();
        seek(state.currentTime);
        renderAll();
    }
    function undo() {
        if (!history.past.length) return;
        history.future.push(snapshot());
        restore(history.past.pop());
    }
    function redo() {
        if (!history.future.length) return;
        history.past.push(snapshot());
        restore(history.future.pop());
    }
    function updateHistoryButtons() {
        $('undoBtn').disabled = !history.past.length;
        $('redoBtn').disabled = !history.future.length;
    }
    $('undoBtn').onclick = undo;
    $('redoBtn').onclick = redo;

    // ------------------------------------------------------------------
    // Playback
    // ------------------------------------------------------------------
    function seek(time) {
        const snapped = EditorCore.snapToRegions(ranges, clamp(time, 0, duration));
        video.currentTime = snapped;
        state.currentTime = snapped;
        updateScrub();
        updatePlayhead();
    }
    function play() {
        if (!ranges.length) return;
        const last = ranges[ranges.length - 1];
        if (video.currentTime >= last.srcEnd - 0.05) seek(ranges[0].srcStart);
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
    $('stopBtn').onclick = () => { pause(); seek(ranges.length ? ranges[0].srcStart : 0); };
    $('backBtn').onclick = () => window.close();
    video.addEventListener('ended', () => pause());
    // The render loop drives this frame by frame, but requestAnimationFrame
    // stops in a background tab - timeupdate keeps deleted ranges skipped even
    // when the editor is not on screen.
    video.addEventListener('timeupdate', () => {
        if (!state.playing) return;
        enforcePlayback();
        state.currentTime = video.currentTime;
        updateScrub();
        updatePlayhead();
    });

    // Deleted ranges have no output time, so playback jumps straight from the
    // end of one run of kept footage to the start of the next.
    function enforcePlayback() {
        if (!ranges.length) return;
        const cur = video.currentTime;
        const i = ranges.findIndex(r => cur >= r.srcStart - EPS && cur <= r.srcEnd + EPS);
        const stopAtEnd = () => { pause(); video.currentTime = ranges[ranges.length - 1].srcEnd; };
        if (i >= 0) {
            if (cur < ranges[i].srcEnd - 0.03) return;
            if (ranges[i + 1]) video.currentTime = ranges[i + 1].srcStart;
            else stopAtEnd();
        } else {
            const nx = ranges.find(r => r.srcStart > cur);
            if (nx) video.currentTime = nx.srcStart;
            else stopAtEnd();
        }
    }

    const scrub = $('scrub');
    scrub.min = 0; scrub.max = duration; scrub.step = 0.001;
    scrub.addEventListener('input', () => seek(Number(scrub.value)));

    let lastLabel = '';
    function updateScrub() {
        scrub.value = state.currentTime;
        const label = fmt(EditorCore.srcToOut(regions, state.currentTime)) + ' / ' + fmt(outDuration);
        if (label !== lastLabel) { $('timeLabel').textContent = label; lastLabel = label; }
    }
    function fmt(s) {
        if (isNaN(s)) s = 0;
        const m = Math.floor(s / 60), ss = Math.floor(s % 60);
        return String(m).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
    }
    function fmtMs(s) { return EditorCore.timecode(Math.max(0, s), '.').slice(3); }

    // --- render loop ---
    function renderLoop() {
        if (state.playing) {
            enforcePlayback();
            state.currentTime = video.currentTime;
            updateScrub();
            updatePlayhead();
        }
        EditorCore.drawFrame(ctx, canvas, video, {
            segments: state.segments,
            overlays: state.overlays,
            captions: state.captions,
            captionStyle: state.captionStyle,
            showCaptions: state.previewCaptions,
            time: state.currentTime,
            liveStroke: state.liveStroke
        });
        if (state.tool === 'crop' && state.cropDrag) {
            const d = state.cropDrag;
            ctx.strokeStyle = '#00e5ff'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
            ctx.strokeRect(d.x, d.y, d.w, d.h);
            ctx.setLineDash([]);
        }
        requestAnimationFrame(renderLoop);
    }
    renderLoop();

    // ------------------------------------------------------------------
    // Timeline
    //
    // Every lane shares one horizontal scale: source time. Deleted ranges show
    // up as gaps on the video lane, and overlays/captions stay pinned to the
    // footage they annotate.
    // ------------------------------------------------------------------
    function pct(v) { return (v / duration) * 100; }
    function timeAtX(clientX) {
        const box = tlLanesWrap.getBoundingClientRect();
        return clamp((clientX - box.left) / box.width, 0, 1) * duration;
    }

    function addRow(cls, labelBuilder) {
        const label = document.createElement('div');
        label.className = 'tl-row tl-label ' + cls;
        if (labelBuilder) labelBuilder(label);
        tlLabels.appendChild(label);
        const lane = document.createElement('div');
        lane.className = 'tl-row tl-lane ' + cls;
        tlLanes.appendChild(lane);
        return { label: label, lane: lane };
    }

    function makeClip(lane, model, cls, title) {
        const el = document.createElement('div');
        el.className = 'clip ' + cls;
        const lbl = document.createElement('span');
        lbl.className = 'lbl';
        lbl.textContent = title || '';
        el.appendChild(lbl);
        el._model = model;
        el._label = lbl;
        lane.appendChild(el);
        return el;
    }

    function renderTimeline() {
        tlLabels.innerHTML = '';
        tlLanes.innerHTML = '';

        // ruler
        const ruler = addRow('ruler');
        const stepChoices = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
        const step = stepChoices.find(s => duration / s <= 12) || 900;
        for (let ts = 0; ts <= duration + EPS; ts += step) {
            const tick = document.createElement('div');
            tick.className = 'tick';
            tick.style.left = pct(ts) + '%';
            tick.textContent = fmt(ts);
            ruler.lane.appendChild(tick);
        }

        // video lane
        const vid = addRow('video', (el) => {
            const n = document.createElement('span');
            n.className = 'name';
            n.textContent = t('trackVideo');
            el.appendChild(n);
        });
        const segs = EditorCore.sortSegments(state.segments);
        segs.forEach((s, i) => {
            const el = makeClip(vid.lane, s, 'video' + (s.id === state.selectedSegmentId ? ' active' : ''), '');
            const prev = segs[i - 1], next = segs[i + 1];
            const hl = document.createElement('div');
            hl.className = 'handle left' + (EditorCore.areGlued(prev, s) ? ' glued' : '');
            const hr = document.createElement('div');
            hr.className = 'handle right' + (EditorCore.areGlued(s, next) ? ' glued' : '');
            el.appendChild(hl); el.appendChild(hr);
            el.addEventListener('mousedown', (e) => {
                if (e.target.classList.contains('handle')) return;
                e.stopPropagation();
                state.selectedSegmentId = s.id;
                renderTimeline();
                startScrubDrag(e);
            });
            hl.addEventListener('mousedown', (e) => startTrim(e, s, 'left'));
            hr.addEventListener('mousedown', (e) => startTrim(e, s, 'right'));
        });

        // one lane per overlay item, front-most first
        const ordered = state.overlays.slice().reverse();
        ordered.forEach((o) => {
            const row = addRow('item', (el) => {
                if (o.id === state.selectedOverlayId) el.classList.add('selected');
                const n = document.createElement('span');
                n.className = 'name';
                n.textContent = itemName(o);
                n.title = itemName(o);
                n.onclick = () => selectOverlay(o.id);
                el.appendChild(n);
                el.appendChild(miniBtn('▲', t('btnBringForward'), () => reorderOverlay(o, 1)));
                el.appendChild(miniBtn('▼', t('btnSendBackward'), () => reorderOverlay(o, -1)));
                el.appendChild(miniBtn('✕', t('btnDeleteItem'), () => deleteOverlay(o)));
            });
            const el = makeClip(row.lane, o, 'item ' + o.type + (o.id === state.selectedOverlayId ? ' selected' : ''), itemName(o));
            const hl = document.createElement('div'); hl.className = 'handle left';
            const hr = document.createElement('div'); hr.className = 'handle right';
            el.appendChild(hl); el.appendChild(hr);
            el.addEventListener('mousedown', (e) => {
                if (e.target.classList.contains('handle')) return;
                e.stopPropagation();
                selectOverlay(o.id);
                startItemDrag(e, o, 'move', () => itemBounds(o));
            });
            hl.addEventListener('mousedown', (e) => { selectOverlay(o.id); startItemDrag(e, o, 'left', () => itemBounds(o)); });
            hr.addEventListener('mousedown', (e) => { selectOverlay(o.id); startItemDrag(e, o, 'right', () => itemBounds(o)); });
        });

        // captions lane
        const cap = addRow('cue', (el) => {
            const n = document.createElement('span');
            n.className = 'name';
            n.textContent = t('trackCaptions');
            n.onclick = () => setTool('captions');
            el.appendChild(n);
            el.appendChild(miniBtn('+', t('btnAddCue'), () => addCue()));
        });
        state.captions.forEach((c) => {
            const el = makeClip(cap.lane, c, 'item cue' + (c.id === state.selectedCueId ? ' selected' : ''), c.text);
            const hl = document.createElement('div'); hl.className = 'handle left';
            const hr = document.createElement('div'); hr.className = 'handle right';
            el.appendChild(hl); el.appendChild(hr);
            el.addEventListener('mousedown', (e) => {
                if (e.target.classList.contains('handle')) return;
                e.stopPropagation();
                selectCue(c.id);
                startItemDrag(e, c, 'move', () => cueBounds(c));
            });
            hl.addEventListener('mousedown', (e) => { selectCue(c.id); startItemDrag(e, c, 'left', () => cueBounds(c)); });
            hr.addEventListener('mousedown', (e) => { selectCue(c.id); startItemDrag(e, c, 'right', () => cueBounds(c)); });
        });

        layoutTimeline();
    }

    function miniBtn(label, title, onClick) {
        const b = document.createElement('button');
        b.className = 'mini';
        b.textContent = label;
        b.title = title;
        b.onclick = (e) => { e.stopPropagation(); onClick(); };
        return b;
    }

    function itemName(o) {
        if (o.type === 'text') return 'T · ' + (o.text || '');
        return '✏️ ' + t('itemDoodle');
    }

    function layoutTimeline() {
        tlLanes.querySelectorAll('.clip').forEach((el) => {
            const m = el._model;
            if (!m) return;
            el.style.left = pct(m.start) + '%';
            el.style.width = Math.max(pct(m.end - m.start), 0.4) + '%';
            el.title = fmtMs(m.start) + ' → ' + fmtMs(m.end);
        });
        updatePlayhead();
    }

    function updatePlayhead() {
        playhead.style.left = pct(state.currentTime) + '%';
    }

    function dragWith(onMove, onDone) {
        const move = (ev) => onMove(ev);
        const up = () => {
            window.removeEventListener('mousemove', move);
            window.removeEventListener('mouseup', up);
            if (onDone) onDone();
        };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
    }

    function startScrubDrag(e) {
        seek(timeAtX(e.clientX));
        dragWith((ev) => seek(timeAtX(ev.clientX)));
    }
    tlLanesWrap.addEventListener('mousedown', (e) => {
        if (e.target.closest('.clip')) return;
        startScrubDrag(e);
    });

    // ------------------------------------------------------------------
    // Clip trimming / splitting / deleting
    // ------------------------------------------------------------------
    function startTrim(e, seg, side) {
        e.stopPropagation();
        e.preventDefault();
        pushHistory();
        dragWith((ev) => {
            EditorCore.trimSegment(state.segments, seg, side, timeAtX(ev.clientX), duration);
            rebuild();
            layoutTimeline();
        }, () => {
            rebuild();
            seek(state.currentTime);
            renderTimeline();
            updateScrub();
        });
    }

    $('splitBtn').onclick = () => {
        const at = state.currentTime;
        const hit = EditorCore.regionAtSrc(regions, at);
        const target = hit ? segById(hit.id) : activeSeg();
        if (!target || at <= target.start + EditorCore.MIN_SEG || at >= target.end - EditorCore.MIN_SEG) return;
        pushHistory();
        const res = EditorCore.splitSegment(state.segments, target, at);
        state.selectedSegmentId = res.second.id;
        rebuild();
        renderTimeline();
    };

    $('deleteBtn').onclick = () => {
        if (state.segments.length <= 1) return;
        const seg = activeSeg();
        if (!seg) return;
        pushHistory();
        const idx = state.segments.indexOf(seg);
        state.segments = state.segments.filter(s => s.id !== seg.id);
        const nextSel = state.segments[Math.min(idx, state.segments.length - 1)];
        state.selectedSegmentId = nextSel ? nextSel.id : null;
        rebuild();
        seek(state.currentTime);
        renderAll();
    };

    $('clearCrop').onclick = () => { const s = activeSeg(); if (s) { pushHistory(); s.crop = null; } };
    $('clearCrop2').onclick = () => { const s = activeSeg(); if (s) { pushHistory(); s.crop = null; } };
    $('clearPanZoom').onclick = () => { const s = activeSeg(); if (s) { pushHistory(); s.panZoom = null; } };

    // ------------------------------------------------------------------
    // Overlay / caption items on their own lanes
    // ------------------------------------------------------------------
    function itemBounds() { return { min: 0, max: duration }; }

    // Subtitles must not overlap, so a cue is bounded by its neighbours.
    function cueBounds(c) {
        const list = state.captions;
        const i = list.indexOf(c);
        return {
            min: i > 0 ? list[i - 1].end : 0,
            max: i < list.length - 1 ? list[i + 1].start : duration
        };
    }

    function startItemDrag(e, item, mode, boundsFn) {
        e.stopPropagation();
        e.preventDefault();
        pushHistory();
        const box = tlLanesWrap.getBoundingClientRect();
        const startX = e.clientX;
        const orig = { start: item.start, end: item.end };
        dragWith((ev) => {
            const b = boundsFn();
            const dt = ((ev.clientX - startX) / box.width) * duration;
            if (mode === 'move') {
                const len = orig.end - orig.start;
                let s = clamp(orig.start + dt, b.min, Math.max(b.min, b.max - len));
                item.start = s;
                item.end = s + len;
            } else if (mode === 'left') {
                item.start = clamp(orig.start + dt, b.min, item.end - MIN_ITEM);
            } else {
                item.end = clamp(orig.end + dt, item.start + MIN_ITEM, b.max);
            }
            layoutTimeline();
        }, () => {
            if (item.type === 'text' || item.type === 'doodle') updateItemPanels();
            else { sortCues(); renderCueList(); }
            renderTimeline();
        });
    }

    function selectOverlay(id) {
        state.selectedOverlayId = id;
        const o = overlayById(id);
        if (o) setTool(o.type === 'text' ? 'text' : 'doodle');
        renderTimeline();
        updateItemPanels();
    }

    function reorderOverlay(o, dir) {
        const i = state.overlays.indexOf(o);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= state.overlays.length) return;
        pushHistory();
        state.overlays.splice(i, 1);
        state.overlays.splice(j, 0, o);
        renderTimeline();
    }

    function deleteOverlay(o) {
        pushHistory();
        state.overlays = state.overlays.filter(x => x !== o);
        if (state.selectedOverlayId === o.id) state.selectedOverlayId = null;
        renderTimeline();
        updateItemPanels();
    }

    // ------------------------------------------------------------------
    // Tools
    // ------------------------------------------------------------------
    function setTool(tool) {
        state.tool = tool;
        document.querySelectorAll('.tool').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
        $('panelCrop').hidden = tool !== 'crop';
        $('panelPanZoom').hidden = tool !== 'panzoom';
        $('panelDoodle').hidden = tool !== 'doodle';
        $('panelText').hidden = tool !== 'text';
        $('panelCaptions').hidden = tool !== 'captions';
    }
    document.querySelectorAll('.tool').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));

    function canvasPos(e) {
        const r = canvas.getBoundingClientRect();
        return {
            x: (e.clientX - r.left) * (canvas.width / r.width),
            y: (e.clientY - r.top) * (canvas.height / r.height)
        };
    }

    // Front-most visible text under the pointer.
    function textAt(p) {
        for (let i = state.overlays.length - 1; i >= 0; i--) {
            const o = state.overlays[i];
            if (o.type !== 'text' || state.currentTime < o.start || state.currentTime > o.end) continue;
            const b = EditorCore.hitTestText(ctx, canvas, o);
            if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return o;
        }
        return null;
    }

    canvas.addEventListener('mousedown', (e) => {
        const p = canvasPos(e);
        if (state.tool === 'crop') {
            state.cropDrag = { x: p.x, y: p.y, w: 0, h: 0 };
            const ar = canvas.width / canvas.height;
            dragWith((ev) => {
                const p2 = canvasPos(ev);
                let x = Math.min(p.x, p2.x), y = Math.min(p.y, p2.y);
                let w = Math.abs(p2.x - p.x), h = Math.abs(p2.y - p.y);
                if (w / Math.max(h, 1) > ar) h = w / ar; else w = h * ar;
                if (x + w > canvas.width) x = canvas.width - w;
                if (y + h > canvas.height) y = canvas.height - h;
                state.cropDrag = { x: x, y: y, w: w, h: h };
            }, () => {
                const d = state.cropDrag;
                state.cropDrag = null;
                if (d && d.w > 8 && d.h > 8) {
                    const seg = activeSeg();
                    if (seg) {
                        pushHistory();
                        seg.crop = { x: d.x / canvas.width, y: d.y / canvas.height, w: d.w / canvas.width, h: d.h / canvas.height };
                    }
                }
            });
            return;
        }

        if (state.tool === 'doodle') {
            const dur = Math.max(0.2, Number($('doodleDuration').value) || 4);
            const stroke = {
                id: uid(), type: 'doodle',
                color: $('doodleColor').value,
                width: Number($('doodleWidth').value),
                points: [{ x: p.x / canvas.width, y: p.y / canvas.height }],
                animate: false,
                start: state.currentTime,
                end: Math.min(duration, state.currentTime + dur)
            };
            if (stroke.end - stroke.start < MIN_ITEM) stroke.start = Math.max(0, stroke.end - MIN_ITEM);
            state.liveStroke = stroke;
            dragWith((ev) => {
                const p2 = canvasPos(ev);
                stroke.points.push({ x: p2.x / canvas.width, y: p2.y / canvas.height });
            }, () => {
                state.liveStroke = null;
                if (stroke.points.length > 1) {
                    pushHistory();
                    state.overlays.push(stroke);
                    state.selectedOverlayId = stroke.id;
                    renderTimeline();
                    updateItemPanels();
                }
            });
            return;
        }

        // select / text: pick up the text under the pointer and move it
        const hit = textAt(p);
        if (!hit) return;
        state.selectedOverlayId = hit.id;
        setTool('text');
        renderTimeline();
        updateItemPanels();
        pushHistory();
        const orig = { x: hit.x, y: hit.y };
        dragWith((ev) => {
            const p2 = canvasPos(ev);
            hit.x = clamp(orig.x + (p2.x - p.x) / canvas.width, 0, 1);
            hit.y = clamp(orig.y + (p2.y - p.y) / canvas.height, 0, 1);
        });
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
        pushHistory();
        seg.panZoom = {
            from: { x: Number(pz.fromX.value), y: Number(pz.fromY.value), zoom: Number(pz.fromZoom.value) },
            to: { x: Number(pz.toX.value), y: Number(pz.toY.value), zoom: Number(pz.toZoom.value) }
        };
    };

    // ------------------------------------------------------------------
    // Text overlays
    // ------------------------------------------------------------------
    $('addTextBtn').onclick = () => {
        pushHistory();
        const start = state.currentTime;
        const ov = {
            id: uid(), type: 'text', text: t('txtText'),
            x: 0.5, y: 0.5, color: '#ffffff', size: 0.06, font: 'sans-serif', bold: true,
            start: start, end: Math.min(duration, start + 4)
        };
        if (ov.end - ov.start < MIN_ITEM) ov.start = Math.max(0, ov.end - MIN_ITEM);
        state.overlays.push(ov);
        state.selectedOverlayId = ov.id;
        renderTimeline();
        updateItemPanels();
    };

    function selectedText() {
        const o = overlayById(state.selectedOverlayId);
        return o && o.type === 'text' ? o : null;
    }
    function selectedDoodle() {
        const o = overlayById(state.selectedOverlayId);
        return o && o.type === 'doodle' ? o : null;
    }

    function updateItemPanels() {
        const tx = selectedText();
        $('textProps').hidden = !tx;
        if (tx) {
            $('textValue').value = tx.text;
            $('textColor').value = tx.color;
            $('textSize').value = tx.size;
            $('textStart').value = tx.start.toFixed(2);
            $('textEnd').value = tx.end.toFixed(2);
        }
        const dd = selectedDoodle();
        $('doodleProps').hidden = !dd;
        if (dd) {
            $('dSelColor').value = dd.color;
            $('dSelWidth').value = dd.width;
            $('dSelAnimate').checked = !!dd.animate;
            $('dSelStart').value = dd.start.toFixed(2);
            $('dSelEnd').value = dd.end.toFixed(2);
        }
    }

    function bindItemTiming(startEl, endEl, getter) {
        startEl.onchange = () => {
            const o = getter();
            if (!o) return;
            pushHistory();
            o.start = clamp(Number(startEl.value), 0, o.end - MIN_ITEM);
            startEl.value = o.start.toFixed(2);
            renderTimeline();
        };
        endEl.onchange = () => {
            const o = getter();
            if (!o) return;
            pushHistory();
            o.end = clamp(Number(endEl.value), o.start + MIN_ITEM, duration);
            endEl.value = o.end.toFixed(2);
            renderTimeline();
        };
    }

    $('textValue').oninput = () => { const o = selectedText(); if (o) { o.text = $('textValue').value; layoutItemNames(); } };
    $('textColor').oninput = () => { const o = selectedText(); if (o) o.color = $('textColor').value; };
    $('textSize').oninput = () => { const o = selectedText(); if (o) o.size = Number($('textSize').value); };
    bindItemTiming($('textStart'), $('textEnd'), selectedText);
    $('textForward').onclick = () => { const o = selectedText(); if (o) reorderOverlay(o, 1); };
    $('textBackward').onclick = () => { const o = selectedText(); if (o) reorderOverlay(o, -1); };

    $('dSelColor').oninput = () => { const o = selectedDoodle(); if (o) o.color = $('dSelColor').value; };
    $('dSelWidth').oninput = () => { const o = selectedDoodle(); if (o) o.width = Number($('dSelWidth').value); };
    $('dSelAnimate').onchange = () => { const o = selectedDoodle(); if (o) o.animate = $('dSelAnimate').checked; };
    bindItemTiming($('dSelStart'), $('dSelEnd'), selectedDoodle);

    // Cheap refresh for label text while typing, without rebuilding the lanes.
    function layoutItemNames() {
        tlLanes.querySelectorAll('.clip.item').forEach((el) => {
            const m = el._model;
            if (m && el._label) el._label.textContent = m.type ? itemName(m) : m.text;
        });
        const ordered = state.overlays.slice().reverse();
        tlLabels.querySelectorAll('.tl-label.item .name').forEach((el, i) => {
            if (ordered[i]) { el.textContent = itemName(ordered[i]); el.title = el.textContent; }
        });
    }

    // ------------------------------------------------------------------
    // Captions
    // ------------------------------------------------------------------
    function sortCues() { state.captions.sort((a, b) => a.start - b.start); }

    function addCue() {
        const cues = state.captions;
        let start = state.currentTime;
        for (const c of cues) if (start >= c.start - EPS && start < c.end) start = c.end;
        let end = Math.min(start + 2, duration);
        const next = cues.find(c => c.start > start + EPS);
        if (next) end = Math.min(end, next.start);
        if (end - start < 0.2) { alert(t('capNoRoom')); return null; }
        pushHistory();
        const cue = { id: uid(), start: start, end: end, text: '' };
        state.captions.push(cue);
        sortCues();
        state.selectedCueId = cue.id;
        setTool('captions');
        renderTimeline();
        renderCueList();
        $('cueText').focus();
        return cue;
    }
    $('addCueBtn').onclick = () => addCue();

    function selectCue(id) {
        state.selectedCueId = id;
        setTool('captions');
        renderTimeline();
        renderCueList();
    }

    function selectedCue() { return cueById(state.selectedCueId); }

    function renderCueList() {
        const list = $('cueList');
        list.innerHTML = '';
        state.captions.forEach((c, i) => {
            const el = document.createElement('div');
            el.className = 'cue-item' + (c.id === state.selectedCueId ? ' active' : '');
            const idx = document.createElement('span');
            idx.className = 'idx'; idx.textContent = (i + 1);
            const tc = document.createElement('span');
            tc.className = 'tc'; tc.textContent = fmtMs(c.start);
            const txt = document.createElement('span');
            txt.className = 'txt'; txt.textContent = c.text || '…';
            el.append(idx, tc, txt);
            el.onclick = () => { selectCue(c.id); seek(c.start); };
            list.appendChild(el);
        });
        const cue = selectedCue();
        $('cueProps').hidden = !cue;
        if (cue) {
            if (document.activeElement !== $('cueText')) $('cueText').value = cue.text;
            $('cueStart').value = cue.start.toFixed(2);
            $('cueEnd').value = cue.end.toFixed(2);
        }
    }

    $('cueText').oninput = () => {
        const c = selectedCue();
        if (!c) return;
        c.text = $('cueText').value;
        const el = $('cueList').querySelector('.cue-item.active .txt');
        if (el) el.textContent = c.text || '…';
        tlLanes.querySelectorAll('.clip.cue').forEach((n) => {
            if (n._model === c && n._label) n._label.textContent = c.text;
        });
    };
    $('cueStart').onchange = () => {
        const c = selectedCue();
        if (!c) return;
        pushHistory();
        const b = cueBounds(c);
        c.start = clamp(Number($('cueStart').value), b.min, c.end - MIN_ITEM);
        sortCues(); renderTimeline(); renderCueList();
    };
    $('cueEnd').onchange = () => {
        const c = selectedCue();
        if (!c) return;
        pushHistory();
        const b = cueBounds(c);
        c.end = clamp(Number($('cueEnd').value), c.start + MIN_ITEM, b.max);
        sortCues(); renderTimeline(); renderCueList();
    };

    $('splitCueBtn').onclick = () => {
        const c = selectedCue();
        if (!c) return;
        const at = state.currentTime;
        if (at <= c.start + MIN_ITEM || at >= c.end - MIN_ITEM) return;
        pushHistory();
        const second = { id: uid(), start: at, end: c.end, text: c.text };
        c.end = at;
        state.captions.push(second);
        sortCues();
        state.selectedCueId = second.id;
        renderTimeline(); renderCueList();
    };

    $('mergeCueBtn').onclick = () => {
        const c = selectedCue();
        if (!c) return;
        const i = state.captions.indexOf(c);
        const next = state.captions[i + 1];
        if (!next) return;
        pushHistory();
        c.end = next.end;
        c.text = [c.text, next.text].filter(Boolean).join(' ');
        state.captions.splice(i + 1, 1);
        renderTimeline(); renderCueList();
    };

    $('delCueBtn').onclick = () => {
        const c = selectedCue();
        if (!c) return;
        pushHistory();
        state.captions = state.captions.filter(x => x !== c);
        state.selectedCueId = null;
        renderTimeline(); renderCueList();
    };

    function shiftCues(by) {
        if (!state.captions.length) return;
        pushHistory();
        for (const c of state.captions) {
            const len = c.end - c.start;
            c.start = clamp(c.start + by, 0, Math.max(0, duration - len));
            c.end = Math.min(duration, c.start + len);
        }
        sortCues();
        renderTimeline(); renderCueList();
    }
    $('capShiftFwd').onclick = () => shiftCues(Math.abs(Number($('capShift').value) || 0));
    $('capShiftBack').onclick = () => shiftCues(-Math.abs(Number($('capShift').value) || 0));

    $('importSubsBtn').onclick = () => $('subsFile').click();
    $('subsFile').onchange = async () => {
        const file = $('subsFile').files[0];
        if (!file) return;
        const text = await file.text();
        const parsed = EditorCore.parseSubtitles(text);
        $('subsFile').value = '';
        if (!parsed.length) { alert(t('capImportEmpty')); return; }
        pushHistory();
        // Imported files are timed against the finished video, so map them back
        // onto the source timeline the cues are edited in.
        state.captions = parsed.map(c => {
            const start = clamp(EditorCore.outToSrc(regions, c.start), 0, duration);
            const end = clamp(EditorCore.outToSrc(regions, c.end), start + MIN_ITEM, duration);
            return { id: uid(), start: start, end: end, text: c.text };
        });
        sortCues();
        state.selectedCueId = state.captions.length ? state.captions[0].id : null;
        renderTimeline(); renderCueList();
    };

    // caption style
    $('capSize').oninput = () => { state.captionStyle.size = Number($('capSize').value); };
    $('capColor').oninput = () => { state.captionStyle.color = $('capColor').value; };
    $('capBg').oninput = () => { state.captionStyle.bg = Number($('capBg').value); };
    $('capPosition').onchange = () => { state.captionStyle.position = $('capPosition').value; };
    $('capPreview').onchange = () => { state.previewCaptions = $('capPreview').checked; };

    function subtitleBlob(format) {
        const body = format === 'vtt'
            ? EditorCore.toVTT(state.captions, regions)
            : EditorCore.toSRT(state.captions, regions);
        return new Blob([body], { type: format === 'vtt' ? 'text/vtt' : 'application/x-subrip' });
    }
    function baseName() { return recName.replace(/\.[^.]+$/, '') + '_edited'; }
    function downloadSubtitles(format) {
        if (!EditorCore.cueEntries(state.captions, regions).length) { alert(t('capNothing')); return; }
        if (state.subsUrl) URL.revokeObjectURL(state.subsUrl);
        state.subsUrl = URL.createObjectURL(subtitleBlob(format));
        state.subsName = baseName() + '.' + format;
        chrome.runtime.sendMessage({ type: 'DOWNLOAD', url: state.subsUrl, filename: state.subsName });
    }
    $('dlSrtBtn').onclick = () => downloadSubtitles('srt');
    $('dlVttBtn').onclick = () => downloadSubtitles('vtt');

    // ------------------------------------------------------------------
    // Export
    // ------------------------------------------------------------------
    $('exportBtn').onclick = () => { $('exportPanel').hidden = false; };
    $('exportCancel').onclick = () => { $('exportPanel').hidden = true; };
    $('exportBitrate').oninput = () => { $('exportBitrateVal').textContent = $('exportBitrate').value + ' Mbps'; };

    $('runExport').onclick = async () => {
        if (!ranges.length) { alert(t('exportNothing')); return; }
        pause();
        const format = $('exportFormat').value;
        const resolution = $('exportResolution').value;
        const bitrate = Number($('exportBitrate').value);
        const fps = Number($('exportFps').value);
        const burn = $('exportBurn').checked;
        const subsFormat = $('exportSubs').value;
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

        $('runExport').disabled = true;
        $('exportProgressWrap').hidden = false;
        $('exportResult').hidden = true;
        state.exportUrl = null;

        const drawFrame = () => EditorCore.drawFrame(expCtx, expCanvas, video, {
            segments: state.segments,
            overlays: state.overlays,
            captions: state.captions,
            captionStyle: state.captionStyle,
            showCaptions: burn,
            time: video.currentTime
        });

        try {
            const blob = await EXPORT.render({
                video: video,
                canvas: expCanvas,
                regions: ranges,
                totalDuration: outDuration,
                fps: fps,
                format: format,
                vbps: Math.round(bitrate * 1000000),
                abps: 160000,
                drawFrame: drawFrame,
                onProgress: (p) => { $('exportProgress').value = p; $('exportPct').textContent = Math.round(p * 100) + '%'; }
            });
            if (state.exportUrl) URL.revokeObjectURL(state.exportUrl);
            state.exportUrl = URL.createObjectURL(blob);
            state.exportName = baseName() + '.' + (format === 'mp4' ? 'mp4' : 'webm');
            const hasCues = EditorCore.cueEntries(state.captions, regions).length > 0;
            $('dlSubs').hidden = subsFormat === 'none' || !hasCues;
            $('dlSubs').dataset.format = subsFormat;
            $('exportResult').hidden = false;
        } catch (e) {
            alert('Export failed: ' + (e && e.message ? e.message : e));
        } finally {
            $('runExport').disabled = false;
            seek(state.currentTime);
        }
    };

    $('dlExport').onclick = () => {
        if (state.exportUrl) chrome.runtime.sendMessage({ type: 'DOWNLOAD', url: state.exportUrl, filename: state.exportName });
    };
    $('dlSubs').onclick = () => downloadSubtitles($('dlSubs').dataset.format || 'srt');
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

    // ------------------------------------------------------------------
    // Shortcuts
    // ------------------------------------------------------------------
    window.addEventListener('keydown', (e) => {
        const el = document.activeElement;
        const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            if (e.shiftKey) redo(); else undo();
            return;
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
        if (typing) return;
        if (e.code === 'Space') { e.preventDefault(); state.playing ? pause() : play(); }
        else if (e.key === 's' || e.key === 'S') { e.preventDefault(); $('splitBtn').click(); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); seek(state.currentTime - (e.shiftKey ? 1 : 0.1)); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); seek(state.currentTime + (e.shiftKey ? 1 : 0.1)); }
    });

    // ------------------------------------------------------------------
    // Init
    // ------------------------------------------------------------------
    function renderAll() {
        renderTimeline();
        renderCueList();
        updateItemPanels();
        updateScrub();
        updateHistoryButtons();
    }

    $('capSize').value = state.captionStyle.size;
    $('capColor').value = state.captionStyle.color;
    $('capBg').value = state.captionStyle.bg;
    $('capPosition').value = state.captionStyle.position;
    setTool('select');
    seek(0);
    renderAll();
    pause();
})();
