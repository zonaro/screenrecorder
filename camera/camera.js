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
    window.addEventListener('beforeunload', () => { if (stream) stream.getTracks().forEach(t => t.stop()); });
})();