// ==========================================================================
// SharePointIO — REST helpers for loading/saving building.json + building.png
// ==========================================================================
/**
 * @namespace SharePointIO
 * Encapsulates SharePoint REST interaction:
 *  - Detect role (designer vs. viewer) via EffectiveBasePermissions
 *  - Load JSON + PNG from ./data/ folder relative to the current .aspx page
 *  - Save JSON + PNG back via Files/add (requires X-RequestDigest)
 *  - XML/JSON response auto-negotiation (falls back when OData=verbose disabled)
 *
 * Uses `credentials: 'same-origin'` so SharePoint's auth cookies are sent.
 */
const SharePointIO = (function () {

    // ---- URL helpers ----

    /** Server-relative URL of the folder that contains the current .aspx. */
    function currentFolderUrl() {
        // e.g. /sites/x/MapApps/default/editor.aspx → /sites/x/MapApps/default
        return decodeURIComponent(location.pathname).replace(/\/[^/]+\.aspx$/i, '');
    }

    /** Server-relative URL of the data subfolder. */
    function dataFolderUrl() { return currentFolderUrl() + '/data'; }

    /** Browser URL to a file in ./data/ with cache-buster. */
    function dataFileUrl(name) { return 'data/' + name + '?t=' + Date.now(); }

    // ---- Response helpers ----

    async function parseJsonOrXml(response) {
        const ct = (response.headers.get('Content-Type') || '').toLowerCase();
        const text = await response.text();
        if (ct.includes('json')) return JSON.parse(text);
        // XML fallback — rarely needed for the few fields we access, but handle gracefully
        const xml = new DOMParser().parseFromString(text, 'application/xml');
        return { __xml: xml };
    }

    function xmlText(xml, selector) {
        const el = xml.querySelector(selector);
        return el ? el.textContent : null;
    }

    // ---- Form Digest ----
    // SharePoint requires a digest token for POSTs that modify state.
    // We fetch it via /_api/contextinfo and cache until its lifetime expires.

    let _digestCache = null; // { value, expiresAt }

    async function getFormDigest() {
        if (_digestCache && Date.now() < _digestCache.expiresAt) return _digestCache.value;
        // Try JSON first
        try {
            const r = await fetch('/_api/contextinfo', {
                method: 'POST',
                headers: { Accept: 'application/json;odata=verbose' },
                credentials: 'same-origin'
            });
            if (r.ok) {
                const ct = (r.headers.get('Content-Type') || '').toLowerCase();
                if (ct.includes('json')) {
                    const j = await r.json();
                    const info = j.d.GetContextWebInformation;
                    _digestCache = {
                        value: info.FormDigestValue,
                        expiresAt: Date.now() + (info.FormDigestTimeoutSeconds * 1000) - 60_000
                    };
                    return _digestCache.value;
                }
                // XML fallback
                const xml = new DOMParser().parseFromString(await r.text(), 'application/xml');
                const value = xmlText(xml, 'FormDigestValue');
                const ttl = parseInt(xmlText(xml, 'FormDigestTimeoutSeconds') || '1800', 10);
                if (value) {
                    _digestCache = { value, expiresAt: Date.now() + (ttl * 1000) - 60_000 };
                    return value;
                }
            }
        } catch (e) { /* fall through */ }
        // Last resort: page-embedded digest (present on Classic SP pages as <input id="__REQUESTDIGEST">)
        const embed = document.getElementById('__REQUESTDIGEST');
        if (embed && embed.value) return embed.value;
        throw new Error('Kein Form-Digest verfügbar — REST-API nicht erreichbar?');
    }

    // ---- Role detection ----
    // EffectiveBasePermissions is a pair of 32-bit ints (High, Low).
    // EditListItems = 0x4 on the Low side — sufficient to determine "can write to this folder".

    async function detectRole() {
        try {
            const folder = dataFolderUrl();
            if (!folder) return 'viewer';
            const url = "/_api/web/GetFolderByServerRelativeUrl('" + encodeURIComponent(folder)
                      + "')/ListItemAllFields/EffectiveBasePermissions";
            const r = await fetch(url, {
                headers: { Accept: 'application/json;odata=verbose' },
                credentials: 'same-origin'
            });
            if (!r.ok) return 'viewer';
            const ct = (r.headers.get('Content-Type') || '').toLowerCase();
            let low;
            if (ct.includes('json')) {
                const j = await r.json();
                low = parseInt(j.d.EffectiveBasePermissions.Low, 10) || 0;
            } else {
                const xml = new DOMParser().parseFromString(await r.text(), 'application/xml');
                low = parseInt(xmlText(xml, 'Low') || '0', 10);
            }
            return (low & 0x4) ? 'designer' : 'viewer';
        } catch (e) {
            console.warn('[sp-io] Rollenerkennung fehlgeschlagen:', e.message);
            return 'viewer';
        }
    }

    // ---- Load ----

    /**
     * Load building.json from ./data/. Returns null if the file is missing
     * (first-time setup — Designer has not saved yet).
     * @returns {Promise<Object|null>}
     */
    async function loadBuildingJson() {
        try {
            const r = await fetch(dataFileUrl('building.json'), { cache: 'no-store', credentials: 'same-origin' });
            if (r.status === 404) return null;
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return await r.json();
        } catch (e) {
            console.warn('[sp-io] building.json laden fehlgeschlagen:', e.message);
            return null;
        }
    }

    /**
     * Load building.png as a Blob, ready to be turned into a canvas.
     * @returns {Promise<Blob|null>}
     */
    async function loadBuildingImage() {
        try {
            const r = await fetch(dataFileUrl('building.png'), { cache: 'no-store', credentials: 'same-origin' });
            if (r.status === 404) return null;
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return await r.blob();
        } catch (e) {
            console.warn('[sp-io] building.png laden fehlgeschlagen:', e.message);
            return null;
        }
    }

    // ---- Save ----

    async function _uploadFile(folderServerRel, filename, body) {
        const digest = await getFormDigest();
        const url = "/_api/web/GetFolderByServerRelativeUrl('" + encodeURIComponent(folderServerRel)
                  + "')/Files/add(url='" + encodeURIComponent(filename) + "',overwrite=true)";
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
                const m = t.match(/<m:message[^>]*>([^<]+)<\/m:message>/) || t.match(/"message"\s*:\s*\{[^}]*"value"\s*:\s*"([^"]+)"/);
                if (m) msg += ' — ' + m[1];
            } catch (_) {}
            throw new Error('Upload fehlgeschlagen: ' + msg);
        }
        return true;
    }

    /** Ensure ./data/ exists before first save. Safe to call repeatedly. */
    async function ensureDataFolder() {
        const digest = await getFormDigest();
        const folder = dataFolderUrl();
        // Check existence first (avoids noisy error)
        try {
            const r = await fetch("/_api/web/GetFolderByServerRelativeUrl('" + encodeURIComponent(folder) + "')",
                { headers: { Accept: 'application/json;odata=verbose' }, credentials: 'same-origin' });
            if (r.ok) return;
        } catch (_) {}
        // Create it
        const r2 = await fetch("/_api/web/Folders/add('" + encodeURIComponent(folder) + "')", {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                Accept: 'application/json;odata=verbose',
                'X-RequestDigest': digest
            }
        });
        if (!r2.ok && r2.status !== 409 /* already exists */) {
            throw new Error('Konnte data/-Ordner nicht anlegen (HTTP ' + r2.status + ')');
        }
    }

    /**
     * Save building.json and building.png to ./data/.
     * Both files are overwritten atomically in sequence.
     * @param {Object} buildingJson - The metadata payload (image.dataUrl will be stripped before write)
     * @param {Blob} pngBlob - The rendered map as PNG
     */
    async function saveAll(buildingJson, pngBlob) {
        await ensureDataFolder();
        // Strip data URL from saved JSON — the image lives as a separate file
        const clean = JSON.parse(JSON.stringify(buildingJson));
        if (clean.image) delete clean.image.dataUrl;
        const jsonBlob = new Blob([JSON.stringify(clean, null, 2)], { type: 'application/json' });
        const folder = dataFolderUrl();
        await _uploadFile(folder, 'building.json', jsonBlob);
        await _uploadFile(folder, 'building.png', pngBlob);
        return true;
    }

    // ---- Availability probe ----
    // Lets callers decide whether to show REST-backed UI or fall back to download mode.

    async function isRestAvailable() {
        try {
            const r = await fetch('/_api/web/Title', {
                headers: { Accept: 'application/json;odata=verbose' },
                credentials: 'same-origin'
            });
            return r.ok;
        } catch (_) { return false; }
    }

    return {
        currentFolderUrl,
        dataFolderUrl,
        detectRole,
        loadBuildingJson,
        loadBuildingImage,
        saveAll,
        isRestAvailable,
    };
})();
