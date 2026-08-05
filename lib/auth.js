// lib/auth.js
const AUTH = (() => {
    // Set your Azure AD (Microsoft) client id here (public/native app).
    const MS_CLIENT_ID = 'YOUR_MICROSOFT_CLIENT_ID';
    const MS_SCOPES = 'offline_access files.readwrite User.Read';

    function googleToken(interactive) {
        return new Promise((resolve, reject) => {
            chrome.identity.getAuthToken({ interactive: !!interactive }, (token) => {
                if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
                resolve(token);
            });
        });
    }

    function removeGoogleToken(token) {
        return new Promise((resolve) => {
            chrome.identity.removeCachedAuthToken({ token }, () => resolve());
        });
    }

    async function googleUserInfo(token) {
        const r = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { Authorization: 'Bearer ' + token }
        });
        if (!r.ok) throw new Error('Failed to fetch Google user info');
        return r.json();
    }

    async function connectGoogle() {
        const token = await googleToken(true);
        const info = await googleUserInfo(token);
        return { token, email: info.email, name: info.name };
    }

    async function disconnectGoogle() {
        const data = await chrome.storage.local.get('google');
        if (data.google && data.google.token) {
            try { await removeGoogleToken(data.google.token); } catch (e) { }
            try { await fetch('https://accounts.google.com/o/oauth2/revoke?token=' + data.google.token); } catch (e) { }
        }
        await chrome.storage.local.remove('google');
    }

    function msRedirectUri() { return chrome.identity.getRedirectURL('onedrive'); }

    function randString(len) {
        const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
        let s = '';
        const a = new Uint8Array(len);
        crypto.getRandomValues(a);
        for (let i = 0; i < len; i++) s += c[a[i] % c.length];
        return s;
    }

    async function sha256b64(str) {
        const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
        return btoa(String.fromCharCode.apply(null, new Uint8Array(d)))
            .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    async function connectMicrosoft() {
        const verifier = randString(64);
        const challenge = await sha256b64(verifier);
        const redirectUri = msRedirectUri();
        const q = new URLSearchParams({
            client_id: MS_CLIENT_ID,
            response_type: 'code',
            redirect_uri: redirectUri,
            scope: MS_SCOPES,
            code_challenge: challenge,
            code_challenge_method: 'S256',
            prompt: 'consent'
        });
        const authUrl = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?' + q.toString();
        const resp = await chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true });
        const code = new URL(resp).searchParams.get('code');
        if (!code) throw new Error('Microsoft authentication failed');
        const body = new URLSearchParams({
            client_id: MS_CLIENT_ID, scope: MS_SCOPES, code, redirect_uri: redirectUri,
            grant_type: 'authorization_code', code_verifier: verifier
        });
        const tr = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString()
        });
        const tj = await tr.json();
        if (tj.error || !tj.access_token) throw new Error(tj.error_description || 'Microsoft authentication failed');
        const token = { access_token: tj.access_token, refresh_token: tj.refresh_token, expires_at: Date.now() + tj.expires_in * 1000 };
        await chrome.storage.local.set({ msToken: token });
        return token;
    }

    async function msAccessToken() {
        const data = await chrome.storage.local.get('msToken');
        const msToken = data.msToken;
        if (!msToken) throw new Error('OneDrive not connected');
        if (msToken.expires_at && msToken.expires_at > Date.now() + 60 * 1000) return msToken.access_token;
        const body = new URLSearchParams({
            client_id: MS_CLIENT_ID, scope: MS_SCOPES,
            refresh_token: msToken.refresh_token, grant_type: 'refresh_token'
        });
        const tr = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString()
        });
        const tj = await tr.json();
        if (tj.error || !tj.access_token) throw new Error(tj.error_description || 'Microsoft refresh failed');
        const nt = {
            access_token: tj.access_token,
            refresh_token: tj.refresh_token || msToken.refresh_token,
            expires_at: Date.now() + tj.expires_in * 1000
        };
        await chrome.storage.local.set({ msToken: nt });
        return nt.access_token;
    }

    return { googleToken, connectGoogle, disconnectGoogle, connectMicrosoft, msAccessToken };
})();