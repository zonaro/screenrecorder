(async () => {
    await I18n.init();
    const $ = (id) => document.getElementById(id);
    const t = (key) => I18n.t(key);

    const data = await chrome.storage.local.get({ lang: 'auto', driveFolder: '', odFolder: '', ytPrivacy: 'private' });
    $('lang').value = data.lang;
    $('driveFolder').value = data.driveFolder;
    $('odFolder').value = data.odFolder;
    $('ytPrivacy').value = data.ytPrivacy;

    $('lang').onchange = async () => {
        await chrome.storage.local.set({ lang: $('lang').value });
        I18n.lang = $('lang').value;
        I18n.overrides = null;
        await I18n.init();
        await refreshConnections();
    };
    ['driveFolder', 'odFolder', 'ytPrivacy'].forEach((id) => {
        $(id).onchange = () => chrome.storage.local.set({ [id]: $(id).value });
    });

    // The offscreen recorder has no UI and therefore cannot show the
    // mic/camera prompt itself - it has to be granted once from a real
    // extension page like this one.
    async function refreshMediaPerms() {
        try {
            const mic = await navigator.permissions.query({ name: 'microphone' });
            const cam = await navigator.permissions.query({ name: 'camera' });
            const ok = mic.state === 'granted' && cam.state === 'granted';
            $('permsStatus').textContent = ok ? t('permsGranted') : t('permsMissing');
            $('grantMedia').disabled = ok;
        } catch (e) {
            $('permsStatus').textContent = '';
        }
    }

    $('grantMedia').onclick = async () => {
        try {
            const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
            s.getTracks().forEach(tr => tr.stop());
        } catch (e) {
            alert(t('permsDenied'));
        }
        refreshMediaPerms();
    };

    async function refreshConnections() {
        const g = await chrome.runtime.sendMessage({ type: 'CHECK_GOOGLE' });
        const m = await chrome.runtime.sendMessage({ type: 'CHECK_MICROSOFT' });
        $('googleStatus').textContent = (g && g.connected) ? t('connectedAs') + ' ✓' : t('notConnected');
        $('msStatus').textContent = (m && m.connected) ? t('connectedAs') + ' ✓' : t('notConnected');
    }

    $('connectGoogle').onclick = async () => {
        const r = await chrome.runtime.sendMessage({ type: 'CONNECT_GOOGLE' });
        if (!r || !r.ok) alert(r && r.error ? r.error : 'Error');
        refreshConnections();
    };
    $('disconnectGoogle').onclick = async () => { await chrome.runtime.sendMessage({ type: 'DISCONNECT_GOOGLE' }); refreshConnections(); };
    $('connectMs').onclick = async () => {
        const r = await chrome.runtime.sendMessage({ type: 'CONNECT_MICROSOFT' });
        if (!r || !r.ok) alert(r && r.error ? r.error : 'Error');
        refreshConnections();
    };
    $('disconnectMs').onclick = async () => { await chrome.runtime.sendMessage({ type: 'DISCONNECT_MICROSOFT' }); refreshConnections(); };

    await refreshMediaPerms();
    await refreshConnections();
})();