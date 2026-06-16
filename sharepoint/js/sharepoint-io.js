// ==========================================================================
// SharePointIO -- REST helpers for loading/saving building.json + building.png
// ==========================================================================
const SharePointIO = (function () {

    // ---- API base URL ----
    // SharePoint portals live at /sites/<name>/ or /teams/<name>/, never at /.
    // All REST calls must be relative to the site web, not the domain root.
    // SharePoint injects _spPageContextInfo on every page it serves -- use it.

    function getWebUrl() {
        // Primary: SharePoint's own page context (always correct, set by SP itself)
        if (window._spPageContextInfo && window._spPageContextInfo.webServerRelativeUrl) {
            return window._spPageContextInfo.webServerRelativeUrl.replace(/\/$/, '');
        }
        // Fallback: SharePoint sites always live exactly 2 path segments deep,
        // e.g. /sites/<name>, /teams/<name>, /portale/<name> (German on-prem),
        // /portals/<name>, /personal/<email>, or any custom managed path.
        // Take the first two segments regardless of their literal names.
        const m = location.pathname.match(/^(\/[^/]+\/[^/]+)/);
        if (m) return m[1];
        // Root site collection (rare)
        return '';
    }

    function apiBase() { return getWebUrl() + '/_api'; }

    // Diagnostic: dump everything we use to determine the API base.
    // Call window.SharePointIO.debug() from the browser console.
    function debug() {
        const ctx = window._spPageContextInfo || null;
        const info = {
            href: location.href,
            pathname: location.pathname,
            spPageContext: ctx ? {
                webServerRelativeUrl: ctx.webServerRelativeUrl,
                siteServerRelativeUrl: ctx.siteServerRelativeUrl,
                webAbsoluteUrl: ctx.webAbsoluteUrl,
            } : '(_spPageContextInfo NOT available)',
            getWebUrl: getWebUrl(),
            apiBase: apiBase(),
            currentFolderUrl: currentFolderUrl(),
            dataFolderUrl: dataFolderUrl(),
            requestDigestEmbed: !!document.getElementById('__REQUESTDIGEST'),
        };
        console.table(info);
        return info;
    }

    // Log once at script load so we can see config without manual call
    try {
        console.log('[sp-io] init',
            'webUrl=' + (getWebUrl() || '(root)'),
            'apiBase=' + apiBase(),
            'spCtx=' + (window._spPageContextInfo ? 'yes' : 'no'));
    } catch (_) {}

    // ---- URL helpers ----

    /** Server-relative path of the folder containing the current .aspx page. */
    function currentFolderUrl() {
        return decodeURIComponent(location.pathname).replace(/\/[^/]+\.aspx$/i, '');
    }

    /** Server-relative path of the ./data/ subfolder. */
    function dataFolderUrl() { return currentFolderUrl() + '/data'; }

    /** Relative browser URL to a file in ./data/ with cache-buster. */
    function dataFileUrl(name) { return 'data/' + name + '?t=' + Date.now(); }

    /** SharePoint REST URL that streams a file's bytes regardless of MIME map / routing. */
    function restFileUrl(name) {
        return apiBase() + "/web/GetFileByServerRelativeUrl('"
             + spStr(dataFolderUrl() + '/' + name) + "')/$value?t=" + Date.now();
    }

    // ---- OData string escaping ----
    // Pass server-relative paths unencoded inside OData string literals.
    // Only escape single quotes by doubling them.
    function spStr(s) { return s.replace(/'/g, "''"); }

    // ---- XML helper ----
    function xmlText(xml, selector) {
        const el = xml.querySelector(selector);
        return el ? el.textContent : null;
    }

    // ---- Form Digest ----
    let _digestCache = null;

    async function getFormDigest() {
        if (_digestCache && Date.now() < _digestCache.expiresAt) return _digestCache.value;

        // Page-embedded digest (Classic SharePoint pages have this)
        const embed = document.getElementById('__REQUESTDIGEST');
        if (embed && embed.value) return embed.value;

        // Fetch fresh digest from contextinfo
        try {
            const r = await fetch(apiBase() + '/contextinfo', {
                method: 'POST',
                headers: { Accept: 'application/json;odata=verbose' },
                credentials: 'same-origin'
            });
            if (r.ok) {
                const ct = (r.headers.get('Content-Type') || '').toLowerCase();
                let value, ttl;
                if (ct.includes('json')) {
                    const j = await r.json();
                    const info = j.d.GetContextWebInformation;
                    value = info.FormDigestValue;
                    ttl   = info.FormDigestTimeoutSeconds;
                } else {
                    const xml = new DOMParser().parseFromString(await r.text(), 'application/xml');
                    value = xmlText(xml, 'FormDigestValue');
                    ttl   = parseInt(xmlText(xml, 'FormDigestTimeoutSeconds') || '1800', 10);
                }
                if (value) {
                    _digestCache = { value, expiresAt: Date.now() + (ttl * 1000) - 60000 };
                    return value;
                }
            }
        } catch (e) { console.warn('[sp-io] Form-Digest:', e.message); }

        throw new Error('Kein Form-Digest verf\u00fcgbar. API-Basis: ' + apiBase());
    }

    // ---- Role detection ----
    // Uses effectivebasepermissions on the current web.
    // EditListItems = bit 0x4 on the Low integer.

    async function detectRole() {
        try {
            const url = apiBase() + '/web/effectivebasepermissions';
            console.log('[sp-io] detectRole ->', url);
            const r = await fetch(url, {
                headers: { Accept: 'application/json;odata=verbose' },
                credentials: 'same-origin'
            });
            console.log('[sp-io] detectRole status', r.status, r.headers.get('Content-Type'));
            if (!r.ok) return 'viewer';

            const ct = (r.headers.get('Content-Type') || '').toLowerCase();
            let low;
            if (ct.includes('json')) {
                const j = await r.json();
                // { d: { EffectiveBasePermissions: { High: "...", Low: "..." } } }
                const perms = j.d && j.d.EffectiveBasePermissions;
                low = parseInt((perms && perms.Low) || '0', 10);
                console.log('[sp-io] permissions Low =', low, 'raw =', perms);
            } else {
                const text = await r.text();
                console.log('[sp-io] XML response (first 300):', text.slice(0, 300));
                const xml = new DOMParser().parseFromString(text, 'application/xml');
                low = parseInt(xmlText(xml, 'Low') || '0', 10);
            }
            const role = (low & 0x4) ? 'designer' : 'viewer';
            console.log('[sp-io] role =', role);
            return role;
        } catch (e) {
            console.warn('[sp-io] detectRole fehlgeschlagen:', e.message);
            return 'viewer';
        }
    }

    // ---- Load ----
    // On portals with a custom-managed path (e.g. /daten/<n>/ instead of /sites/<n>/),
    // or when the .aspx lives in a Site Pages library, the relative `data/...` fetch can
    // be misrouted to SharePoint's 200+HTML "friendly 404" page. We therefore try the
    // relative URL first, detect HTML-shaped responses, and fall back to the REST API
    // (GetFileByServerRelativeUrl/$value), which always streams the real file bytes.

    function _looksLikeHtml(text) {
        return text.length > 0 && text.trimStart().slice(0, 1) === '<';
    }

    /** Returns the raw response text of a data file, or null if unreachable. */
    async function _fetchDataText(name) {
        // 1) Direct relative fetch
        try {
            const r = await fetch(dataFileUrl(name), { cache: 'no-store', credentials: 'same-origin' });
            console.log('[sp-io]', name, 'direct ->', r.status, r.headers.get('Content-Type'));
            if (r.ok) {
                const text = await r.text();
                if (!_looksLikeHtml(text)) return text;
                console.warn('[sp-io]', name, 'direct returned HTML (SharePoint 404/login?) -- trying REST');
            }
        } catch (e) { console.warn('[sp-io]', name, 'direct failed:', e.message); }
        // 2) REST fallback
        try {
            const url = restFileUrl(name);
            const r = await fetch(url, { cache: 'no-store', credentials: 'same-origin' });
            console.log('[sp-io]', name, 'REST ->', r.status, r.headers.get('Content-Type'));
            if (r.ok) {
                const text = await r.text();
                if (!_looksLikeHtml(text)) return text;
                console.warn('[sp-io]', name, 'REST returned HTML. First 200:', text.slice(0, 200));
            }
        } catch (e) { console.warn('[sp-io]', name, 'REST failed:', e.message); }
        return null;
    }

    async function loadBuildingJson() {
        const text = await _fetchDataText('building.json');
        if (text === null) return null;
        try { return JSON.parse(text); }
        catch (e) {
            console.warn('[sp-io] building.json ist kein g\u00fcltiges JSON:', e.message);
            return null;
        }
    }

    async function loadBuildingImage() {
        // 1) Direct relative fetch (skip if it returns HTML)
        try {
            const r = await fetch(dataFileUrl('building.png'), { cache: 'no-store', credentials: 'same-origin' });
            console.log('[sp-io] building.png direct ->', r.status, r.headers.get('Content-Type'));
            if (r.ok) {
                const ct = (r.headers.get('Content-Type') || '').toLowerCase();
                if (!ct.includes('html')) return await r.blob();
                console.warn('[sp-io] building.png direct returned HTML -- trying REST');
            }
        } catch (e) { console.warn('[sp-io] building.png direct failed:', e.message); }
        // 2) REST fallback
        try {
            const url = restFileUrl('building.png');
            const r = await fetch(url, { cache: 'no-store', credentials: 'same-origin' });
            console.log('[sp-io] building.png REST ->', r.status, r.headers.get('Content-Type'));
            if (r.ok) return await r.blob();
        } catch (e) { console.warn('[sp-io] building.png REST failed:', e.message); }
        return null;
    }

    // ---- Save ----

    async function _uploadFile(folderServerRel, filename, body) {
        const digest = await getFormDigest();
        const url = apiBase() + "/web/GetFolderByServerRelativeUrl('" + spStr(folderServerRel)
                  + "')/Files/add(url='" + spStr(filename) + "',overwrite=true)";
        console.log('[sp-io] upload ->', url);
        const r = await fetch(url, {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                Accept: 'application/json;odata=verbose',
                'X-RequestDigest': digest,
                'Content-Type': 'application/octet-stream'
            },
            body: body
        });
        if (!r.ok) {
            let msg = 'HTTP ' + r.status;
            try {
                const t = await r.text();
                const m = t.match(/<m:message[^>]*>([^<]+)<\/m:message>/)
                       || t.match(/"message"\s*:\s*\{[^}]*"value"\s*:\s*"([^"]+)"/);
                if (m) msg += ' -- ' + m[1];
            } catch (_) {}
            throw new Error('Upload fehlgeschlagen: ' + msg);
        }
        return true;
    }

    async function ensureDataFolder() {
        const folder = dataFolderUrl();
        try {
            const r = await fetch(apiBase() + "/web/GetFolderByServerRelativeUrl('" + spStr(folder) + "')",
                { headers: { Accept: 'application/json;odata=verbose' }, credentials: 'same-origin' });
            if (r.ok) return; // already exists
        } catch (_) {}
        // Create
        const digest = await getFormDigest();
        const r2 = await fetch(apiBase() + "/web/Folders/add('" + spStr(folder) + "')", {
            method: 'POST',
            credentials: 'same-origin',
            headers: { Accept: 'application/json;odata=verbose', 'X-RequestDigest': digest }
        });
        if (!r2.ok && r2.status !== 409) {
            throw new Error('Konnte data/-Ordner nicht anlegen (HTTP ' + r2.status + ')');
        }
    }

    async function saveAll(buildingJson, pngBlob) {
        await ensureDataFolder();
        const clean = JSON.parse(JSON.stringify(buildingJson));
        // Normalize image metadata: file is always saved as building.png in this folder.
        // The pipeline default 'rendered.png' is misleading once we land in SharePoint.
        clean.image = clean.image || {};
        clean.image.filename = 'building.png';
        delete clean.image.dataUrl;
        const jsonBlob = new Blob([JSON.stringify(clean, null, 2)], { type: 'application/json' });
        const folder = dataFolderUrl();
        await _uploadFile(folder, 'building.json', jsonBlob);
        await _uploadFile(folder, 'building.png', pngBlob);
        return true;
    }

    // ---- Availability probe ----

    async function isRestAvailable() {
        const url = apiBase() + '/web/Title';
        try {
            const r = await fetch(url, {
                headers: { Accept: 'application/json;odata=verbose' },
                credentials: 'same-origin'
            });
            console.log('[sp-io] isRestAvailable', url, '->', r.status, r.headers.get('Content-Type'));
            return r.ok;
        } catch (e) {
            console.warn('[sp-io] isRestAvailable failed', url, e.message);
            return false;
        }
    }

    return {
        getWebUrl,
        apiBase,
        currentFolderUrl,
        dataFolderUrl,
        detectRole,
        loadBuildingJson,
        loadBuildingImage,
        saveAll,
        isRestAvailable,
        debug,
    };
})();
