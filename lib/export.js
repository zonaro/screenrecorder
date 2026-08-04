// lib/export.js
const EXPORT = (() => {
    function pickMime(format) {
        const list = format === 'mp4'
            ? ['video/mp4;codecs="avc1.42E01E,mp4a.40.2"', 'video/mp4']
            : ['video/webm;codecs="vp9,opus"', 'video/webm;codecs="vp8,opus"', 'video/webm'];
        for (const m of list) if (MediaRecorder.isTypeSupported(m)) return m;
        return format === 'mp4' ? 'video/mp4' : 'video/webm';
    }

    // Renders the edited video through a canvas and encodes it to MP4/WebM.
    // `regions` are the merged runs of source video that survived, in output
    // order; deleted ranges are skipped by seeking straight to the next run.
    async function render(opts) {
        const { video, canvas, regions, fps, format, vbps, abps, drawFrame, onProgress, totalDuration } = opts;
        if (!regions.length) throw new Error('Nothing to export');

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

        let idx = 0;
        video.currentTime = regions[0].srcStart;
        await video.play().catch(() => { });

        function finish() { try { recorder.stop(); } catch (e) { } }

        function tick() {
            if (idx >= regions.length) return finish();
            const cur = regions[idx];
            const t = video.currentTime;
            // Seeks are asynchronous: wait until playback actually lands inside
            // the region before drawing, otherwise a frame from the deleted
            // part leaks into the output.
            if (t < cur.srcStart - 0.05) { requestAnimationFrame(tick); return; }
            drawFrame();
            const outT = cur.outStart + Math.min(Math.max(t - cur.srcStart, 0), cur.srcEnd - cur.srcStart);
            if (onProgress) onProgress(Math.min(outT / (totalDuration || 1), 1));
            if (t >= cur.srcEnd - 0.05) {
                idx++;
                if (idx >= regions.length) return finish();
                video.currentTime = regions[idx].srcStart;
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
