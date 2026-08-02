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

    await refreshConnections();
})();