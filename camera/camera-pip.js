// camera-pip.js — runs inside the Document Picture-in-Picture window.
// Auto-starts the facecam and watches for the stop signal via storage.
(async () => {
    await I18n.init();
    const video = document.getElementById('cam');
    let stream = null;

    // --- Start camera automatically ---
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

    // --- Mirror toggle ---
    document.getElementById('mirror').addEventListener('click', () => {
        video.classList.toggle('mirrored');
    });

    // --- Close button ---
    document.getElementById('close').addEventListener('click', () => {
        if (stream) stream.getTracks().forEach(t => t.stop());
        window.close();
    });

    // --- Watch for stop signal from popup (via storage) ---
    chrome.storage.onChanged.addListener((changes) => {
        if (changes.cameraPipActive && changes.cameraPipActive.newValue === false) {
            if (stream) stream.getTracks().forEach(t => t.stop());
            window.close();
        }
    });

    // --- Cleanup when the PiP window is closed (OS close or pagehide) ---
    window.addEventListener('pagehide', () => {
        if (stream) stream.getTracks().forEach(t => t.stop());
    });
})();