(async () => {
    await I18n.init();
    const $ = (id) => document.getElementById(id);
    const t = (k) => I18n.t(k);

    const container = $('recordingsContainer');
    const emptyMsg = $('emptyMsg');

    function formatSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / 1048576).toFixed(1) + ' MB';
    }

    function formatDuration(s) {
        s = Math.max(0, s || 0);
        const m = Math.floor(s / 60);
        const sec = Math.floor(s % 60);
        return String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
    }

    function formatDate(ts) {
        const d = new Date(ts);
        const pad = n => String(n).padStart(2, '0');
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    }

    async function loadList() {
        const res = await chrome.runtime.sendMessage({ type: 'GET_ALL_RECORDINGS' });
        if (!res || !res.ok) {
            container.innerHTML = '';
            emptyMsg.hidden = false;
            return;
        }
        const recordings = res.recordings || [];
        if (recordings.length === 0) {
            container.innerHTML = '';
            emptyMsg.hidden = false;
            return;
        }
        emptyMsg.hidden = true;
        container.innerHTML = '';
        for (const rec of recordings) {
            const item = document.createElement('div');
            item.className = 'rec-item';
            item.innerHTML = `
                <span class="rec-icon">${rec.ext === 'mp4' ? '🎬' : '🎥'}</span>
                <div class="rec-info">
                    <div class="rec-name" title="${rec.name}">${rec.name}</div>
                    <div class="rec-meta">${formatDate(rec.createdAt)} &middot; ${formatDuration(rec.duration)} &middot; ${formatSize(rec.size)}</div>
                </div>
                <div class="rec-actions">
                    <button class="btn-download" data-id="${rec.id}" title="${t('btnDownload')}">&#11015;</button>
                    <button class="btn-edit" data-id="${rec.id}" title="${t('btnEdit')}">&#9998;</button>
                    <button class="btn-upload" data-id="${rec.id}" title="${t('btnUpload')}">&#10140;</button>
                    <button class="btn-delete" data-id="${rec.id}" title="${t('deleteRecording')}">&#10005;</button>
                </div>
            `;
            container.appendChild(item);
        }
    }

    // Delegate click events on the container.
    container.addEventListener('click', async (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        const id = btn.dataset.id;
        if (!id) return;

        if (btn.classList.contains('btn-download')) {
            await downloadRecording(id);
        } else if (btn.classList.contains('btn-edit')) {
            await editRecording(id);
        } else if (btn.classList.contains('btn-upload')) {
            await uploadRecording(id);
        } else if (btn.classList.contains('btn-delete')) {
            await deleteRecording(id);
        }
    });

    async function downloadRecording(id) {
        const res = await chrome.runtime.sendMessage({ type: 'GET_RECORDING', id: id });
        if (!res || !res.ok) return;
        chrome.runtime.sendMessage({ type: 'DOWNLOAD', url: res.recording.url, filename: res.recording.name });
    }

    async function editRecording(id) {
        const res = await chrome.runtime.sendMessage({ type: 'GET_RECORDING', id: id });
        if (!res || !res.ok) return;
        chrome.runtime.sendMessage({ type: 'OPEN_EDITOR', url: res.recording.url, name: res.recording.name });
    }

    async function uploadRecording(id) {
        const res = await chrome.runtime.sendMessage({ type: 'GET_RECORDING', id: id });
        if (!res || !res.ok) return;
        // Open the popup-style upload picker or prompt for service.
        const service = prompt(t('uploadPrompt') || 'Upload to (drive / onedrive / youtube):');
        if (!service) return;
        const svc = service.trim().toLowerCase();
        if (svc !== 'drive' && svc !== 'onedrive' && svc !== 'youtube') return;
        chrome.runtime.sendMessage({
            type: 'UPLOAD',
            service: svc,
            url: res.recording.url,
            name: res.recording.name,
            ext: res.recording.ext
        });
    }

    async function deleteRecording(id) {
        if (!confirm(t('deleteConfirm'))) return;
        await chrome.runtime.sendMessage({ type: 'DELETE_RECORDING', id: id });
        await loadList();
    }

    // Clear all recordings.
    $('clearAllBtn').addEventListener('click', async (e) => {
        e.preventDefault();
        if (!confirm(t('deleteAllConfirm'))) return;
        await chrome.runtime.sendMessage({ type: 'DELETE_ALL_RECORDINGS' });
        await loadList();
    });

    await loadList();
})();
