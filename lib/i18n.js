// lib/i18n.js
const I18n = (() => {
    let overrides = null;
    let lang = null;

    function currentLang() {
        if (lang && lang !== 'auto') return lang;
        try { return chrome.i18n.getUILanguage() || 'en'; } catch (e) { return 'en'; }
    }

    async function init() {
        const data = await chrome.storage.local.get({ lang: 'auto' });
        lang = data.lang;
        overrides = null;
        if (lang && lang !== 'auto') {
            try {
                const res = await fetch('/_locales/' + lang + '/messages.json');
                if (res.ok) overrides = await res.json();
            } catch (e) { overrides = null; }
        }
        apply();
    }

    function t(key, subs) {
        let msg = null;
        if (overrides && overrides[key]) msg = overrides[key].message;
        else if (chrome.i18n && chrome.i18n.getMessage) msg = chrome.i18n.getMessage(key);
        if (!msg) return key;
        if (subs) msg = msg.replace(/\$(\d+)/g, (m, i) => (subs[Number(i) - 1] != null ? subs[Number(i) - 1] : m));
        return msg;
    }

    function apply(root) {
        // The service worker loads this file too (for context menu titles),
        // and it has no DOM to translate.
        if (typeof document === 'undefined' && !root) return;
        const scope = root || document;
        scope.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
        scope.querySelectorAll('[data-i18n-attr]').forEach(el => {
            const parts = el.dataset.i18nAttr.split('|');
            if (parts.length === 2) el.setAttribute(parts[0], t(parts[1]));
        });
    }

    return { init, t, apply, currentLang };
})();