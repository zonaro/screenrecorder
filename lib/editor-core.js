// lib/editor-core.js
const EditorCore = (() => {
    function segAtTime(segments, t) {
        for (const s of segments) if (t >= s.start && t <= s.end) return s;
        return null;
    }

    function normToPx(n, vw, vh) {
        return { x: n.x * vw, y: n.y * vh, w: n.w * vw, h: n.h * vh };
    }

    // Computes the source rectangle of the video for a segment at time t,
    // applying crop + pan/zoom interpolation.
    function sourceRectFor(seg, t, vw, vh) {
        let base = { x: 0, y: 0, w: vw, h: vh };
        if (seg.crop) base = normToPx(seg.crop, vw, vh);
        if (seg.panZoom) {
            const p = seg.end > seg.start ? Math.min(Math.max((t - seg.start) / (seg.end - seg.start), 0), 1) : 0;
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
        ctx.strokeStyle = stroke.color || '#ff0000';
        ctx.lineWidth = (stroke.width || 4) * (canvas.width / 1920);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        for (let i = 0; i < points.length; i++) {
            const p = points[i];
            const x = p.x * canvas.width, y = p.y * canvas.height;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
    }

    function drawText(ctx, canvas, o) {
        const size = o.size * canvas.height;
        ctx.font = (o.bold ? 'bold ' : '') + size + 'px ' + (o.font || 'sans-serif');
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = Math.max(2, size * 0.08);
        ctx.strokeStyle = 'rgba(0,0,0,0.85)';
        ctx.strokeText(o.text, o.x * canvas.width, o.y * canvas.height);
        ctx.fillStyle = o.color || '#ffffff';
        ctx.fillText(o.text, o.x * canvas.width, o.y * canvas.height);
    }

    function drawFrame(ctx, canvas, video, segments, overlays, t, liveStroke) {
        const vw = video.videoWidth, vh = video.videoHeight;
        if (!vw || !vh) return;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        const seg = segAtTime(segments, t);
        if (seg) {
            const src = sourceRectFor(seg, t, vw, vh);
            ctx.drawImage(video, src.x, src.y, src.w, src.h, 0, 0, canvas.width, canvas.height);
        }
        for (const o of overlays) {
            if (t < o.start || t > o.end) continue;
            if (o.type === 'text') drawText(ctx, canvas, o);
            else if (o.type === 'doodle') drawStroke(ctx, canvas, o, o.points.filter(p => p.t <= t));
        }
        if (liveStroke && liveStroke.points.length) drawStroke(ctx, canvas, liveStroke, liveStroke.points);
    }

    function computeRegions(segments) {
        return segments.slice().sort((a, b) => a.start - b.start).map(s => ({ start: s.start, end: s.end }));
    }

    return { segAtTime, sourceRectFor, drawFrame, computeRegions };
})();