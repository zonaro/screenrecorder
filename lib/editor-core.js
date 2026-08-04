// lib/editor-core.js
const EditorCore = (() => {
    const EPS = 1e-4;
    // Two clips count as glued together when their boundary matches within
    // this tolerance; trimming one side then has to drag the other along.
    const LINK_EPS = 1e-3;
    const MIN_SEG = 0.05;

    function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
    function sortSegments(segments) { return segments.slice().sort((a, b) => a.start - b.start); }

    // ---------------------------------------------------------------------
    // Timeline model
    //
    // Segments hold *source* times. The clips that survive are played back to
    // back, so every source time also has an *output* time - the position it
    // ends up at in the exported video. Deleted parts simply have no output
    // time at all, which is what makes "the previous clip jumps straight to
    // the next one" work for playback, export and subtitles alike.
    // ---------------------------------------------------------------------
    function buildRegions(segments) {
        const regions = [];
        let acc = 0;
        for (const s of sortSegments(segments)) {
            const d = s.end - s.start;
            if (d <= EPS) continue;
            regions.push({ id: s.id, srcStart: s.start, srcEnd: s.end, outStart: acc, outEnd: acc + d });
            acc += d;
        }
        return regions;
    }

    function outputDuration(regions) { return regions.length ? regions[regions.length - 1].outEnd : 0; }

    // Glued clips play as one continuous run of source video. Merging them
    // gives the ranges playback and export actually have to seek between, so a
    // plain split never costs a seek.
    function mergeRegions(regions) {
        const out = [];
        for (const r of regions) {
            const p = out[out.length - 1];
            if (p && Math.abs(r.srcStart - p.srcEnd) < LINK_EPS) { p.srcEnd = r.srcEnd; p.outEnd = r.outEnd; }
            else out.push({ srcStart: r.srcStart, srcEnd: r.srcEnd, outStart: r.outStart, outEnd: r.outEnd });
        }
        return out;
    }

    function regionAtSrc(regions, t) {
        for (const r of regions) if (t >= r.srcStart - EPS && t <= r.srcEnd + EPS) return r;
        return null;
    }

    // Nearest source time that still exists in the output, so the playhead can
    // never sit inside a deleted range.
    function snapToRegions(regions, t) {
        if (!regions.length) return t;
        const r = regionAtSrc(regions, t);
        if (r) return clamp(t, r.srcStart, r.srcEnd);
        let best = regions[0].srcStart, bestD = Infinity;
        for (const rg of regions) {
            const edges = [rg.srcStart, rg.srcEnd];
            for (const e of edges) {
                const d = Math.abs(e - t);
                if (d < bestD) { bestD = d; best = e; }
            }
        }
        return best;
    }

    function srcToOut(regions, t) {
        if (!regions.length) return 0;
        let last = 0;
        for (const r of regions) {
            if (t < r.srcStart) return r.outStart;
            if (t <= r.srcEnd) return r.outStart + (t - r.srcStart);
            last = r.outEnd;
        }
        return last;
    }

    function outToSrc(regions, t) {
        if (!regions.length) return 0;
        for (const r of regions) if (t <= r.outEnd + EPS) return r.srcStart + Math.max(0, t - r.outStart);
        return regions[regions.length - 1].srcEnd;
    }

    // A source range can straddle deleted parts; it maps to one or more output
    // intervals (merged when the pieces end up adjacent in the output).
    function mapRangeToOut(regions, s, e) {
        const out = [];
        for (const r of regions) {
            const a = Math.max(s, r.srcStart), b = Math.min(e, r.srcEnd);
            if (b - a <= EPS) continue;
            const iv = { start: r.outStart + (a - r.srcStart), end: r.outStart + (b - r.srcStart) };
            const prev = out[out.length - 1];
            if (prev && iv.start - prev.end <= EPS) prev.end = iv.end;
            else out.push(iv);
        }
        return out;
    }

    // ---------------------------------------------------------------------
    // Trimming
    //
    // Clip boundaries in the middle of the video stay glued: dragging the end
    // of a clip moves the start of the next one by the same amount, so a trim
    // can never open a hole. Only the outer edges of a run of glued clips are
    // free to move (start later / end earlier).
    // ---------------------------------------------------------------------
    function areGlued(a, b) { return !!a && !!b && Math.abs(a.end - b.start) < LINK_EPS; }

    function trimSegment(segments, seg, side, t, duration) {
        const list = sortSegments(segments);
        const i = list.indexOf(seg);
        if (i < 0) return;
        const prev = list[i - 1] || null;
        const next = list[i + 1] || null;
        if (side === 'left') {
            const glued = areGlued(prev, seg);
            const min = glued ? prev.start + MIN_SEG : (prev ? prev.end : 0);
            const max = seg.end - MIN_SEG;
            const v = clamp(t, min, Math.max(min, max));
            seg.start = v;
            if (glued) prev.end = v;
        } else {
            const glued = areGlued(seg, next);
            const max = glued ? next.end - MIN_SEG : (next ? next.start : duration);
            const min = seg.start + MIN_SEG;
            const v = clamp(t, Math.min(min, max), max);
            seg.end = v;
            if (glued) next.start = v;
        }
    }

    function splitSegment(segments, seg, t) {
        if (!seg || t <= seg.start + MIN_SEG || t >= seg.end - MIN_SEG) return null;
        const a = { id: seg.id, start: seg.start, end: t, crop: seg.crop, panZoom: seg.panZoom };
        const b = { id: 'id-' + Math.random().toString(36).slice(2, 10), start: t, end: seg.end, crop: seg.crop, panZoom: seg.panZoom };
        const idx = segments.indexOf(seg);
        segments.splice(idx, 1, a, b);
        return { first: a, second: b };
    }

    // ---------------------------------------------------------------------
    // Rendering
    // ---------------------------------------------------------------------
    function normToPx(n, vw, vh) {
        return { x: n.x * vw, y: n.y * vh, w: n.w * vw, h: n.h * vh };
    }

    // Source rectangle of the video for a segment at time t (crop + pan/zoom).
    function sourceRectFor(seg, t, vw, vh) {
        let base = { x: 0, y: 0, w: vw, h: vh };
        if (seg.crop) base = normToPx(seg.crop, vw, vh);
        if (seg.panZoom) {
            const p = seg.end > seg.start ? clamp((t - seg.start) / (seg.end - seg.start), 0, 1) : 0;
            const f = seg.panZoom.from, to = seg.panZoom.to;
            const zoom = f.zoom + (to.zoom - f.zoom) * p;
            const px = f.x + (to.x - f.x) * p;
            const py = f.y + (to.y - f.y) * p;
            const w = base.w / zoom, h = base.h / zoom;
            const cx = base.x + base.w / 2 + px * base.w;
            const cy = base.y + base.h / 2 + py * base.h;
            return { x: cx - w / 2, y: cy - h / 2, w: w, h: h };
        }
        return base;
    }

    function drawStroke(ctx, canvas, stroke, points) {
        if (!points || points.length < 2) return;
        ctx.save();
        ctx.strokeStyle = stroke.color || '#ff0000';
        ctx.lineWidth = Math.max(1, (stroke.width || 4) * (canvas.width / 1920));
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        for (let i = 0; i < points.length; i++) {
            const p = points[i];
            const x = p.x * canvas.width, y = p.y * canvas.height;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.restore();
    }

    // Doodles are visible for their whole item duration; with "animate" on they
    // are drawn on progressively across that duration instead.
    function strokePointsAt(o, t) {
        if (!o.animate) return o.points;
        const dur = Math.max(0.05, o.end - o.start);
        const p = clamp((t - o.start) / dur, 0, 1);
        return o.points.slice(0, Math.max(2, Math.ceil(p * o.points.length)));
    }

    function textMetrics(ctx, canvas, o) {
        const size = o.size * canvas.height;
        ctx.font = (o.bold ? 'bold ' : '') + size + 'px ' + (o.font || 'sans-serif');
        const w = ctx.measureText(o.text || '').width;
        return { size: size, w: w, h: size * 1.2, x: o.x * canvas.width, y: o.y * canvas.height };
    }

    function drawText(ctx, canvas, o) {
        ctx.save();
        const m = textMetrics(ctx, canvas, o);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = Math.max(2, m.size * 0.08);
        ctx.strokeStyle = 'rgba(0,0,0,0.85)';
        ctx.strokeText(o.text, m.x, m.y);
        ctx.fillStyle = o.color || '#ffffff';
        ctx.fillText(o.text, m.x, m.y);
        ctx.restore();
    }

    function hitTestText(ctx, canvas, o) {
        const m = textMetrics(ctx, canvas, o);
        return { x: m.x - m.w / 2, y: m.y - m.h / 2, w: m.w, h: m.h };
    }

    function wrapLines(ctx, text, maxWidth) {
        const out = [];
        for (const para of String(text).split('\n')) {
            const words = para.split(/\s+/).filter(Boolean);
            if (!words.length) { out.push(''); continue; }
            let line = words[0];
            for (let i = 1; i < words.length; i++) {
                const test = line + ' ' + words[i];
                if (ctx.measureText(test).width > maxWidth) { out.push(line); line = words[i]; }
                else line = test;
            }
            out.push(line);
        }
        return out;
    }

    function cueAt(captions, t) {
        for (const c of captions) if (t >= c.start && t <= c.end) return c;
        return null;
    }

    function drawCaption(ctx, canvas, cue, style) {
        const text = (cue.text || '').trim();
        if (!text) return;
        const st = style || {};
        const size = Math.max(8, (st.size == null ? 0.055 : st.size) * canvas.height);
        ctx.save();
        ctx.font = '600 ' + size + 'px ' + (st.font || 'sans-serif');
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const lines = wrapLines(ctx, text, canvas.width * 0.86);
        const lh = size * 1.28;
        const total = lines.length * lh;
        const margin = canvas.height * 0.06;
        const top = st.position === 'top' ? margin : canvas.height - margin - total;
        const cx = canvas.width / 2;
        const padX = size * 0.4;
        const bg = st.bg == null ? 0.55 : st.bg;
        for (let i = 0; i < lines.length; i++) {
            const ln = lines[i];
            if (!ln) continue;
            const cy = top + i * lh + lh / 2;
            if (bg > 0) {
                const w = ctx.measureText(ln).width;
                ctx.fillStyle = 'rgba(0,0,0,' + bg + ')';
                ctx.fillRect(cx - w / 2 - padX, cy - lh / 2, w + padX * 2, lh);
            } else {
                ctx.lineWidth = Math.max(2, size * 0.09);
                ctx.strokeStyle = 'rgba(0,0,0,0.9)';
                ctx.strokeText(ln, cx, cy);
            }
            ctx.fillStyle = st.color || '#ffffff';
            ctx.fillText(ln, cx, cy);
        }
        ctx.restore();
    }

    // opts: { segments, overlays, captions, captionStyle, time, liveStroke, showCaptions }
    function drawFrame(ctx, canvas, video, opts) {
        const o = opts || {};
        const t = o.time || 0;
        const vw = video.videoWidth, vh = video.videoHeight;
        if (!vw || !vh) return;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        const segments = o.segments || [];
        let seg = null;
        for (const s of segments) if (t >= s.start - EPS && t <= s.end + EPS) { seg = s; break; }
        if (seg) {
            const src = sourceRectFor(seg, t, vw, vh);
            ctx.drawImage(video, src.x, src.y, src.w, src.h, 0, 0, canvas.width, canvas.height);
        }
        // Array order is the stacking order: later items paint on top.
        for (const item of (o.overlays || [])) {
            if (item.hidden || t < item.start || t > item.end) continue;
            if (item.type === 'text') drawText(ctx, canvas, item);
            else if (item.type === 'doodle') drawStroke(ctx, canvas, item, strokePointsAt(item, t));
        }
        if (o.liveStroke && o.liveStroke.points.length) drawStroke(ctx, canvas, o.liveStroke, o.liveStroke.points);
        if (o.showCaptions) {
            const cue = cueAt(o.captions || [], t);
            if (cue) drawCaption(ctx, canvas, cue, o.captionStyle);
        }
    }

    // ---------------------------------------------------------------------
    // Subtitles
    // ---------------------------------------------------------------------
    function pad(n, l) { return String(n).padStart(l, '0'); }

    function timecode(t, sep) {
        const ms = Math.max(0, Math.round(t * 1000));
        const h = Math.floor(ms / 3600000);
        const m = Math.floor((ms % 3600000) / 60000);
        const s = Math.floor((ms % 60000) / 1000);
        return pad(h, 2) + ':' + pad(m, 2) + ':' + pad(s, 2) + sep + pad(ms % 1000, 3);
    }

    // Cues are authored against the source video; the subtitle file has to be
    // in output time, with anything inside a deleted range dropped.
    function cueEntries(captions, regions) {
        const entries = [];
        for (const c of captions) {
            const text = (c.text || '').trim();
            if (!text || c.end <= c.start) continue;
            for (const iv of mapRangeToOut(regions, c.start, c.end)) {
                if (iv.end - iv.start < 0.05) continue;
                entries.push({ start: iv.start, end: iv.end, text: text });
            }
        }
        entries.sort((a, b) => a.start - b.start || a.end - b.end);
        for (let i = 0; i < entries.length - 1; i++) {
            if (entries[i].end > entries[i + 1].start) entries[i].end = entries[i + 1].start;
        }
        return entries.filter(e => e.end - e.start >= 0.05);
    }

    function toSRT(captions, regions) {
        return cueEntries(captions, regions).map((c, i) =>
            (i + 1) + '\n' + timecode(c.start, ',') + ' --> ' + timecode(c.end, ',') + '\n' + c.text + '\n'
        ).join('\n');
    }

    function toVTT(captions, regions) {
        return 'WEBVTT\n\n' + cueEntries(captions, regions).map((c) =>
            timecode(c.start, '.') + ' --> ' + timecode(c.end, '.') + '\n' + c.text + '\n'
        ).join('\n');
    }

    const TIME_RE = /(\d{1,3}:)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})\s*-->\s*(\d{1,3}:)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})/;

    function toSec(h, m, s, ms) {
        const hh = h ? parseInt(h, 10) : 0;
        return hh * 3600 + parseInt(m, 10) * 60 + parseInt(s, 10) + parseInt(String(ms).padEnd(3, '0'), 10) / 1000;
    }

    // Accepts SRT and WebVTT; returns cues in output time.
    function parseSubtitles(text) {
        const lines = String(text).replace(/\r/g, '').split('\n');
        const out = [];
        let i = 0;
        while (i < lines.length) {
            const m = TIME_RE.exec(lines[i]);
            if (!m) { i++; continue; }
            const start = toSec(m[1], m[2], m[3], m[4]);
            const end = toSec(m[5], m[6], m[7], m[8]);
            i++;
            const buf = [];
            while (i < lines.length && lines[i].trim() !== '') { buf.push(lines[i]); i++; }
            const body = buf.join('\n').trim();
            if (body && end > start) out.push({ start: start, end: end, text: body });
        }
        return out;
    }

    return {
        EPS, MIN_SEG,
        clamp, sortSegments,
        buildRegions, mergeRegions, outputDuration, regionAtSrc, snapToRegions,
        srcToOut, outToSrc, mapRangeToOut,
        areGlued, trimSegment, splitSegment,
        sourceRectFor, drawFrame, drawText, drawCaption, hitTestText, cueAt,
        timecode, cueEntries, toSRT, toVTT, parseSubtitles
    };
})();
