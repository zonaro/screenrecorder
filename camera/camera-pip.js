// camera-pip.js — runs inside the Document Picture-in-Picture window.
// Handles the facecam controls so they keep working even if the host
// window is throttled while minimized.
const pipVideo = document.querySelector('#cam');
const pipMirror = document.querySelector('#pipControls #mirror');
const pipClose = document.querySelector('#pipControls #close');

pipMirror.addEventListener('click', () => pipVideo.classList.toggle('mirrored'));
pipClose.addEventListener('click', () => window.close());
window.addEventListener('pagehide', () => {
    if (typeof window.closeCamera === 'function') window.closeCamera();
});