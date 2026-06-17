// ==========================================================================
// SharePoint adapter \u2014 bootstraps the existing editor against SharePoint
// ==========================================================================
/**
 * Runs after app.js has defined Pipeline, EditorModule, etc.
 * Responsibilities:
 *  1. Load existing building.json + building.png from ./data/ on page open.
 *  2. Replace the "Save \u25be" dropdown with a single "Auf SharePoint speichern" action.
 *  3. Detect role \u2014 viewers see a banner linking to viewer.aspx.
 *
 * Designed as an overlay (not a rewrite) so app.js stays in lock-step with
 * the non-SharePoint version and we only patch what SharePoint-specific logic requires.
 */
(function () {
    'use strict';

    // Mark body so CSS can hide unused UI (download/preview/projects/etc.)
    document.body.classList.add('sp-mode');

    // ---- Toast ----
    function toast(msg, kind) {
        let t = document.getElementById('spToast');
        if (!t) {
            t = document.createElement('div');
            t.id = 'spToast';
            document.body.appendChild(t);
        }
        t.textContent = msg;
        t.dataset.kind = kind || 'info';
        t.classList.add('visible');
        clearTimeout(toast._timer);
        toast._timer = setTimeout(() => t.classList.remove('visible'), 4000);
    }

    // ---- Boot: load existing map from ./data/ if present ----

    async function bootstrapFromSharePoint() {
        const json = await SharePointIO.loadBuildingJson();
        if (!json) return false; // first-time setup \u2014 user needs to run the pipeline
        const imageBlob = await SharePointIO.loadBuildingImage();
        if (!imageBlob) {
            toast('building.json vorhanden, aber building.png fehlt \u2014 bitte Pipeline neu ausf\u00fchren.', 'warn');
            return false;
        }
        // Create a canvas from the PNG so that subsequent re-renders can match metadata
        // and so that Save can produce a new PNG without re-running the pipeline.
        const imgUrl = URL.createObjectURL(imageBlob);
        const img = new Image();
        await new Promise((res, rej) => {
            img.onload = res;
            img.onerror = () => rej(new Error('PNG konnte nicht geladen werden'));
            img.src = imgUrl;
        });
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        c.getContext('2d').drawImage(img, 0, 0);

        // Hook into the pipeline: populate it with the loaded data so exports work.
        if (typeof pipeline !== 'undefined' && pipeline) {
            pipeline.canvas = c;
            pipeline.buildingJson = json;
        }

        // Make image URL available to renderers
        json.image = json.image || {};
        json.image.dataUrl = imgUrl;

        // Restore the source polygon (geojson area-of-interest) so other designers can
        // re-run the pipeline without having to re-upload the original geojson file.
        // `geojsonData` in app.js is a script-scoped `let`, shared between classic scripts
        // in the same realm -- a bare assignment here writes the same binding.
        if (json.sourcePolygon) {
            try {
                geojsonData = json.sourcePolygon;
                if (typeof saveGeojson === 'function') {
                    saveGeojson(json.sourcePolygon, 'building.json (SharePoint)');
                }
                if (typeof PipelineDB !== 'undefined') {
                    await PipelineDB.put('meta', 'geojson_source', 'upload');
                }
                if (typeof showGeojsonOnMap === 'function') {
                    showGeojsonOnMap(json.sourcePolygon);
                }
                const btnRun = document.getElementById('btnRun');
                if (btnRun) btnRun.disabled = false;
            } catch (e) { console.warn('[sp] sourcePolygon restore failed:', e.message); }
        }

        // Persist to IDB so EditorModule.initFromIDB() picks it up on next reload
        try {
            await PipelineDB.put('images', 'rendered_map', imageBlob);
            const stripped = JSON.parse(JSON.stringify(json));
            if (stripped.image) delete stripped.image.dataUrl;
            await PipelineDB.put('editor', 'buildingsData', stripped);
            await PipelineDB.put('result', 'latest', {
                buildingCount: json.buildings.length,
                imageWidth: c.width,
                imageHeight: c.height,
                avgPoints: json.buildings.length > 0
                    ? (json.buildings.reduce((s, b) => s + (b.polygons || [b.polygon]).reduce((ss, p) => ss + (p ? p.length : 0), 0), 0) / json.buildings.length).toFixed(1)
                    : '0',
                buildingJson: stripped
            });
        } catch (e) { console.warn('[sp] IDB-Sync fehlgeschlagen:', e.message); }

        // Boot editor with the loaded data
        EditorModule.init(json);

        // Switch to editor view, close pipeline
        document.getElementById('accordionPipeline').classList.add('collapsed');
        const ed = document.getElementById('accordionEditor');
        ed.classList.remove('collapsed');
        if (typeof updateUndoRedoVisibility === 'function') updateUndoRedoVisibility();

        // Update stats
        document.getElementById('statBuildings').textContent = json.buildings.length;
        document.getElementById('statResolution').textContent = c.width + 'x' + c.height;
        document.getElementById('resultCard').classList.add('visible');

        toast('Karte aus SharePoint geladen.', 'success');
        return true;
    }

    // ---- Auto-save to SharePoint ----
    // The editor calls EditorModule.onChange after every change has been persisted to
    // IndexedDB (debounced ~1.5s). We mirror that state straight to SharePoint, so there
    // is no manual "save" button. A small status pill in the sidebar header reflects the
    // current save state.

    let _saveInFlight = false;
    let _savePending = false;

    function setSaveStatus(state, detail) {
        const el = document.getElementById('spSaveStatus');
        if (!el) return;
        const labels = {
            saving: '\u2026 Speichere',
            saved: '\u2713 Gespeichert',
            error: '\u26a0 Speichern fehlgeschlagen'
        };
        el.textContent = labels[state] || '';
        el.dataset.state = state || '';
        el.title = detail || '';
        el.classList.toggle('visible', !!labels[state]);
        clearTimeout(setSaveStatus._t);
        if (state === 'saved') {
            setSaveStatus._t = setTimeout(() => el.classList.remove('visible'), 2500);
        }
    }

    function installSaveStatus() {
        if (document.getElementById('spSaveStatus')) return;
        const el = document.createElement('span');
        el.id = 'spSaveStatus';
        el.className = 'sp-save-status';
        const host = document.querySelector('.editor-sidebar-header') || document.body;
        host.appendChild(el);
    }

    async function performSharePointSave() {
        const buildingsData = EditorModule.getBuildingsData();
        if (!buildingsData) return;
        // Embed the geojson area-of-interest into building.json so other designers can
        // re-run the pipeline against the same area without re-uploading the file.
        try {
            if (typeof geojsonData !== 'undefined' && geojsonData) {
                buildingsData.sourcePolygon = geojsonData;
            } else {
                // Fallback: read from IDB if the global wasn't populated yet
                const fromIdb = await PipelineDB.get('geojson', 'input');
                if (fromIdb) buildingsData.sourcePolygon = fromIdb;
            }
        } catch (_) {}
        // Need a canvas to produce the PNG. Prefer pipeline.canvas; fall back to the dataUrl.
        let canvas = (typeof pipeline !== 'undefined' && pipeline) ? pipeline.canvas : null;
        if (!canvas && buildingsData.image && buildingsData.image.dataUrl) {
            try {
                const img = new Image();
                img.crossOrigin = 'anonymous';
                await new Promise((res, rej) => {
                    img.onload = res;
                    img.onerror = rej;
                    img.src = buildingsData.image.dataUrl;
                });
                canvas = document.createElement('canvas');
                canvas.width = img.width; canvas.height = img.height;
                canvas.getContext('2d').drawImage(img, 0, 0);
            } catch (e) { /* fall through */ }
        }
        if (!canvas) throw new Error('Kein Bild zum Speichern vorhanden');
        const pngBlob = await new Promise(res => canvas.toBlob(res, 'image/png'));
        if (!pngBlob) throw new Error('PNG-Erzeugung fehlgeschlagen');
        await SharePointIO.saveAll(buildingsData, pngBlob);
        // Sync local IDB caches so a reload shows the freshly-saved state
        try {
            await PipelineDB.put('images', 'rendered_map', pngBlob);
            const stripped = JSON.parse(JSON.stringify(buildingsData));
            if (stripped.image) delete stripped.image.dataUrl;
            await PipelineDB.put('editor', 'buildingsData', stripped);
        } catch (_) {}
    }

    async function autoSaveToSharePoint() {
        // Collapse overlapping requests: if a save is already running, queue one more.
        if (_saveInFlight) { _savePending = true; return; }
        _saveInFlight = true;
        setSaveStatus('saving');
        try {
            await performSharePointSave();
            setSaveStatus('saved');
        } catch (e) {
            console.error('[sp] auto-save failed', e);
            setSaveStatus('error', e.message);
            toast('Speichern fehlgeschlagen: ' + e.message, 'error');
        } finally {
            _saveInFlight = false;
            if (_savePending) { _savePending = false; autoSaveToSharePoint(); }
        }
    }

    // ---- Startup ----

    async function startup() {
        if (typeof SharePointIO === 'undefined') {
            console.warn('[sp] SharePointIO nicht geladen \u2014 SharePoint-Modus inaktiv.');
            return;
        }

        installSaveStatus();

        const restOk = await SharePointIO.isRestAvailable();
        if (!restOk) {
            toast('SharePoint-REST nicht erreichbar \u2014 im lokalen Test-Modus.', 'warn');
            return;
        }

        const role = await SharePointIO.detectRole();
        document.body.dataset.role = role;
        // Don't redirect: SharePoint folder permissions already control access.
        // If the user can reach editor.aspx, they should be able to use it.

        // Designer: try to bootstrap with an existing map.
        let loaded = false;
        try { loaded = await bootstrapFromSharePoint(); }
        catch (e) { console.warn('[sp] Bootstrap:', e.message); }

        // Auto-save: mirror every editor change to SharePoint (replaces the manual button).
        if (typeof EditorModule !== 'undefined' && typeof EditorModule.onChange === 'function') {
            EditorModule.onChange(() => autoSaveToSharePoint());
        }

        // First-time setup (no existing map yet): once the user runs the pipeline and the
        // editor receives data, perform one initial save so the raw result lands in SharePoint.
        if (!loaded) {
            const poll = setInterval(() => {
                const d = (typeof EditorModule !== 'undefined') ? EditorModule.getBuildingsData() : null;
                if (d && d.buildings && d.buildings.length) {
                    clearInterval(poll);
                    autoSaveToSharePoint();
                }
            }, 1500);
            setTimeout(() => clearInterval(poll), 600000);
        }
    }

    // Defer until app.js initApp() IIFE has a chance to attach its handlers.
    // The initApp IIFE is synchronous up to `await PipelineDB.open()` \u2014 so we
    // defer one frame and then poll briefly for EditorModule readiness.
    function waitForApp() {
        return new Promise(resolve => {
            const tryResolve = () => {
                if (typeof EditorModule !== 'undefined' && typeof pipeline !== 'undefined' && pipeline) {
                    resolve();
                } else {
                    setTimeout(tryResolve, 50);
                }
            };
            tryResolve();
        });
    }

    document.addEventListener('DOMContentLoaded', async () => {
        await waitForApp();
        // Give app.js's own async IDB restore a moment to settle before we override state.
        await new Promise(r => setTimeout(r, 100));
        startup();
    });
})();
