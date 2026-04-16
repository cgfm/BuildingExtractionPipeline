// ==========================================================================
// SharePoint adapter — bootstraps the existing editor against SharePoint
// ==========================================================================
/**
 * Runs after app.js has defined Pipeline, EditorModule, etc.
 * Responsibilities:
 *  1. Load existing building.json + building.png from ./data/ on page open.
 *  2. Replace the "Save ▾" dropdown with a single "Auf SharePoint speichern" action.
 *  3. Detect role — viewers see a banner linking to viewer.aspx.
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
        if (!json) return false; // first-time setup — user needs to run the pipeline
        const imageBlob = await SharePointIO.loadBuildingImage();
        if (!imageBlob) {
            toast('building.json vorhanden, aber building.png fehlt — bitte Pipeline neu ausführen.', 'warn');
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

    // ---- Save to SharePoint ----

    async function saveToSharePoint(btn) {
        const buildingsData = EditorModule.getBuildingsData();
        if (!buildingsData) {
            toast('Keine Gebäudedaten vorhanden — zuerst Pipeline ausführen.', 'error');
            return;
        }
        // Need a canvas to produce the PNG. Prefer pipeline.canvas; fall back to re-rendering from dataUrl.
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
        if (!canvas) {
            toast('Kein Bild zum Speichern vorhanden — bitte Pipeline ausführen.', 'error');
            return;
        }

        const originalText = btn ? btn.textContent : '';
        if (btn) { btn.disabled = true; btn.textContent = 'Speichere…'; }
        try {
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
            toast('Gespeichert — Änderungen in SharePoint übernommen.', 'success');
        } catch (e) {
            console.error('[sp] save failed', e);
            toast('Speichern fehlgeschlagen: ' + e.message, 'error');
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = originalText; }
        }
    }

    // ---- Button wiring ----

    function wireSaveButton() {
        const saveBtn = document.getElementById('edSaveBtn');
        if (!saveBtn) return;
        // Replace the dropdown behavior: direct SharePoint save.
        const fresh = saveBtn.cloneNode(true);
        fresh.textContent = 'Auf SharePoint speichern';
        fresh.setAttribute('data-tooltip', 'Speichert building.json und building.png direkt in data/ dieser SharePoint-Seite.');
        saveBtn.parentNode.replaceChild(fresh, saveBtn);
        fresh.addEventListener('click', () => saveToSharePoint(fresh));
    }

    // ---- Startup ----

    async function startup() {
        if (typeof SharePointIO === 'undefined') {
            console.warn('[sp] SharePointIO nicht geladen — SharePoint-Modus inaktiv.');
            return;
        }

        wireSaveButton();

        const restOk = await SharePointIO.isRestAvailable();
        if (!restOk) {
            toast('SharePoint-REST nicht erreichbar — im lokalen Test-Modus.', 'warn');
            return;
        }

        const role = await SharePointIO.detectRole();
        document.body.dataset.role = role;
        if (role === 'viewer') {
            // No write access — redirect to the read-only viewer instead.
            const viewerUrl = location.pathname.replace(/editor\.aspx$/i, 'viewer.aspx');
            location.replace(viewerUrl);
            return;
        }

        // Designer: try to bootstrap with an existing map.
        try { await bootstrapFromSharePoint(); }
        catch (e) { console.warn('[sp] Bootstrap:', e.message); }
    }

    // Defer until app.js initApp() IIFE has a chance to attach its handlers.
    // The initApp IIFE is synchronous up to `await PipelineDB.open()` — so we
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
