(async () => {
    await I18n.init();
    document.title = I18n.t('cameraTitle');
    const video = document.getElementById('cam');
    let stream = null;

    try {
        stream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false
        });
        video.srcObject = stream;
        await video.play();
    } catch (e) {
        video.style.display = 'none';
    }

    document.getElementById('mirror').addEventListener('click', () => video.classList.toggle('mirrored'));
    document.getElementById('close').addEventListener('click', () => {
        if (stream) stream.getTracks().forEach(t => t.stop());
        window.close();
    });

    // --- Facecam in Picture-in-Picture mode ---
    const startPipBtn = document.getElementById('startPip');
    if ('documentPictureInPicture' in window) {
        startPipBtn.addEventListener('click', async () => {
            try {
                const pipWin = await documentPictureInPicture.requestWindow({
                    width: 320,
                    height: 180,
                    disallowReturnToOpener: true
                });
                copyStyles(pipWin);
                buildPipContent(pipWin);
                video.play().catch(() => { });
                // The PiP window never outlives its opener, so keep this host
                // window alive but minimized.
                chrome.windows.update(chrome.windows.WINDOW_ID_CURRENT, { state: 'minimized' });
            } catch (e) {
                // PiP failed — keep the regular popup window.
            }
        });
    } else {
        startPipBtn.style.display = 'none';
    }

    function copyStyles(pipWin) {
        [...document.styleSheets].forEach((styleSheet) => {
            try {
                const cssRules = [...styleSheet.cssRules].map((rule) => rule.cssText).join('');
                const style = pipWin.document.createElement('style');
                style.textContent = cssRules;
                pipWin.document.head.appendChild(style);
            } catch (e) {
                const link = pipWin.document.createElement('link');
                link.rel = 'stylesheet';
                link.type = styleSheet.type;
                link.media = styleSheet.media;
                link.href = styleSheet.href;
                pipWin.document.head.appendChild(link);
            }
        });
    }

    function buildPipContent(pipWin) {
        const wrap = pipWin.document.createElement('div');
        wrap.id = 'pipWrap';
        pipWin.document.body.append(wrap);
        wrap.append(video);
        const controls = pipWin.document.createElement('div');
        controls.id = 'pipControls';
        const mirrorBtn = pipWin.document.createElement('button');
        mirrorBtn.id = 'mirror';
        mirrorBtn.textContent = I18n.t('cameraMirror');
        const closeBtn = pipWin.document.createElement('button');
        closeBtn.id = 'close';
        closeBtn.textContent = I18n.t('cameraClose');
        controls.append(mirrorBtn, closeBtn);
        wrap.append(controls);
        // The PiP window is a freshly created document, not a real
        // navigation to an extension page, so it has no chrome.* bindings
        // of its own. Hand it a function already bound to our chrome.runtime
        // so camera-pip.js can notify the background script without needing
        // chrome.* itself.
        pipWin.closeCamera = () => chrome.runtime.sendMessage({ type: 'CLOSE_CAMERA' });
        // Run the control logic inside the PiP window itself so it keeps
        // working even if the host window is throttled while minimized.
        const script = pipWin.document.createElement('script');
        script.src = 'camera-pip.js';
        pipWin.document.head.appendChild(script);
    }

    window.addEventListener('beforeunload', () => { if (stream) stream.getTracks().forEach(t => t.stop()); });
})();