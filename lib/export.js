// lib/export.js
const EXPORT = (() => {
    function pickMime(format) {
        const list = format === 'mp4'
            ? ['video/mp4;codecs="avc1.42E01E,mp4a.40.2"', 'video/mp4']
            : ['video/webm;codecs="vp9,opus"', 'video/webm;codecs="vp8,opus"', 'video/webm'];
        for (const m of list) if (MediaRecorder.isTypeSupported(m)) return m;
        return format === 'mp4' ? 'video/mp4' : 'video/webm';
    }

    // Renders the edited video (regions = keep segments) through a canvas and
    // encodes it to MP4/WebM with the requested bitrate.
    async function render(opts) {
        const { video, canvas, regions, fps, format, vbps, abps, drawFrame, onProgress, totalDuration } = opts;
        const recStream = new MediaStream();
        recStream.addTrack(canvas.captureStream(fps).getVideoTracks()[0]);
        const vStream = video.captureStream ? video.captureStream() : null;
        if (vStream && vStream.getAudioTracks().length) recStream.addTrack(vStream.getAudioTracks()[0]);

        const mime = pickMime(format);
        if (!MediaRecorder.isTypeSupported(mime)) throw new Error('Format not supported: ' + mime);
        const recOpts = { mimeType: mime, videoBitsPerSecond: vbps };
        if (recStream.getAudioTracks().length) recOpts.audioBitsPerSecond = abps;

        const recorder = new MediaRecorder(recStream, recOpts);
        const chunks = [];
        recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
        const done = new Promise((resolve, reject) => {
            recorder.onstop = () => resolve(new Blob(chunks, { type: mime }));
            recorder.onerror = () => reject(new Error('Recorder error'));
        });
        recorder.start(500);

        const first = regions[0];
        let completed = 0;
        video.currentTime = first ? first.start : 0;
        await video.play().catch(() => { });

        function finish() { try { recorder.stop(); } catch (e) { } }

        function tick() {
            const t = video.currentTime;
            const cur = regions.find(r => t >= r.start && t <= r.end) || null;
            if (cur) {
                drawFrame();
                const prog = completed + Math.max(0, t - cur.start);
                if (onProgress) onProgress(Math.min(prog / (totalDuration || 1), 1));
                if (t >= cur.end - 0.05) {
                    const next = regions.find(r => r.start > cur.end);
                    if (next) { completed += cur.end - cur.start; video.currentTime = next.start; requestAnimationFrame(tick); return; }
                    return finish();
                }
            } else {
                const next = regions.find(r => r.start > t);
                if (next) { video.currentTime = next.start; requestAnimationFrame(tick); return; }
                return finish();
            }
            requestAnimationFrame(tick);
        }

        await new Promise(r => setTimeout(r, 120));
        requestAnimationFrame(tick);
        const blob = await done;
        video.pause();
        return blob;
    }

    return { render, pickMime };
})();