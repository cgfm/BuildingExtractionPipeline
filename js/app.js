// ==========================================================================
// PipelineDB — IndexedDB wrapper (async key-value store)
// ==========================================================================
/**
 * @namespace PipelineDB
 * @description Async key-value store wrapping IndexedDB. Stores: meta, geojson, buildings_cache, result, images, editor, projects.
 */
const PipelineDB = (() => {
    const DB_NAME = 'BuildingPipelineDB';
    const DB_VERSION = 2;
    const STORES = ['meta', 'geojson', 'buildings_cache', 'result', 'images', 'editor', 'projects'];
    let _db = null;

    /** @returns {Promise<IDBDatabase>} */
    function open() {
        if (_db) return Promise.resolve(_db);
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                STORES.forEach(name => { if (!db.objectStoreNames.contains(name)) db.createObjectStore(name); });
            };
            req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
            req.onerror = (e) => reject(e.target.error);
        });
    }

    function _tx(store, mode) { return _db.transaction(store, mode).objectStore(store); }

    /**
     * @param {string} store - Store name
     * @param {string} key - Record key
     * @returns {Promise<*>} Stored value or undefined
     */
    function get(store, key) {
        return new Promise((resolve, reject) => {
            const req = _tx(store, 'readonly').get(key);
            req.onsuccess = () => resolve(req.result);
            req.onerror = (e) => reject(e.target.error);
        });
    }

    /**
     * @param {string} store - Store name
     * @param {string} key - Record key
     * @param {*} value - Value to store
     * @returns {Promise<void>}
     */
    function put(store, key, value) {
        return new Promise((resolve, reject) => {
            const req = _tx(store, 'readwrite').put(value, key);
            req.onsuccess = () => resolve();
            req.onerror = (e) => reject(e.target.error);
        });
    }

    /**
     * @param {string} store - Store name
     * @param {string} key - Record key to delete
     * @returns {Promise<void>}
     */
    function remove(store, key) {
        return new Promise((resolve, reject) => {
            const req = _tx(store, 'readwrite').delete(key);
            req.onsuccess = () => resolve();
            req.onerror = (e) => reject(e.target.error);
        });
    }

    /** Clear all stores except 'projects'. @returns {Promise<void>} */
    function clearAll() {
        return new Promise((resolve, reject) => {
            const clearStores = STORES.filter(s => s !== 'projects');
            const tx = _db.transaction(clearStores, 'readwrite');
            clearStores.forEach(name => tx.objectStore(name).clear());
            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e.target.error);
        });
    }

    /**
     * @param {string} store - Store name
     * @returns {Promise<Array>} All values in the store
     */
    function getAll(store) {
        return new Promise((resolve, reject) => {
            const req = _tx(store, 'readonly').getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = (e) => reject(e.target.error);
        });
    }

    /**
     * Write multiple entries across stores in a single IDB transaction.
     * @param {Array<{store: string, key: string, value: *}>} ops - Operations to execute
     * @returns {Promise<void>}
     */
    function batch(ops) {
        const stores = [...new Set(ops.map(o => o.store))];
        const tx = _db.transaction(stores, 'readwrite');
        ops.forEach(o => tx.objectStore(o.store).put(o.value, o.key));
        return new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = (e) => reject(e.target.error); });
    }

    return { open, get, put, remove, clearAll, getAll, batch };
})();

/**
 * Escape HTML special characters to prevent XSS.
 * @param {string} s - Raw string
 * @returns {string} Escaped string safe for innerHTML
 */
function escapeHtml(s) {
    if (typeof s !== 'string') return '';
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

/**
 * Convert a Base64 data URL to a Blob.
 * @param {string} dataUrl - Data URL (e.g. "data:image/png;base64,...")
 * @returns {Blob}
 */
function dataUrlToBlob(dataUrl) {
    if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.includes(',')) throw new Error('Invalid data URL');
    const [header, b64] = dataUrl.split(',');
    const mimeMatch = header.match(/:(.*?);/);
    if (!mimeMatch) throw new Error('Invalid data URL: missing MIME type');
    const mime = mimeMatch[1];
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
}

/**
 * Convert a Blob to a Base64 data URL. Only used for standalone HTML export.
 * @param {Blob} blob
 * @returns {Promise<string>} Data URL string
 */
function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

/**
 * Convert an HTMLCanvasElement to a PNG Blob.
 * @param {HTMLCanvasElement} canvas
 * @returns {Promise<Blob>}
 */
function canvasToBlob(canvas) {
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

/**
 * Parse a hex color string to RGB components.
 * @param {string} hex - Hex color (e.g. "#FF6B6B")
 * @returns {{r: number, g: number, b: number}} RGB values (0-255), defaults to amber on parse failure
 */
function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) } : { r: 255, g: 193, b: 7 };
}

/**
 * Validate and sanitize a hex color string. Returns default amber if invalid.
 * @param {string} c - Color string to validate
 * @returns {string} Valid hex color
 */
function sanitizeColor(c) {
    return (typeof c === 'string' && /^#[0-9a-fA-F]{3,6}$/.test(c)) ? c : '#FFC107';
}

/**
 * Truncate a string to a maximum length. Returns empty string for non-strings.
 * @param {string} s - Input string
 * @param {number} maxLen - Maximum allowed length
 * @returns {string}
 */
function sanitizeString(s, maxLen) {
    if (typeof s !== 'string') return '';
    return s.slice(0, maxLen);
}

/** Migrate legacy localStorage data to IndexedDB. Runs once, sets _migrated flag. */
async function migrateFromLocalStorage() {
    try {
        const migrated = await PipelineDB.get('meta', '_migrated');
        if (migrated) return;

        const params = localStorage.getItem('pipeline_params');
        if (params) await PipelineDB.put('meta', 'params', JSON.parse(params));

        const geojsonName = localStorage.getItem('pipeline_geojson_name');
        if (geojsonName) await PipelineDB.put('meta', 'geojson_name', geojsonName);

        const geojsonSource = localStorage.getItem('pipeline_geojson_source');
        if (geojsonSource) await PipelineDB.put('meta', 'geojson_source', geojsonSource);

        const geojson = localStorage.getItem('pipeline_geojson');
        if (geojson) await PipelineDB.put('geojson', 'input', JSON.parse(geojson));

        const buildingsCache = localStorage.getItem('pipeline_buildings_cache');
        if (buildingsCache) await PipelineDB.put('buildings_cache', 'osm', JSON.parse(buildingsCache));

        const resultRaw = localStorage.getItem('pipeline_result_cache');
        if (resultRaw) {
            const cached = JSON.parse(resultRaw);
            let imageBlob = null;
            if (cached.buildingJson && cached.buildingJson.image && cached.buildingJson.image.dataUrl) {
                imageBlob = dataUrlToBlob(cached.buildingJson.image.dataUrl);
                delete cached.buildingJson.image.dataUrl;
            }
            await PipelineDB.put('result', 'latest', cached);
            if (imageBlob) await PipelineDB.put('images', 'rendered_map', imageBlob);
        }

        const editorRaw = localStorage.getItem('editor_buildingsData');
        if (editorRaw) {
            const editorData = JSON.parse(editorRaw);
            if (editorData.image && editorData.image.dataUrl) {
                delete editorData.image.dataUrl;
            }
            await PipelineDB.put('editor', 'buildingsData', editorData);
        }

        await PipelineDB.put('meta', '_migrated', true);

        // Remove old localStorage keys
        ['pipeline_params', 'pipeline_geojson', 'pipeline_geojson_name',
         'pipeline_geojson_source', 'pipeline_buildings_cache',
         'pipeline_result_cache', 'editor_buildingsData'].forEach(k => {
            try { localStorage.removeItem(k); } catch(e) {}
        });
    } catch(e) { console.warn('[migration] Fehler bei localStorage-Migration:', e); }
}

// ==========================================================================
// All modules inlined — no ES module imports, works from file:// protocol
// ==========================================================================

// --------------------------------------------------------------------------
// overpass.js
// --------------------------------------------------------------------------
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const RETRY_DELAYS = [5000, 10000, 20000];
const BBOX_AREA_WARN_KM2 = 5;

/**
 * Extract the outer ring coordinates from a GeoJSON polygon (FeatureCollection, Feature, Polygon, or MultiPolygon).
 * @param {Object} geojson - GeoJSON object
 * @returns {Array<[number, number]>} Array of [lng, lat] coordinate pairs
 * @throws {Error} If GeoJSON is invalid or unsupported
 */
function extractPolygonCoords(geojson) {
    let geometry = null;
    if (!geojson || typeof geojson !== 'object') throw new Error('Invalid GeoJSON: input is not an object');
    if (geojson.type === 'FeatureCollection') {
        if (!geojson.features || geojson.features.length === 0) throw new Error('FeatureCollection contains no features');
        geometry = geojson.features[0].geometry;
    } else if (geojson.type === 'Feature') {
        geometry = geojson.geometry;
    } else if (geojson.type === 'Polygon') {
        geometry = geojson;
    } else if (geojson.type === 'MultiPolygon') {
        geometry = { type: 'Polygon', coordinates: geojson.coordinates[0] };
    } else {
        throw new Error('Unsupported GeoJSON type: ' + geojson.type);
    }
    if (!geometry || geometry.type !== 'Polygon') throw new Error('Expected Polygon geometry, got: ' + (geometry ? geometry.type : 'null'));
    if (!geometry.coordinates || geometry.coordinates.length === 0) throw new Error('Polygon has no coordinate rings');
    return geometry.coordinates[0];
}

/**
 * Estimate bounding box area in km² using latitude-corrected approximation.
 * Uses 111.32 km per degree of latitude, with longitude corrected by cos(lat).
 * @param {Array<[number, number]>} coords - Array of [lng, lat] pairs
 * @returns {number} Estimated area in km²
 */
function estimateBboxAreaKm2(coords) {
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    for (const [lng, lat] of coords) { if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat; if (lng < minLng) minLng = lng; if (lng > maxLng) maxLng = lng; }
    const latMid = (minLat + maxLat) / 2;
    return (maxLat - minLat) * 111.32 * (maxLng - minLng) * 111.32 * Math.cos(latMid * Math.PI / 180);
}

/**
 * Build an Overpass QL query to fetch buildings within a polygon.
 * @param {Array<[number, number]>} coords - Polygon coordinates [lng, lat]
 * @returns {string} Overpass QL query string
 */
function buildOverpassQuery(coords) {
    const polyString = coords.map(([lng, lat]) => lat + ' ' + lng).join(' ');
    return '[out:json][timeout:60];\n(\n  way["building"](poly:"' + polyString + '");\n  relation["building"](poly:"' + polyString + '");\n);\nout geom;';
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

/**
 * Download OSM buildings within a GeoJSON polygon via Overpass API.
 * Validates area limits, checks antimeridian, retries on 429/503/504.
 * @param {Object} geojsonPolygon - GeoJSON polygon defining the area
 * @returns {Promise<Object>} GeoJSON FeatureCollection of buildings
 * @throws {Error} On area too large, antimeridian crossing, or API failure
 */
async function downloadBuildings(geojsonPolygon) {
    const coords = extractPolygonCoords(geojsonPolygon);
    // Check for antimeridian crossing
    const lngs = coords.map(c => c[0]);
    if (Math.max(...lngs) - Math.min(...lngs) > 180) {
        throw new Error('Polygon kreuzt den Antimeridian (180°). Dies wird nicht unterstützt.');
    }
    const area = estimateBboxAreaKm2(coords);
    if (area > 50) throw new Error('Gebiet zu groß (' + area.toFixed(1) + ' km²). Maximum: 50 km².');
    if (area > BBOX_AREA_WARN_KM2) {
        if (!confirm('Das Gebiet ist ' + area.toFixed(1) + ' km² groß. Große Gebiete können zu langen Ladezeiten führen. Fortfahren?')) {
            throw new Error('Abgebrochen: Gebiet zu groß');
        }
    }
    const query = buildOverpassQuery(coords);
    let lastError = null;
    for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
        try {
            const response = await fetch(OVERPASS_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(query) });
            if (response.status === 429 || response.status === 503 || response.status === 504) {
                if (attempt < RETRY_DELAYS.length) { await sleep(RETRY_DELAYS[attempt]); continue; }
                throw new Error('Overpass API nicht erreichbar nach ' + (RETRY_DELAYS.length + 1) + ' Versuchen (HTTP ' + response.status + ')');
            }
            if (!response.ok) throw new Error('Overpass API error: HTTP ' + response.status);
            const data = await response.json();
            if (!data.elements) throw new Error('Overpass response missing "elements" array');
            return osmToGeojson(data);
        } catch (err) { lastError = err; if (err.message.includes('429') || err.message.includes('503') || err.message.includes('504')) continue; throw err; }
    }
    throw lastError || new Error('Overpass API request failed');
}

function closeRing(ring) {
    if (ring.length < 2) return ring;
    const f = ring[0], l = ring[ring.length - 1];
    if (f[0] !== l[0] || f[1] !== l[1]) return [...ring, [f[0], f[1]]];
    return ring;
}

function wayGeometryToCoords(geometry) { return closeRing(geometry.map(pt => [pt.lon, pt.lat])); }

/**
 * Convert Overpass API response to GeoJSON FeatureCollection.
 * Handles way and relation elements. Filters __proto__/constructor from tags (prototype pollution defense).
 * Relations with multiple outer rings produce MultiPolygon geometries with inner rings included.
 * @param {Object} data - Overpass API JSON response
 * @returns {{type: string, features: Array}} GeoJSON FeatureCollection
 */
function osmToGeojson(data) {
    const features = [];
    for (const el of data.elements) {
        if (el.type === 'way') {
            if (!el.geometry || el.geometry.length === 0) continue;
            const safeTags = Object.fromEntries(Object.entries(el.tags || {}).filter(([k]) => k !== '__proto__' && k !== 'constructor'));
            features.push({ type: 'Feature', properties: { ...safeTags, osm_id: el.id, osm_type: 'way' }, geometry: { type: 'Polygon', coordinates: [wayGeometryToCoords(el.geometry)] } });
        } else if (el.type === 'relation') {
            if (!el.members) continue;
            const outerRings = [];
            const innerRings = [];
            for (const m of el.members) {
                if (m.role === 'outer' && m.geometry && m.geometry.length > 0) outerRings.push(wayGeometryToCoords(m.geometry));
                if (m.role === 'inner' && m.geometry && m.geometry.length > 0) innerRings.push(wayGeometryToCoords(m.geometry));
            }
            if (outerRings.length === 0) continue;
            let geometry;
            if (outerRings.length === 1) {
                geometry = { type: 'Polygon', coordinates: [outerRings[0], ...innerRings] };
            } else {
                geometry = { type: 'MultiPolygon', coordinates: outerRings.map(r => [r, ...innerRings]) };
            }
            const safeTags = Object.fromEntries(Object.entries(el.tags || {}).filter(([k]) => k !== '__proto__' && k !== 'constructor'));
            features.push({ type: 'Feature', properties: { ...safeTags, osm_id: el.id, osm_type: 'relation' }, geometry });
        }
    }
    return { type: 'FeatureCollection', features };
}

// --------------------------------------------------------------------------
// renderer.js
// --------------------------------------------------------------------------
// Mean Earth radius in meters (used for Mercator projection and Haversine distance)
const EARTH_RADIUS = 6371000;

/**
 * 2.5D isometric building renderer with OSM tile background.
 * Renders buildings with extruded walls and roofs onto a canvas, composited over map tiles.
 * @class
 */
class Building25DRenderer {
  /**
   * @param {Object} buildingsGeojson - GeoJSON FeatureCollection of buildings
   * @param {Array<[number, number]>|null} boundingPolygon - Optional bounding polygon [lng, lat] pairs
   * @param {Object} [params] - Rendering parameters
   * @param {number} [params.tilt=45] - View tilt angle in degrees
   * @param {number} [params.rotation=0] - View rotation angle in degrees
   * @param {number} [params.extrude=4] - Default building extrusion height
   * @param {number} [params.width=2000] - Canvas width in pixels
   * @param {number} [params.height=1150] - Canvas height in pixels
   * @param {string} [params.roofColor='#cccccc'] - Roof fill color (hex)
   * @param {string} [params.outlineColor='#333333'] - Outline stroke color (hex)
   * @param {boolean} [params.simplify=true] - Use convex hull simplification for click polygons
   * @param {number} [params.minArea=25] - Minimum building footprint area in m²
   * @param {boolean} [params.uniformHeight=false] - Ignore OSM height tags, use extrude for all
   */
  constructor(buildingsGeojson, boundingPolygon, params = {}) {
    this.buildingsGeojson = buildingsGeojson;
    this.boundingPolygon = boundingPolygon;
    const d = { tilt:45, rotation:0, extrude:4, width:2000, height:1150, roofColor:'#cccccc', outlineColor:'#333333', simplify:true, minArea:25, uniformHeight:false };
    const m = { ...d, ...params };
    this.tilt=m.tilt; this.rotation=m.rotation; this.extrude=m.extrude; this.width=m.width; this.height=m.height;
    this.roofColor=m.roofColor; this.outlineColor=m.outlineColor; this.simplify=m.simplify; this.minArea=m.minArea; this.uniformHeight=m.uniformHeight;
    this.buildingPolygons = [];
    this.minLon=0; this.maxLon=0; this.minLat=0; this.maxLat=0; this.refLon=0; this.refLat=0;
  }

  /** Render all buildings onto a new canvas. @returns {Promise<HTMLCanvasElement>} */
  async render() {
    this.buildingPolygons = [];
    this.calculateBounds();
    const canvas = document.createElement('canvas');
    canvas.width = this.width; canvas.height = this.height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#f0f0f0';
    ctx.fillRect(0, 0, this.width, this.height);
    try { await this._drawMapBackground(ctx); } catch (e) { console.warn('[renderer] Map tiles failed:', e.message); }
    const rotRad = (this.rotation * Math.PI) / 180;
    const tiltRad = (this.tilt * Math.PI) / 180;
    const isoOffsetX = -Math.sin(rotRad) * 1.5;
    const isoOffsetY = 2.5 + Math.sin(tiltRad) * 1.5;
    // Sort buildings back-to-front (highest latitude first) for correct 2.5D overlap
    // Uses Schwartzian Transform: pre-compute centroid to avoid recalculation per comparison
    const features = [...(this.buildingsGeojson.features || [])];
    const decorated = features.map(f => [this._centroidLat(f), f]);
    decorated.sort((a, b) => b[0] - a[0]);
    decorated.forEach(([, feature], index) => { this.renderBuilding(ctx, feature, isoOffsetX, isoOffsetY, index); });
    return canvas;
  }

  _latToMercY(lat) { return Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)); }

  lonLatToPixel(lon, lat) {
    const xNorm = (lon - this.minLon) / (this.maxLon - this.minLon);
    const yMerc = this._latToMercY(lat);
    const yMinMerc = this._latToMercY(this.minLat);
    const yMaxMerc = this._latToMercY(this.maxLat);
    const yNorm = (yMaxMerc - yMerc) / (yMaxMerc - yMinMerc);
    return [Math.round(xNorm * this.width), Math.round(yNorm * this.height)];
  }

  // Calculate bounding box from all building coordinates (including all MultiPolygon rings) plus bounding polygon
  calculateBounds() {
    const lons = [], lats = [];
    if (this.boundingPolygon) for (const [lon, lat] of this.boundingPolygon) { lons.push(lon); lats.push(lat); }
    for (const f of (this.buildingsGeojson.features || [])) { for (const c of this.extractAllCoordinates(f.geometry)) { for (const [lon, lat] of c) { lons.push(lon); lats.push(lat); } } }
    if (lons.length === 0) { this.minLon=0; this.maxLon=1; this.minLat=0; this.maxLat=1; this.refLon=0.5; this.refLat=0.5; return; }
    let mnLo = Infinity, mxLo = -Infinity, mnLa = Infinity, mxLa = -Infinity;
    for (const v of lons) { if (v < mnLo) mnLo = v; if (v > mxLo) mxLo = v; }
    for (const v of lats) { if (v < mnLa) mnLa = v; if (v > mxLa) mxLa = v; }
    const lp=(mxLo-mnLo)*0.08, ap=(mxLa-mnLa)*0.08;
    this.minLon=mnLo-lp; this.maxLon=mxLo+lp; this.minLat=mnLa-ap; this.maxLat=mxLa+ap;
    this.refLon=(this.minLon+this.maxLon)/2; this.refLat=(this.minLat+this.maxLat)/2;
  }

  // Calculate building footprint area in m² using Shoelace formula
  calculateBuildingArea(coords) {
    if (!coords || coords.length < 3) return 0;
    const p = coords.map(([lon, lat]) => this._lonLatToMeters(lon, lat));
    let a = 0; const n = p.length;
    for (let i = 0; i < n; i++) { const j = (i+1)%n; a += p[i][0]*p[j][1] - p[j][0]*p[i][1]; }
    return Math.abs(a) / 2;
  }

  // Determine building extrusion height from OSM tags (height > building:levels * 3m > default)
  getBuildingHeight(props) {
    if (this.uniformHeight) return this.extrude;
    if (!props) return this.extrude;
    if (props.height != null) { const v = parseFloat(String(props.height).replace(/m$/i,'')); if (!isNaN(v)) return v; }
    if (props['building:levels'] != null) { const v = parseFloat(props['building:levels']); if (!isNaN(v)) return v * 3.0; }
    return this.extrude;
  }

  // Render a single building: wall faces (darkened) + roof polygon, store clickable polygon
  renderBuilding(ctx, feature, isoOffsetX, isoOffsetY, index) {
    const allCoords = this.extractAllCoordinates(feature.geometry);
    if (allCoords.length === 0) return;
    const height = this.getBuildingHeight(feature.properties);
    const wc = this.darkenColor(this.roofColor, 0.7);
    let allPixels = [];
    let totalLon = 0, totalLat = 0, totalPts = 0;
    for (const coords of allCoords) {
      if (!coords || coords.length < 3) continue;
      if (this.calculateBuildingArea(coords) < this.minArea) continue;
      const gp = coords.map(([lon, lat]) => this.lonLatToPixel(lon, lat));
      const rp = gp.map(([x, y]) => [x + Math.round(height * isoOffsetX), y - Math.round(height * isoOffsetY)]);
      // Draw wall faces: set styles once, batch all wall quads into a single path
      ctx.fillStyle = wc; ctx.strokeStyle = this.outlineColor; ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < gp.length; i++) {
        const j = (i+1) % gp.length;
        ctx.moveTo(gp[i][0],gp[i][1]); ctx.lineTo(gp[j][0],gp[j][1]); ctx.lineTo(rp[j][0],rp[j][1]); ctx.lineTo(rp[i][0],rp[i][1]); ctx.closePath();
      }
      ctx.fill(); ctx.stroke();
      // Draw roof polygon
      ctx.fillStyle = this.roofColor;
      ctx.beginPath(); ctx.moveTo(rp[0][0],rp[0][1]);
      for (let i = 1; i < rp.length; i++) ctx.lineTo(rp[i][0],rp[i][1]);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      allPixels.push(...gp, ...rp);
      for (const [lon, lat] of coords) { totalLon += lon; totalLat += lat; totalPts++; }
    }
    if (allPixels.length === 0) return;
    const cp = this.simplify ? this.convexHull(allPixels) : allPixels;
    const cLon = totalPts > 0 ? totalLon / totalPts : 0;
    const cLat = totalPts > 0 ? totalLat / totalPts : 0;
    this.buildingPolygons.push({ index, polygon: cp.map(([x,y]) => [x/this.width, y/this.height]), properties: feature.properties || {}, centroid: [cLon, cLat] });
  }

  // Extract outer ring of first polygon only (for single-point operations like extractCoordinates fallback)
  extractCoordinates(g) {
    if (!g) return null;
    if (g.type === 'Polygon') return g.coordinates[0] || null;
    if (g.type === 'MultiPolygon') {
        const fp = g.coordinates[0]; return fp ? fp[0] || null : null;
    }
    return null;
  }

  // Extract all outer rings from Polygon or MultiPolygon (for bounds, centroid, rendering)
  extractAllCoordinates(g) {
    if (!g) return [];
    if (g.type === 'Polygon') { const c = g.coordinates[0]; return c ? [c] : []; }
    if (g.type === 'MultiPolygon') { return g.coordinates.map(poly => poly[0]).filter(Boolean); }
    return [];
  }

  convexHull(points) {
    if (points.length <= 1) return points.slice();
    // Sort points lexicographically by x, then y
    const sorted = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    // Cross product: positive = counter-clockwise turn
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    // Build lower hull (left to right)
    const lower = [];
    for (const p of sorted) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
      lower.push(p);
    }
    // Build upper hull (right to left)
    const upper = [];
    for (let i = sorted.length - 1; i >= 0; i--) {
      const p = sorted[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
      upper.push(p);
    }
    // Remove last point of each half (duplicate of the other's first point)
    lower.pop();
    upper.pop();
    return lower.concat(upper);
  }

  // Darken a hex color by multiplying RGB channels by factor (0-1)
  darkenColor(hex, factor) {
    let h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const r = Math.round(parseInt(h.substring(0, 2), 16) * factor);
    const g = Math.round(parseInt(h.substring(2, 4), 16) * factor);
    const b = Math.round(parseInt(h.substring(4, 6), 16) * factor);
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  // Convert lon/lat to tile coordinates (Slippy Map tilenames)
  _lonLatToTile(lon, lat, zoom) {
    const n = 2**zoom; const latRad = lat*Math.PI/180;
    return [Math.floor((lon+180)/360*n), Math.floor((1-Math.log(Math.tan(latRad)+1/Math.cos(latRad))/Math.PI)/2*n)];
  }
  _tileToLonLat(tx, ty, zoom) {
    const n = 2**zoom; return [tx/n*360-180, Math.atan(Math.sinh(Math.PI*(1-2*ty/n)))*180/Math.PI];
  }
  // Download a single tile, using static Map cache to avoid re-downloading across renders
  _downloadTile(tx, ty, zoom) {
    const key = zoom + '/' + tx + '/' + ty;
    if (Building25DRenderer._tileCache.has(key)) return Promise.resolve(Building25DRenderer._tileCache.get(key));
    return new Promise((resolve, reject) => {
      const img = new Image(); img.crossOrigin='anonymous';
      img.onload = () => { Building25DRenderer._tileCache.set(key, img); resolve(img); };
      img.onerror = () => reject(new Error('Tile failed'));
      img.src = 'https://tile.openstreetmap.org/'+zoom+'/'+tx+'/'+ty+'.png';
    });
  }

  // Download tiles in batches of 2 (OSM tile policy: max 2 parallel connections)
  async _downloadTilesWithLimit(tileCoords, zoom) {
    const CONCURRENCY = 2;
    const results = [];
    for (let i = 0; i < tileCoords.length; i += CONCURRENCY) {
      const batch = tileCoords.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map(({tx, ty}) => this._downloadTile(tx, ty, zoom).then(img => ({img, tx, ty})).catch(() => ({img: null, tx, ty})))
      );
      results.push(...batchResults);
    }
    return results;
  }

  // Draw OSM tile background: find optimal zoom level, download tiles, composite and crop to bounds
  async _drawMapBackground(ctx) {
    // Find highest zoom level where total tile count stays ≤ 64
    let zoom = 17;
    for (let z = 18; z >= 10; z--) {
      const [minTX] = this._lonLatToTile(this.minLon, this.minLat, z);
      const [maxTX, minTY] = this._lonLatToTile(this.maxLon, this.maxLat, z);
      const [, maxTY] = this._lonLatToTile(this.minLon, this.minLat, z);
      if ((maxTX-minTX+1)*(maxTY-minTY+1) <= 64) { zoom = z; break; }
    }
    const [minTileX, maxTileY] = this._lonLatToTile(this.minLon, this.minLat, zoom);
    const [maxTileX, minTileY] = this._lonLatToTile(this.maxLon, this.maxLat, zoom);
    const tw = maxTileX-minTileX+1, th = maxTileY-minTileY+1, ts = 256;
    const tileCoords = [];
    for (let ty = minTileY; ty <= maxTileY; ty++)
      for (let tx = minTileX; tx <= maxTileX; tx++)
        tileCoords.push({tx, ty});
    const tiles = await this._downloadTilesWithLimit(tileCoords, zoom);
    // Composite tiles into a temporary canvas
    const cW=tw*ts, cH=th*ts, comp=document.createElement('canvas'); comp.width=cW; comp.height=cH;
    const cc=comp.getContext('2d');
    for (const {img,tx,ty} of tiles) { if (img) cc.drawImage(img,(tx-minTileX)*ts,(ty-minTileY)*ts,ts,ts); }
    // Calculate crop region: map geo-bounds to pixel coordinates on composite canvas
    const [cMinLon,cMaxLat]=this._tileToLonLat(minTileX,minTileY,zoom);
    const [cMaxLon,cMinLat]=this._tileToLonLat(maxTileX+1,maxTileY+1,zoom);
    const lr=cMaxLon-cMinLon;
    const cl=(this.minLon-cMinLon)/lr*cW, cr=(this.maxLon-cMinLon)/lr*cW;
    // Use Mercator projection for latitude cropping to match tile projection
    const cMinMerc=this._latToMercY(cMinLat), cMaxMerc=this._latToMercY(cMaxLat);
    const mercRange=cMaxMerc-cMinMerc;
    const ct=(cMaxMerc-this._latToMercY(this.maxLat))/mercRange*cH;
    const cb=(cMaxMerc-this._latToMercY(this.minLat))/mercRange*cH;
    const sw=cr-cl, sh=cb-ct;
    if (sw>0 && sh>0) ctx.drawImage(comp,cl,ct,sw,sh,0,0,this.width,this.height);
    // Free intermediate canvas memory
    comp.width = 0; comp.height = 0;
    // Draw OSM attribution
    ctx.save();
    ctx.font = '11px sans-serif';
    const attrText = '\u00A9 OpenStreetMap contributors';
    const tm = ctx.measureText(attrText);
    const ax = this.width - tm.width - 6, ay = this.height - 6;
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillRect(ax - 4, ay - 12, tm.width + 8, 16);
    ctx.fillStyle = '#333';
    ctx.fillText(attrText, ax, ay);
    ctx.restore();
  }

  // Convert lon/lat to meters relative to reference point (equirectangular approximation)
  _lonLatToMeters(lon, lat) {
    return [EARTH_RADIUS*((lon-this.refLon)*Math.PI/180)*Math.cos(this.refLat*Math.PI/180), EARTH_RADIUS*((lat-this.refLat)*Math.PI/180)];
  }
  // Average latitude of all coordinate rings (used for back-to-front sort)
  _centroidLat(f) {
    const allCoords = this.extractAllCoordinates(f.geometry);
    let s = 0, n = 0;
    for (const c of allCoords) { for (const [, lat] of c) { s += lat; n++; } }
    return n > 0 ? s / n : 0;
  }
}
Building25DRenderer._tileCache = new Map();

// --------------------------------------------------------------------------
// polygon-extractor.js
// --------------------------------------------------------------------------
/**
 * Calculate Haversine distance in meters between two geographic points.
 * @param {[number, number]} a - First point [lon, lat]
 * @param {[number, number]} b - Second point [lon, lat]
 * @returns {number} Distance in meters
 */
function _haversineMeters(a, b) {
    const toRad = v => v * Math.PI / 180;
    const dLat = toRad(b[1] - a[1]), dLon = toRad(b[0] - a[0]);
    const lat1 = toRad(a[1]), lat2 = toRad(b[1]);
    const h = Math.sin(dLat/2)**2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon/2)**2;
    return EARTH_RADIUS * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

// Max distance in meters for centroid matching
const MIGRATION_THRESHOLD_M = 15;

/**
 * Create the building JSON data structure from rendered polygons.
 * Maps OSM properties to building metadata, assigns colors, and migrates metadata from previous buildings via centroid matching.
 * @param {HTMLCanvasElement} canvas - Rendered map canvas
 * @param {Array<{index: number, polygon: Array, properties: Object, centroid: [number, number]}>} buildingPolygons - Extracted polygons from renderer
 * @param {string} imageFilename - Filename for the exported image
 * @param {Array|null} previousBuildings - Previous buildings array for metadata migration
 * @returns {{title: string, image: Object, buildings: Array}} Building JSON structure
 */
function createBuildingJson(canvas, buildingPolygons, imageFilename, previousBuildings) {
    const palette = ['#FF6B6B','#4ECDC4','#45B7D1','#FFA07A','#98D8C8','#F7DC6F','#BB8FCE','#85C1E2','#F8B739','#52B788','#E63946','#F77F00','#06D6A0','#118AB2','#073B4C','#FFB703','#FB8500','#8338EC','#3A86FF','#FF006E'];

    const buildings = buildingPolygons.map(p => {
        const tags = p.properties || {};
        const name = tags.name || tags['name:de'] || tags.short_name || '';
        const nummer = tags['addr:housenumber'] || tags.ref || '';
        const buildingType = tags.building !== 'yes' ? tags.building || '' : '';
        const amenity = tags.amenity || '';
        const descParts = [];
        if (buildingType) descParts.push('Gebäudetyp: ' + buildingType);
        if (amenity) descParts.push('Nutzung: ' + amenity);
        if (tags.description) descParts.push(tags.description);
        return {
            id: 'building_' + p.index,
            nummer: nummer,
            name: name || 'Gebäude ' + p.index,
            gruppe: '',
            beschreibung: descParts.join('\n'),
            highlightColor: palette[p.index % palette.length],
            polygon: p.polygon,
            centroid: p.centroid,
            disabled: true
        };
    });

    // Migrate metadata from previous buildings if available
    if (previousBuildings && previousBuildings.length > 0) {
        const used = new Set();
        for (const bNew of buildings) {
            if (!bNew.centroid) continue;
            let bestMatch = null;
            let bestDist = Infinity;
            for (let i = 0; i < previousBuildings.length; i++) {
                if (used.has(i)) continue;
                const bOld = previousBuildings[i];
                if (!bOld.centroid) continue;
                const d = _haversineMeters(bNew.centroid, bOld.centroid);
                if (d < bestDist) { bestDist = d; bestMatch = i; }
            }
            if (bestMatch !== null && bestDist <= MIGRATION_THRESHOLD_M) {
                const old = previousBuildings[bestMatch];
                used.add(bestMatch);
                bNew.nummer = old.nummer;
                bNew.name = old.name;
                bNew.gruppe = old.gruppe;
                bNew.beschreibung = old.beschreibung;
                bNew.highlightColor = old.highlightColor;
                if (old.polygons) bNew.polygons = JSON.parse(JSON.stringify(old.polygons));
                if ('disabled' in old) bNew.disabled = old.disabled;
            }
        }
        const migrated = used.size;
        const total = buildings.length;
        console.log('[migration] ' + migrated + '/' + total + ' Gebäude wiedererkannt (Schwelle: ' + MIGRATION_THRESHOLD_M + ' m)');
    }

    return {
        image: { filename: imageFilename, width: canvas.width, height: canvas.height },
        buildings
    };
}

// --------------------------------------------------------------------------
// export.js
// --------------------------------------------------------------------------
/**
 * Get the standalone HTML viewer template string.
 * Contains inline CSS, JS for sidebar, map overlay, popups, and search.
 * Data is injected via window.__buildingsData in the generated file.
 * @returns {string} Complete HTML template
 * @private
 */
function _getViewerTemplate() {
    return `<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Geb\u00e4udekarte - Interaktive Karte</title>
    <style>
        *{margin:0;padding:0;box-sizing:border-box}
        body{font-family:"Segoe UI",system-ui,-apple-system,Arial,Helvetica,sans-serif;height:100vh;overflow:hidden;background:#d6d3c8}
        .container{display:flex;height:100vh}
        .sidebar{width:300px;background:#ffffff;color:#1a1a1a;overflow-y:auto;border-right:1px solid #c0bda8;border-left:3px solid #4b5320}
        .sidebar-header{padding:20px;border-bottom:1px solid #c0bda8}
        .sidebar-header h1{font-size:1.15rem;font-weight:700;color:#2d331a;margin-bottom:5px;text-transform:uppercase;letter-spacing:0.03em}
        .sidebar-header p{font-size:12px;color:#888}
        .group{border-bottom:1px solid #e8e6df}
        .group-header{padding:12px 20px;background:#f5f4ee;cursor:pointer;display:flex;justify-content:space-between;align-items:center;transition:background 0.2s}
        .group-header:hover{background:#e8e6df}
        .group-header h2{font-size:0.85rem;font-weight:700;color:#4b5320;text-transform:uppercase;letter-spacing:0.03em}
        .group-toggle{font-size:12px;color:#b0ad98;transition:transform 0.3s}
        .group.collapsed .group-toggle{transform:rotate(-90deg)}
        .group-buildings{max-height:1000px;overflow:hidden;transition:max-height 0.3s ease}
        .group.collapsed .group-buildings{max-height:0}
        .building-item{padding:10px 20px 10px 35px;cursor:pointer;transition:background 0.2s;border-left:3px solid transparent}
        .building-item:hover{background:#f5f4ee;border-left-color:#6b7530}
        .building-item.highlighted{background:#e8e6df;border-left-color:#f39c12}
        .search-bar{padding:10px 20px;border-bottom:1px solid #c0bda8;background:#fff;position:sticky;top:0;z-index:10}
        .search-input{width:100%;padding:7px 10px;border:1px solid #c0bda8;border-radius:2px;font-size:0.85rem;background:#f5f4ee;font-family:inherit}
        .search-input:focus{outline:none;border-color:#4b5320}
        .building-name{font-size:14px;font-weight:500;color:#1a1a1a}
        .building-nummer{font-weight:700;color:#4b5320}
        .building-id{font-size:11px;color:#888;margin-top:2px}
        .main-content{flex:1;overflow:auto;background:#d6d3c8;display:flex;justify-content:center;align-items:center;padding:20px}
        .image-container{position:relative;display:inline-block;max-width:100%;max-height:100%;box-shadow:0 4px 6px rgba(0,0,0,0.15)}
        .image-container img{display:block;width:100%;height:auto}
        .svg-overlay{position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none}
        .building-polygon{fill:rgba(255,255,0,0);stroke:rgba(255,255,0,0);stroke-width:2;pointer-events:auto;cursor:pointer;transition:fill 0.2s,stroke 0.2s}
        .selection-circle{fill:none;stroke:#4b5320;stroke-width:4;pointer-events:none}
        .dim-overlay{fill:rgba(0,0,0,0.6);pointer-events:none}
        .modal-overlay{display:none;position:absolute;top:0;left:0;width:100%;height:100%;z-index:200;pointer-events:none}
        .modal-overlay.active{display:block}
        .modal-content{position:absolute;background:#ffffff;border-radius:2px;border:1px solid #c0bda8;border-left:3px solid #4b5320;padding:25px 30px;min-width:280px;max-width:400px;box-shadow:0 10px 40px rgba(0,0,0,0.3);pointer-events:auto}
        .modal-close{position:absolute;top:10px;right:10px;background:none;border:none;font-size:28px;cursor:pointer;color:#b0ad98;width:35px;height:35px;display:flex;align-items:center;justify-content:center;border-radius:2px;transition:background 0.2s,color 0.2s;line-height:1}
        .modal-close:hover{background:#e8e6df;color:#2d331a}
        .modal-content h2{margin:0;color:#2d331a;font-size:22px;padding-right:25px}
        .modal-breadcrumb{font-size:12px;color:#6b7530;margin:4px 0 0 0}
        .modal-breadcrumb span::after{content:' \\203A ';margin:0 2px}
        .modal-breadcrumb span:last-child::after{content:''}
        .modal-header{margin-bottom:20px}
        .modal-nummer{font-size:13px;font-weight:700;color:#4b5320;text-transform:uppercase;letter-spacing:0.03em;margin-bottom:2px}
        .modal-beschreibung{color:#1a1a1a;font-size:15px;line-height:1.5}
        .loading{text-align:center;padding:40px;color:#b0ad98}
        .error{text-align:center;padding:40px;color:#c0392b}
    </style>
</head>
<body>
    <div class="container">
        <aside class="sidebar">
            <div class="sidebar-header">
                <h1 id="sidebar-title">Geb\u00e4udekarte</h1>
                <p>Interaktive Karte</p>
            </div>
            <div class="search-bar"><input type="text" class="search-input" id="search-input" placeholder="Geb\u00e4ude suchen..."></div>
            <div id="sidebar-content" class="loading">Lade Geb\u00e4udedaten...</div>
        </aside>
        <main class="main-content">
            <div id="image-container-wrapper" class="loading">Lade Karte...</div>
        </main>
    </div>
    <div style="position:fixed;bottom:0;left:0;right:0;padding:4px 20px;font-size:11px;color:#888;background:#f5f4ee;border-top:1px solid #c0bda8;z-index:999">Daten: \u00a9 <a href="https://www.openstreetmap.org/copyright" style="color:#6b7530">OpenStreetMap</a> contributors</div>
    <script>
        let buildingsData=null;let currentHighlighted=new Set();let selectedBuildingId=null;
        function esc(s){if(typeof s!=='string')return '';return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
        async function init(){try{if(window.__buildingsData){buildingsData=window.__buildingsData}else{const r=await fetch('gebaeude_polygone.json');if(!r.ok)throw new Error('Konnte gebaeude_polygone.json nicht laden');buildingsData=await r.json()}const title=buildingsData.title||'Geb\\u00e4udekarte';document.getElementById('sidebar-title').textContent=title;document.title=title+' - Interaktive Karte';renderImage();renderSidebar()}catch(e){const el=document.getElementById('sidebar-content');el.textContent='';const d=document.createElement('div');d.className='error';d.textContent='Fehler: '+e.message;el.appendChild(d);document.getElementById('image-container-wrapper').innerHTML='<div class="error">Fehler beim Laden</div>';console.error(e)}}
        function renderImage(){const w=document.getElementById('image-container-wrapper');const{filename,width,height}=buildingsData.image;const c=document.createElement('div');c.className='image-container';const img=document.createElement('img');img.src=buildingsData.image.dataUrl||filename;img.alt='Karte';c.appendChild(img);const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('class','svg-overlay');svg.setAttribute('viewBox','0 0 '+width+' '+height);svg.setAttribute('preserveAspectRatio','xMidYMid meet');buildingsData.buildings.filter(b=>!b.disabled).forEach(b=>{const polys=b.polygons||[b.polygon];polys.forEach(poly=>{const p=document.createElementNS('http://www.w3.org/2000/svg','polygon');p.setAttribute('points',poly.map(([x,y])=>(x*width)+','+(y*height)).join(' '));p.setAttribute('class','building-polygon');p.setAttribute('data-building-id',b.id);p.addEventListener('mouseenter',()=>highlightBuilding(b.id));p.addEventListener('mouseleave',()=>unhighlightBuilding(b.id));p.addEventListener('click',()=>showPopup(b));svg.appendChild(p)})});c.appendChild(svg);const mo=document.createElement('div');mo.className='modal-overlay';mo.id='modal-overlay';mo.innerHTML='<div class="modal-content"><button class="modal-close" id="modal-close">&times;</button><div class="modal-header"><div class="modal-nummer" id="modal-nummer" style="display:none"></div><h2 id="modal-title"></h2><div class="modal-breadcrumb" id="modal-breadcrumb"></div></div><div class="modal-beschreibung" id="modal-beschreibung" style="display:none"></div></div>';c.appendChild(mo);w.innerHTML='';w.appendChild(c);document.getElementById('modal-close').addEventListener('click',hidePopup)}
        function renderSidebar(){const sidebar=document.getElementById('sidebar-content');const gh={};buildingsData.buildings.filter(b=>!b.disabled).forEach(b=>{const g=b.gruppe||'Sonstige';const parts=g.split(' > ').map(p=>p.trim());let cl=gh;parts.forEach((part,i)=>{if(!cl[part])cl[part]={buildings:[],subgroups:{}};if(i===parts.length-1)cl[part].buildings.push(b);cl=cl[part].subgroups})});function sn(n){return n.sort((a,b)=>{if(a==='Unbekannt'||a==='Sonstige')return 1;if(b==='Unbekannt'||b==='Sonstige')return -1;return a.localeCompare(b)})}function gbi(gd){const ids=gd.buildings.map(b=>b.id);Object.values(gd.subgroups).forEach(sg=>{ids.push(...gbi(sg))});return ids}function rg(gn,gd,l){const g=document.createElement('div');g.className='group';g.style.marginLeft=(l*15)+'px';const bids=gbi(gd);const h=document.createElement('div');h.className='group-header';h.style.paddingLeft=(20-l*5)+'px';const h2=document.createElement('h2');h2.textContent=gn;const sp=document.createElement('span');sp.className='group-toggle';sp.textContent='\\u25BC';h.appendChild(h2);h.appendChild(sp);h.addEventListener('click',()=>g.classList.toggle('collapsed'));h.addEventListener('mouseenter',()=>bids.forEach(id=>highlightBuilding(id)));h.addEventListener('mouseleave',()=>bids.forEach(id=>unhighlightBuilding(id)));g.appendChild(h);const ct=document.createElement('div');ct.className='group-buildings';gd.buildings.forEach(b=>{const it=document.createElement('div');it.className='building-item';it.style.paddingLeft=(35+l*15)+'px';it.setAttribute('data-building-id',b.id);it.setAttribute('data-search-text',[b.name,b.nummer,b.gruppe].filter(Boolean).join(' ').toLowerCase());const nd=document.createElement('div');nd.className='building-name';nd.textContent=b.name;it.appendChild(nd);it.addEventListener('mouseenter',()=>highlightBuilding(b.id));it.addEventListener('mouseleave',()=>unhighlightBuilding(b.id));it.addEventListener('click',()=>showPopup(b));ct.appendChild(it)});sn(Object.keys(gd.subgroups)).forEach(sn2=>{ct.appendChild(rg(sn2,gd.subgroups[sn2],l+1))});g.appendChild(ct);return g}sidebar.innerHTML='';sn(Object.keys(gh)).forEach(gn=>{sidebar.appendChild(rg(gn,gh[gn],0))})}
        function highlightBuilding(id){currentHighlighted.add(id);const b=buildingsData.buildings.find(x=>x.id===id);const hc=b?.highlightColor||'#FFC107';const rgb=hexToRgb(hc);document.querySelectorAll('.building-polygon[data-building-id="'+id+'"]').forEach(p=>{p.style.fill='rgba('+rgb.r+','+rgb.g+','+rgb.b+',0.35)';p.style.stroke=hc;p.style.strokeWidth='3'});const mi=document.querySelector('.building-item[data-building-id="'+id+'"]');if(mi){mi.classList.add('highlighted');mi.style.borderLeftColor=hc}}
        function unhighlightBuilding(id){currentHighlighted.delete(id);if(id===selectedBuildingId)return;document.querySelectorAll('.building-polygon[data-building-id="'+id+'"]').forEach(p=>{p.style.fill='rgba(255,255,0,0)';p.style.stroke='rgba(255,255,0,0)';p.style.strokeWidth='2'});const mi=document.querySelector('.building-item[data-building-id="'+id+'"]');if(mi){mi.classList.remove('highlighted');mi.style.borderLeftColor=''}}
        function hexToRgb(hex){const r=/^#?([a-f\\d]{2})([a-f\\d]{2})([a-f\\d]{2})$/i.exec(hex);return r?{r:parseInt(r[1],16),g:parseInt(r[2],16),b:parseInt(r[3],16)}:{r:255,g:193,b:7}}
        function showPopup(building){hidePopup();selectedBuildingId=building.id;highlightBuilding(building.id);const polygon=document.querySelector('.building-polygon[data-building-id="'+building.id+'"]');if(!polygon)return;const polys=building.polygons||[building.polygon];let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;polys.forEach(poly=>poly.forEach(([x,y])=>{minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y)}));const centerX=(minX+maxX)/2,centerY=(minY+maxY)/2;const bW=maxX-minX,bH=maxY-minY;const calcR=Math.max(bW,bH)/2*1.8;const radius=Math.max(calcR,0.04);const svg=polygon.closest('svg');const vb=svg.getAttribute('viewBox').split(' ');const svgW=parseFloat(vb[2]),svgH=parseFloat(vb[3]);let defs=svg.querySelector('defs');if(!defs){defs=document.createElementNS('http://www.w3.org/2000/svg','defs');svg.insertBefore(defs,svg.firstChild)}const mask=document.createElementNS('http://www.w3.org/2000/svg','mask');mask.setAttribute('id','selection-mask');const mr=document.createElementNS('http://www.w3.org/2000/svg','rect');mr.setAttribute('width',svgW);mr.setAttribute('height',svgH);mr.setAttribute('fill','white');mask.appendChild(mr);const mc=document.createElementNS('http://www.w3.org/2000/svg','circle');mc.setAttribute('cx',centerX*svgW);mc.setAttribute('cy',centerY*svgH);mc.setAttribute('r',radius*Math.max(svgW,svgH));mc.setAttribute('fill','black');mask.appendChild(mc);defs.appendChild(mask);const dr=document.createElementNS('http://www.w3.org/2000/svg','rect');dr.setAttribute('class','dim-overlay');dr.setAttribute('width',svgW);dr.setAttribute('height',svgH);dr.setAttribute('mask','url(#selection-mask)');svg.appendChild(dr);const circle=document.createElementNS('http://www.w3.org/2000/svg','circle');circle.setAttribute('class','selection-circle');circle.setAttribute('cx',centerX*svgW);circle.setAttribute('cy',centerY*svgH);circle.setAttribute('r',radius*Math.max(svgW,svgH));svg.appendChild(circle);const modal=document.getElementById('modal-overlay');const modalContent=document.querySelector('.modal-content');const ne=document.getElementById('modal-nummer');if(building.nummer&&building.nummer.trim()){ne.textContent=building.nummer;ne.style.display='block'}else{ne.style.display='none'}document.getElementById('modal-title').textContent=building.name;const bc=document.getElementById('modal-breadcrumb');const gruppe=(building.gruppe||'').trim();if(gruppe){const parts=gruppe.split(/\s*>\s*/);bc.innerHTML=parts.map(p=>'<span>'+esc(p)+'</span>').join('');bc.style.display='block'}else{bc.style.display='none'}const bd=document.getElementById('modal-beschreibung');if(building.beschreibung&&building.beschreibung.trim()){bd.textContent=building.beschreibung;bd.style.display='block'}else{bd.style.display='none'}modal.classList.add('active');requestAnimationFrame(()=>{const ic=document.querySelector('.image-container');if(!ic)return;const img=ic.querySelector('img');const iw=img.offsetWidth,ih=img.offsetHeight;const mR=modalContent.getBoundingClientRect();const bx=centerX*iw,by=centerY*ih;const crPx=radius*Math.max(iw,ih);const gap=20,margin=15;let left,top;const isRight=centerX>0.5;const cle=bx-crPx,cre=bx+crPx;if(isRight){const tl=cle-gap-mR.width;if(tl>=margin){left=tl;top=by-(mR.height/2)}else{left=bx-(mR.width/2);top=by+crPx+gap}}else{const tl=cre+gap;if(tl+mR.width<=iw-margin){left=tl;top=by-(mR.height/2)}else{left=bx-(mR.width/2);top=by+crPx+gap}}if(left===bx-(mR.width/2)&&top!==undefined){if(top+mR.height>ih-margin){const ta=by-crPx-gap-mR.height;if(ta>=margin)top=ta}}left=Math.max(margin,Math.min(left,iw-mR.width-margin));top=Math.max(margin,Math.min(top,ih-mR.height-margin));modalContent.style.left=left+'px';modalContent.style.top=top+'px'})}
        function hidePopup(){if(selectedBuildingId){const prev=selectedBuildingId;selectedBuildingId=null;unhighlightBuilding(prev)}const c=document.querySelector('.selection-circle');const d=document.querySelector('.dim-overlay');const m=document.getElementById('selection-mask');const mo=document.getElementById('modal-overlay');if(c)c.remove();if(d)d.remove();if(m)m.remove();if(mo)mo.classList.remove('active')}
        document.addEventListener('keydown',e=>{if(e.key==='Escape')hidePopup()});
        document.addEventListener('click',e=>{if(!e.target.closest('.building-polygon')&&!e.target.closest('.building-item')&&!e.target.closest('.sidebar')&&!e.target.closest('.modal-content'))hidePopup()});
        document.getElementById('search-input').addEventListener('input',function(){const q=this.value.toLowerCase().trim();const sc=document.getElementById('sidebar-content');sc.querySelectorAll('.building-item').forEach(it=>{it.style.display=(!q||it.getAttribute('data-search-text').includes(q))?'':'none'});sc.querySelectorAll('.group').forEach(g=>{g.style.display=Array.from(g.querySelectorAll('.building-item')).some(it=>it.style.display!=='none')?'':'none'})});
        init();
    <\/script>
</body>
</html>`;
}

/**
 * Create a self-contained HTML file with embedded image and building data.
 * @param {Object} buildingsData - Building JSON data
 * @param {HTMLCanvasElement} canvasElement - Rendered map canvas
 * @param {Object|null} sourcePolygon - Source GeoJSON polygon (optional)
 * @param {Object|null} params - Render parameters (optional)
 * @returns {Promise<string>} Complete HTML string ready for download
 */
async function createStandaloneHtml(buildingsData, canvasElement, sourcePolygon, params) {
    const imageBlob = await canvasToBlob(canvasElement);
    const imageDataUrl = await blobToDataUrl(imageBlob);
    let html = _getViewerTemplate();
    const inlineData = { ...buildingsData, image: { ...buildingsData.image, dataUrl: imageDataUrl } };
    if (sourcePolygon) inlineData.sourcePolygon = sourcePolygon;
    if (params) inlineData.params = params;
    html = html.replace('</head>', '<script>window.__buildingsData = ' + JSON.stringify(inlineData).replace(/<\//g, '<\\/') + ';<\/script>\n</head>');
    return html;
}

function _triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function downloadHtmlFile(html, filename) { _triggerDownload(new Blob([html], {type:'text/html'}), filename || 'building-map.html'); }
function downloadJsonFile(data, filename) { _triggerDownload(new Blob([JSON.stringify(data,null,2)], {type:'application/json'}), filename || 'gebaeude_polygone.json'); }
function downloadImageFile(canvas, filename) { canvas.toBlob(b => _triggerDownload(b, filename || 'rendered.png'), 'image/png'); }

// --------------------------------------------------------------------------
// pipeline.js
// --------------------------------------------------------------------------
/**
 * Pipeline orchestrator: downloads buildings, renders 2.5D view, extracts polygons, and exports.
 * @class
 * @param {{onProgress: Function, onLog: Function, onComplete: Function, onError: Function}} callbacks
 */
class Pipeline {
    constructor(callbacks) { this.callbacks=callbacks; this.buildingsGeojson=null; this.canvas=null; this.buildingJson=null; }

    /** Run full pipeline: download → render → extract → complete. */
    async run(geojsonData, params) {
        try {
            this.callbacks.onProgress(1, 'Downloading...');
            this.callbacks.onLog('[INFO] Starte Download von OpenStreetMap...');
            this.buildingsGeojson = await downloadBuildings(geojsonData);
            PipelineDB.put('buildings_cache', 'osm', this.buildingsGeojson).catch(e => console.warn('[pipeline] Gebäude-Cache konnte nicht gespeichert werden:', e));
            this.callbacks.onLog('[INFO] ' + this.buildingsGeojson.features.length + ' Gebäude gefunden');
            await this.renderAndExtract(geojsonData, params);
        } catch (error) { this.callbacks.onError(error.message); }
    }

    _cleanupBeforeRender() {
        if (this.buildingJson?.image?.dataUrl?.startsWith('blob:')) {
            URL.revokeObjectURL(this.buildingJson.image.dataUrl);
        }
        if (this.canvas) { this.canvas.width = 0; this.canvas.height = 0; }
    }

    async renderAndExtract(geojsonData, params) {
        this.callbacks.onProgress(2, 'Rendering...');
        this.callbacks.onLog('[INFO] Lade Kartenhintergrund und starte 2.5D Rendering...');
        this._cleanupBeforeRender();
        const polygon = extractPolygonCoords(geojsonData);
        const renderer = new Building25DRenderer(this.buildingsGeojson, polygon, params);
        this.canvas = await renderer.render();
        this.callbacks.onLog('[INFO] ' + renderer.buildingPolygons.length + ' Gebäude gerendert');
        this.callbacks.onProgress(3, 'Extracting...');
        this.callbacks.onLog('[INFO] Extrahiere Polygone...');
        const prevBuildings = this.buildingJson ? this.buildingJson.buildings : null;
        this.buildingJson = createBuildingJson(this.canvas, renderer.buildingPolygons, 'rendered.png', prevBuildings);
        if (prevBuildings) {
            const migrated = this.buildingJson.buildings.filter(b => b.name && !b.name.startsWith('Gebäude ')).length;
            this.callbacks.onLog('[INFO] ' + migrated + '/' + this.buildingJson.buildings.length + ' Gebäude-Metadaten migriert');
        }
        this.callbacks.onLog('[INFO] ' + this.buildingJson.buildings.length + ' klickbare Polygone extrahiert');
        const imageBlob = await canvasToBlob(this.canvas);
        this.buildingJson.image.dataUrl = URL.createObjectURL(imageBlob);
        const avg = this.buildingJson.buildings.length > 0 ? Math.round(this.buildingJson.buildings.reduce((s,b)=>s+(b.polygons||[b.polygon]).reduce((ps,p)=>ps+p.length,0),0)/this.buildingJson.buildings.length) : 0;
        this.callbacks.onProgress(4, 'Complete!');
        this.callbacks.onLog('[INFO] Pipeline abgeschlossen!');
        this.callbacks.onComplete({ buildingCount:this.buildingJson.buildings.length, imageWidth:this.canvas.width, imageHeight:this.canvas.height, avgPoints:avg, canvas:this.canvas, buildingJson:this.buildingJson });
    }

    async rerender(geojsonData, params) {
        if (!this.buildingsGeojson) { this.callbacks.onError('Keine gecachten Gebäudedaten. Bitte zuerst Pipeline ausführen.'); return; }
        try { await this.renderAndExtract(geojsonData, params); } catch (error) { this.callbacks.onError(error.message); }
    }

    async _getExportBuildingJson() {
        // EditorModule is the single source of truth after init()
        const editorData = EditorModule.getBuildingsData();
        if (editorData) {
            const copy = structuredClone(editorData);
            const imageBlob = await PipelineDB.get('images', 'rendered_map');
            if (imageBlob) {
                copy.image = copy.image || {};
                copy.image.dataUrl = await blobToDataUrl(imageBlob);
            }
            return copy;
        }
        return this.buildingJson;
    }
    async exportStandalone(sourcePolygon, params) {
        downloadHtmlFile(await createStandaloneHtml(await this._getExportBuildingJson(), this.canvas, sourcePolygon, params));
    }
    exportGeojson() { if (this.buildingsGeojson) downloadJsonFile(this.buildingsGeojson, 'buildings.geojson'); }
    exportImage() { downloadImageFile(this.canvas); }
}

// --------------------------------------------------------------------------
// Embedded viewer preview (uses ViewerWidget)
// --------------------------------------------------------------------------
let vpWidget = null;

function renderViewerPreview(buildingJson) {
    vpWidget = ViewerWidget.create({
        prefix: 'vp',
        highlightOpacity: 0.35,
        highlightStroke: 3,
        selectionStroke: 4,
        aspectRatio: 'xMidYMid meet',
        modalGap: 16,
        modalMargin: 10,
        filterDisabled: true,
        imageContainerId: 'vpImageContainer',
        getBuildingsData: () => buildingJson,
        onBuildingClick: (b) => vpWidget.showPopup(b),
        sidebarHeaderRenderer: (bd) => '<h3>' + escapeHtml(bd.title || 'Gebäudekarte') + '</h3><p>Interaktive Vorschau</p>',
    });
    document.getElementById('viewerPreview').style.display = 'flex';
    vpWidget.renderSidebar(document.getElementById('vpSidebar'), buildingJson);
    vpWidget.renderMap(document.getElementById('vpImageContainer'), buildingJson);
}

// Close viewer popup on Escape or click outside
document.addEventListener('keydown', (e) => { if (vpWidget && e.key === 'Escape') vpWidget.hidePopup(); });
document.addEventListener('click', (e) => {
    if (!vpWidget) return;
    if (e.target.closest('.vp-building-polygon') || e.target.closest('.vp-building-item') || e.target.closest('.vp-sidebar') || e.target.closest('.vp-modal-content')) return;
    if (e.target.closest('.viewer-preview')) vpWidget.hidePopup();
});

// ==========================================================================
// UI Controller
// ==========================================================================

const uploadZone      = document.getElementById('uploadZone');
const fileInput       = document.getElementById('fileInput');
const fileInfo        = document.getElementById('fileInfo');
const btnRun          = document.getElementById('btnRun');
const btnRerender     = document.getElementById('btnRerender');
const progressSteps   = document.getElementById('progressSteps');
const progressBarWrap = document.getElementById('progressBarWrap');
const progressBarFill = document.getElementById('progressBarFill');
const logConsole      = document.getElementById('logConsole');
const resultCard      = document.getElementById('resultCard');
const btnEditor       = document.getElementById('btnEditor');
const btnStandalone   = document.getElementById('btnStandalone');
const btnDownloadGeojson = document.getElementById('btnDownloadGeojson');
const btnDownloadImage= document.getElementById('btnDownloadImage');
const btnReset        = document.getElementById('btnReset');
const btnRerender2    = document.getElementById('btnRerender2');
const statBuildings   = document.getElementById('statBuildings');
const statResolution  = document.getElementById('statResolution');
const statAvgPoints   = document.getElementById('statAvgPoints');
const pSteps = [document.getElementById('pStep1'), document.getElementById('pStep2'), document.getElementById('pStep3')];

let geojsonData = null;
let pipeline = null;
let pipelineResult = null;

// ---- Parameter elements ----
const paramEls = {
    tilt:         { el: document.getElementById('paramTilt'),         valEl: document.getElementById('paramTiltVal'),         type: 'range' },
    rotation:     { el: document.getElementById('paramRotation'),     valEl: document.getElementById('paramRotationVal'),     type: 'range' },
    extrude:      { el: document.getElementById('paramExtrude'),      valEl: document.getElementById('paramExtrudeVal'),      type: 'range' },
    width:        { el: document.getElementById('paramWidth'),        type: 'number' },
    height:       { el: document.getElementById('paramHeight'),       type: 'number' },
    roofColor:    { el: document.getElementById('paramRoofColor'),    textEl: document.getElementById('paramRoofColorText'),  type: 'color' },
    outlineColor: { el: document.getElementById('paramOutlineColor'), textEl: document.getElementById('paramOutlineColorText'),type: 'color' },
    minArea:      { el: document.getElementById('paramMinArea'),      type: 'number' },
    simplify:     { el: document.getElementById('paramSimplify'),     type: 'checkbox' },
    uniformHeight:{ el: document.getElementById('paramUniformHeight'), type: 'checkbox' },
};

// ---- IndexedDB persistence ----

function saveParams() {
    const data = {};
    for (const [key, cfg] of Object.entries(paramEls)) data[key] = cfg.type === 'checkbox' ? cfg.el.checked : cfg.el.value;
    PipelineDB.put('meta', 'params', data).catch(e => console.warn('[idb] Schreibfehler:', e.message));
}

function applyParams(data) {
    for (const [key, cfg] of Object.entries(paramEls)) {
        if (data[key] === undefined) continue;
        if (cfg.type === 'checkbox') cfg.el.checked = !!data[key];
        else cfg.el.value = data[key];
    }
    syncAllDisplays();
    saveParams();
}

async function loadParams() {
    try {
        const data = await PipelineDB.get('meta', 'params');
        if (!data) return;
        applyParams(data);
    } catch(e) { console.warn('[pipeline] Parameter konnten nicht geladen werden:', e.message); }
}

function syncAllDisplays() {
    for (const [, cfg] of Object.entries(paramEls)) {
        if (cfg.type === 'range' && cfg.valEl) cfg.valEl.textContent = cfg.el.value;
        if (cfg.type === 'color' && cfg.textEl) cfg.textEl.textContent = cfg.el.value;
    }
}

function getParams() {
    return {
        tilt: parseInt(paramEls.tilt.el.value, 10),
        rotation: parseInt(paramEls.rotation.el.value, 10),
        extrude: parseFloat(paramEls.extrude.el.value),
        width: parseInt(paramEls.width.el.value, 10),
        height: parseInt(paramEls.height.el.value, 10),
        roofColor: paramEls.roofColor.el.value,
        outlineColor: paramEls.outlineColor.el.value,
        minArea: parseInt(paramEls.minArea.el.value, 10),
        simplify: paramEls.simplify.el.checked,
        uniformHeight: paramEls.uniformHeight.el.checked,
    };
}

// Wire up param change events (debounced for range sliders)
let _saveParamsTimer = null;
function debouncedSaveParams() {
    clearTimeout(_saveParamsTimer);
    _saveParamsTimer = setTimeout(saveParams, 300);
}
for (const [, cfg] of Object.entries(paramEls)) {
    cfg.el.addEventListener(cfg.type === 'checkbox' ? 'change' : 'input', () => {
        if (cfg.type === 'range' && cfg.valEl) cfg.valEl.textContent = cfg.el.value;
        if (cfg.type === 'color' && cfg.textEl) cfg.textEl.textContent = cfg.el.value;
        if (cfg.type === 'range' || cfg.type === 'color') debouncedSaveParams();
        else saveParams();
    });
}

// ---- GeoJSON persistence ----
function saveGeojson(data, name) {
    PipelineDB.put('geojson', 'input', data).catch(e => console.warn('[idb] Schreibfehler:', e.message));
    PipelineDB.put('meta', 'geojson_name', name).catch(e => console.warn('[idb] Schreibfehler:', e.message));
}

async function loadGeojson() {
    try {
        const data = await PipelineDB.get('geojson', 'input');
        if (!data) return;
        geojsonData = data;
        const name = (await PipelineDB.get('meta', 'geojson_name')) || 'gespeichert';
        fileInfo.textContent = name + ' (aus letzter Sitzung)';
        fileInfo.classList.remove('hidden');
        btnRun.disabled = false;
    } catch(e) { console.warn('[pipeline] GeoJSON konnte nicht geladen werden:', e.message); }
}

// ---- Restore cached buildings (enables re-render after reload) ----
async function loadBuildingsCache() {
    try {
        const data = await PipelineDB.get('buildings_cache', 'osm');
        if (!data) return;
        pipeline.buildingsGeojson = data;
        btnRerender.classList.remove('hidden'); btnRerender2.classList.remove('hidden');        document.getElementById('rerenderTip').classList.remove('hidden');
    } catch(e) { console.warn('[pipeline] Gebäude-Cache konnte nicht geladen werden:', e.message); }
}

async function loadResultCache() {
    try {
        const cached = await PipelineDB.get('result', 'latest');
        if (!cached) return;
        // Restore stats
        statBuildings.textContent = cached.buildingCount;
        statResolution.textContent = cached.imageWidth + 'x' + cached.imageHeight;
        statAvgPoints.textContent = cached.avgPoints;
        // Use Blob URL for in-memory display (avoids 33% Base64 overhead)
        const imageBlob = await PipelineDB.get('images', 'rendered_map');
        if (imageBlob) {
            const imageUrl = URL.createObjectURL(imageBlob);
            if (cached.buildingJson) {
                cached.buildingJson.image = cached.buildingJson.image || {};
                cached.buildingJson.image.dataUrl = imageUrl;
            }
        }
        // Recreate canvas from dataUrl for export functions
        if (cached.buildingJson && cached.buildingJson.image && cached.buildingJson.image.dataUrl) {
            const img = new Image();
            img.onload = function() {
                const c = document.createElement('canvas');
                c.width = img.width; c.height = img.height;
                c.getContext('2d').drawImage(img, 0, 0);
                pipeline.canvas = c;
            };
            img.onerror = () => console.warn('[cache] Bild konnte nicht geladen werden');
            img.src = cached.buildingJson.image.dataUrl;
        }
        // Restore pipelineResult (stats only, no buildingJson reference)
        pipelineResult = { buildingCount: cached.buildingCount, imageWidth: cached.imageWidth, imageHeight: cached.imageHeight, avgPoints: cached.avgPoints };
        resultCard.classList.add('visible');
        if (cached.buildingJson) {
            renderViewerPreview(cached.buildingJson);
            // EditorModule becomes single source of truth
            EditorModule.init(cached.buildingJson);
        }
        btnRerender.classList.remove('hidden'); btnRerender2.classList.remove('hidden');
        document.getElementById('rerenderTip').classList.remove('hidden');
    } catch(e) { console.warn('[pipeline] Ergebnis-Cache konnte nicht geladen werden:', e.message); }
}

// ---- File upload ----
uploadZone.addEventListener('click', () => fileInput.click());
uploadZone.addEventListener('dragover', (e) => { e.preventDefault(); uploadZone.classList.add('drag-over'); });
uploadZone.addEventListener('dragleave', () => { uploadZone.classList.remove('drag-over'); });
uploadZone.addEventListener('drop', (e) => { e.preventDefault(); uploadZone.classList.remove('drag-over'); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); });
fileInput.addEventListener('change', () => { if (fileInput.files[0]) handleFile(fileInput.files[0]); });

function handleFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            if (file.name.endsWith('.html') || file.name.endsWith('.htm')) {
                handleHtmlImport(e.target.result, file);
                return;
            }
            const parsed = JSON.parse(e.target.result);
            if (parsed.buildings && Array.isArray(parsed.buildings)) {
                handleMetadataImport(parsed, file);
                return;
            }
            geojsonData = parsed;
            const name = file.name + ' (' + (file.size / 1024).toFixed(1) + ' KB)';
            fileInfo.textContent = name;
            fileInfo.classList.remove('hidden');
            btnRun.disabled = false;
            saveGeojson(geojsonData, file.name);
            PipelineDB.put('meta', 'geojson_source', 'upload').catch(e => console.warn('[idb] Fehler:', e.message));
            showGeojsonOnMap(geojsonData);
        } catch (err) { alert('Fehler beim Lesen der Datei: ' + err.message); }
    };
    reader.readAsText(file);
}

function handleMetadataImport(metadata, file) {
    const buildingsData = EditorModule.getBuildingsData();
    if (!buildingsData || !buildingsData.buildings) {
        alert('Kein Pipeline-Ergebnis vorhanden. Bitte zuerst die Pipeline ausführen oder eine HTML-Datei importieren.');
        return;
    }
    const target = buildingsData.buildings;
    const source = metadata.buildings;
    const used = new Set();
    let merged = 0;
    for (const bTarget of target) {
        if (!bTarget.centroid) continue;
        let bestMatch = null;
        let bestDist = Infinity;
        for (let i = 0; i < source.length; i++) {
            if (used.has(i)) continue;
            const bSrc = source[i];
            if (!bSrc.centroid) continue;
            const d = _haversineMeters(bTarget.centroid, bSrc.centroid);
            if (d < bestDist) { bestDist = d; bestMatch = i; }
        }
        if (bestMatch !== null && bestDist <= MIGRATION_THRESHOLD_M) {
            const src = source[bestMatch];
            used.add(bestMatch);
            bTarget.nummer = sanitizeString(src.nummer, 500);
            bTarget.name = sanitizeString(src.name, 500);
            bTarget.gruppe = sanitizeString(src.gruppe, 500);
            bTarget.beschreibung = sanitizeString(src.beschreibung, 5000);
            bTarget.highlightColor = sanitizeColor(src.highlightColor);
            if (src.polygons) bTarget.polygons = JSON.parse(JSON.stringify(src.polygons));
            if ('disabled' in src) bTarget.disabled = src.disabled;
            merged++;
        }
    }
    // Re-init editor with updated data and persist
    EditorModule.init(buildingsData);
    alert(merged + ' von ' + target.length + ' Gebäuden aktualisiert (' + source.length + ' in Quelldatei).');
}

function handleHtmlImport(text, file) {
    const match = text.match(/window\.__buildingsData\s*=\s*(\{[\s\S]*?\});\s*<\/script>/);
    if (!match) { alert('Keine Gebäudedaten in der HTML-Datei gefunden.'); return; }
    let buildingsData;
    try { buildingsData = JSON.parse(match[1]); } catch(e) { alert('Fehler beim Parsen der Gebäudedaten: ' + e.message); return; }
    if (!buildingsData.image || !buildingsData.image.dataUrl) { alert('Kein eingebettetes Bild in der HTML-Datei gefunden.'); return; }
    if (!buildingsData.image.dataUrl.startsWith('data:image/')) { alert('Ungültige Bilddaten in der HTML-Datei.'); return; }
    const img = new Image();
    img.onload = function() {
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        c.getContext('2d').drawImage(img, 0, 0);
        pipeline.canvas = c;
        pipeline.buildingJson = buildingsData;
        pipeline.buildingsGeojson = null;
        const buildings = buildingsData.buildings || [];
        const totalPoints = buildings.reduce((sum, b) => sum + (b.polygons || [b.polygon]).reduce((s, p) => s + (p ? p.length : 0), 0), 0);
        const result = {
            buildingCount: buildings.length,
            imageWidth: buildingsData.image.width || img.width,
            imageHeight: buildingsData.image.height || img.height,
            avgPoints: buildings.length > 0 ? (totalPoints / buildings.length).toFixed(1) : '0',
            canvas: c,
            buildingJson: buildingsData
        };
        onComplete(result);
        if (buildingsData.sourcePolygon) {
            geojsonData = buildingsData.sourcePolygon;
            showGeojsonOnMap(geojsonData);
            saveGeojson(geojsonData, file.name.replace(/\.html?$/i, '.geojson'));
        }
        if (buildingsData.params) {
            applyParams(buildingsData.params);
        }
        const name = file.name + ' (' + (file.size / 1024).toFixed(1) + ' KB)';
        fileInfo.textContent = name;
        fileInfo.classList.remove('hidden');
    };
    img.onerror = function() { alert('Fehler beim Laden des eingebetteten Bildes.'); };
    img.src = buildingsData.image.dataUrl;
}

// ==========================================================================
// Project list
// ==========================================================================
const projectsGrid = document.getElementById('projectsGrid');
const projectsEmpty = document.getElementById('projectsEmpty');
const tabBtnProjects = document.getElementById('tabBtnProjects');
const projectsBadge = document.getElementById('projectsBadge');
let activeProjectId = null;

function createThumbnail(canvas, maxWidth = 200) {
    return new Promise(resolve => {
        const scale = maxWidth / canvas.width;
        const tc = document.createElement('canvas');
        tc.width = maxWidth;
        tc.height = Math.round(canvas.height * scale);
        tc.getContext('2d').drawImage(canvas, 0, 0, tc.width, tc.height);
        tc.toBlob(blob => resolve(blob), 'image/png');
    });
}

async function saveProject(result) {
    try {
        const sourceCanvas = pipeline.canvas || result.canvas;
        if (!sourceCanvas) return;
        const thumbnail = await createThumbnail(sourceCanvas);
        const imageBlob = await canvasToBlob(sourceCanvas);
        // Prefer EditorModule as source of truth, fall back to result
        const srcData = EditorModule.getBuildingsData() || result.buildingJson;
        const buildingJson = JSON.parse(JSON.stringify(srcData));
        if (buildingJson.image) delete buildingJson.image.dataUrl;
        const geojsonName = (await PipelineDB.get('meta', 'geojson_name')) || 'Unbenannt';
        const geojson = await PipelineDB.get('geojson', 'input');
        const buildingsCache = pipeline.buildingsGeojson || await PipelineDB.get('buildings_cache', 'osm');
        const params = getParams();
        const projectId = Date.now();
        const project = {
            id: projectId,
            name: geojsonName,
            timestamp: projectId,
            buildingCount: result.buildingCount,
            imageWidth: result.imageWidth,
            imageHeight: result.imageHeight,
            avgPoints: result.avgPoints,
            thumbnail,
            imageBlob,
            buildingJson,
            geojson: geojson || null,
            params,
            hasBuildingsCache: !!buildingsCache
        };
        await PipelineDB.put('projects', project.id, project);
        if (buildingsCache) {
            await PipelineDB.put('buildings_cache', 'project_' + projectId, buildingsCache);
        }
        activeProjectId = project.id;
        await renderProjectList();
    } catch(e) { console.warn('[projects] Projekt konnte nicht gespeichert werden:', e); }
}

let _projectThumbUrls = [];
async function renderProjectList() {
    try {
        // Revoke previous blob URLs to prevent memory leaks
        _projectThumbUrls.forEach(u => URL.revokeObjectURL(u));
        _projectThumbUrls = [];
        const projects = await PipelineDB.getAll('projects');
        projects.sort((a, b) => b.timestamp - a.timestamp);
        projectsGrid.innerHTML = '';
        if (projects.length === 0) {
            tabBtnProjects.style.display = 'none';
            projectsEmpty.style.display = 'block';
            return;
        }
        tabBtnProjects.style.display = '';
        projectsBadge.textContent = projects.length;
        projectsEmpty.style.display = 'none';
        for (const p of projects) {
            const item = document.createElement('div');
            item.className = 'project-item' + (p.id === activeProjectId ? ' active' : '');
            const thumbUrl = p.thumbnail ? URL.createObjectURL(p.thumbnail) : '';
            if (thumbUrl) _projectThumbUrls.push(thumbUrl);
            const date = new Date(p.timestamp);
            const dateStr = date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ', ' + date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
            item.innerHTML =
                (thumbUrl ? '<img class="project-thumb" src="' + thumbUrl + '" alt="">' : '<div class="project-thumb"></div>') +
                '<div class="project-meta">' +
                    '<div class="project-name" title="' + escapeHtml(p.name || 'Unbenannt') + '">' + escapeHtml(p.name || 'Unbenannt') + '</div>' +
                    '<div class="project-info">' + p.buildingCount + ' Gebäude &middot; ' + dateStr + '</div>' +
                '</div>' +
                '<button class="project-delete" title="Projekt löschen">&times;</button>';
            item.querySelector('.project-delete').addEventListener('click', (e) => {
                e.stopPropagation();
                if (confirm('Projekt „' + (p.name || 'Unbenannt') + '" löschen?')) deleteProject(p.id);
            });
            item.addEventListener('click', () => loadProject(p));
            projectsGrid.appendChild(item);
        }
    } catch(e) { console.warn('[projects] Projektliste konnte nicht geladen werden:', e); }
}

async function deleteProject(id) {
    try {
        await PipelineDB.remove('projects', id);
        await PipelineDB.remove('buildings_cache', 'project_' + id).catch(e => console.warn('[idb] Fehler:', e.message));
        if (activeProjectId === id) activeProjectId = null;
        await renderProjectList();
    } catch(e) { console.warn('[projects] Projekt konnte nicht gelöscht werden:', e); }
}

async function loadProject(project) {
    try {
        activeProjectId = project.id;
        // Re-fetch full project from IndexedDB (closure may hold stale structured-clone)
        const fullProject = await PipelineDB.get('projects', project.id) || project;
        // Reconstruct buildingJson with dataUrl from Blob (single clone + reuse)
        const bJson = JSON.parse(JSON.stringify(fullProject.buildingJson));
        if (fullProject.imageBlob) {
            const imageUrl = URL.createObjectURL(fullProject.imageBlob);
            bJson.image = bJson.image || {};
            bJson.image.dataUrl = imageUrl;
            bJson.image.width = bJson.image.width || fullProject.imageWidth;
            bJson.image.height = bJson.image.height || fullProject.imageHeight;
        }
        // Restore result cache (reuse stripped clone)
        const cachedBJson = structuredClone(bJson);
        if (cachedBJson.image) delete cachedBJson.image.dataUrl;
        // Batch all IDB writes into a single transaction
        const batchOps = [
            { store: 'result', key: 'latest', value: { buildingCount: fullProject.buildingCount, imageWidth: fullProject.imageWidth, imageHeight: fullProject.imageHeight, avgPoints: fullProject.avgPoints, buildingJson: cachedBJson } },
            { store: 'editor', key: 'buildingsData', value: cachedBJson },
        ];
        if (fullProject.imageBlob) batchOps.push({ store: 'images', key: 'rendered_map', value: fullProject.imageBlob });
        if (fullProject.geojson) {
            batchOps.push({ store: 'geojson', key: 'input', value: fullProject.geojson });
            batchOps.push({ store: 'meta', key: 'geojson_name', value: fullProject.name });
        }
        if (fullProject.params) batchOps.push({ store: 'meta', key: 'params', value: fullProject.params });
        // Resolve buildings cache (may need async fetch)
        const projectCache = fullProject.buildingsCache
            || (fullProject.hasBuildingsCache ? await PipelineDB.get('buildings_cache', 'project_' + fullProject.id) : null);
        if (projectCache) {
            batchOps.push({ store: 'buildings_cache', key: 'osm', value: projectCache });
            pipeline.buildingsGeojson = projectCache;
        }
        await PipelineDB.batch(batchOps);
        // Restore UI state
        if (fullProject.geojson) {
            geojsonData = fullProject.geojson;
            showGeojsonOnMap(fullProject.geojson);
            fileInfo.textContent = fullProject.name;
            fileInfo.classList.remove('hidden');
            btnRun.disabled = false;
        }
        if (fullProject.params) applyParams(fullProject.params);
        // Restore pipeline canvas for export
        if (bJson.image && bJson.image.dataUrl) {
            await new Promise((resolve) => {
                const img = new Image();
                img.onload = function() {
                    const c = document.createElement('canvas');
                    c.width = img.width; c.height = img.height;
                    c.getContext('2d').drawImage(img, 0, 0);
                    pipeline.canvas = c;
                    resolve();
                };
                img.onerror = resolve;
                img.src = bJson.image.dataUrl;
            });
        }
        // Update UI
        statBuildings.textContent = fullProject.buildingCount;
        statResolution.textContent = fullProject.imageWidth + 'x' + fullProject.imageHeight;
        statAvgPoints.textContent = fullProject.avgPoints;
        pipelineResult = { buildingCount: fullProject.buildingCount, imageWidth: fullProject.imageWidth, imageHeight: fullProject.imageHeight, avgPoints: fullProject.avgPoints };
        resultCard.classList.add('visible');
        renderViewerPreview(bJson);
        btnRerender.classList.remove('hidden');
        btnRerender2.classList.remove('hidden');
        document.getElementById('rerenderTip').classList.remove('hidden');
        // Initialize editor with project data
        EditorModule.init(bJson);
        // Update active state in list
        await renderProjectList();
    } catch(e) { console.warn('[projects] Projekt konnte nicht geladen werden:', e); }
}

// ---- Pipeline callbacks ----
function onProgress(step) {
    progressSteps.classList.remove('hidden');
    progressBarWrap.classList.remove('hidden');
    pSteps.forEach((el, i) => { el.classList.remove('active','completed'); if (i+1<step) el.classList.add('completed'); else if (i+1===step) el.classList.add('active'); });
    progressBarFill.style.width = ({1:15,2:50,3:75,4:100}[step]||0) + '%';
    if (step === 4) { pSteps.forEach(el => { el.classList.remove('active'); el.classList.add('completed'); }); progressBarFill.style.background='#3d5a1e'; }
}

function onLog(message) {
    logConsole.classList.add('visible');
    const line = document.createElement('div');
    if (message.includes('[ERROR]')) line.className='log-error'; else if (message.includes('[INFO]')) line.className='log-info'; else if (message.includes('[SUCCESS]')) line.className='log-success';
    line.textContent = message;
    logConsole.appendChild(line);
    logConsole.scrollTop = logConsole.scrollHeight;
}

async function onComplete(result) {
    pipelineResult = { buildingCount: result.buildingCount, imageWidth: result.imageWidth, imageHeight: result.imageHeight, avgPoints: result.avgPoints };
    statBuildings.textContent = result.buildingCount;
    statResolution.textContent = result.imageWidth + 'x' + result.imageHeight;
    statAvgPoints.textContent = result.avgPoints;
    resultCard.classList.add('visible');
    renderViewerPreview(result.buildingJson);
    btnRerender.classList.remove('hidden'); btnRerender2.classList.remove('hidden');
    document.getElementById('rerenderTip').classList.remove('hidden');
    // EditorModule becomes the single source of truth for buildingJson
    EditorModule.init(result.buildingJson);
    pipeline.buildingJson = null;
    openEditorAccordion();
    // Persist result for reload and sync editor cache (awaited before re-enabling buttons)
    try {
        if (pipeline.canvas) {
            const imageBlob = await canvasToBlob(pipeline.canvas);
            await PipelineDB.put('images', 'rendered_map', imageBlob);
        }
        const strippedCopy = JSON.parse(JSON.stringify(result.buildingJson));
        if (strippedCopy.image) delete strippedCopy.image.dataUrl;
        await PipelineDB.put('result', 'latest', { ...pipelineResult, buildingJson: strippedCopy });
        await PipelineDB.put('editor', 'buildingsData', strippedCopy);
        await saveProject(result);
    } catch(e) { console.warn('[pipeline] Ergebnis-Cache konnte nicht gespeichert werden:', e); }
    btnRun.disabled = false;
    btnRerender.disabled = false;
}

function onError(message) { onLog('[ERROR] ' + message); btnRun.disabled = false; btnRerender.disabled = false; }

// ==========================================================================
// Accordion helpers
// ==========================================================================
function toggleAccordion(id) {
    const el = document.getElementById(id);
    el.classList.toggle('collapsed');
    updateUndoRedoVisibility();
}
function openEditorAccordion() {
    document.getElementById('accordionPipeline').classList.add('collapsed');
    const ed = document.getElementById('accordionEditor');
    ed.classList.remove('collapsed');
    updateUndoRedoVisibility();
    requestAnimationFrame(function() { ed.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
}
function updateUndoRedoVisibility() {
    const editorExpanded = !document.getElementById('accordionEditor').classList.contains('collapsed');
    document.getElementById('undoRedoFloat').style.display = editorExpanded ? 'flex' : 'none';
}
function updateEditorBadge(count) {
    const badge = document.getElementById('editorBadge');
    if (count > 0) {
        badge.textContent = count + ' Gebäude';
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
}
function updatePipelineBadge(count) {
    const badge = document.getElementById('pipelineBadge');
    if (count > 0) {
        badge.textContent = count + ' Gebäude';
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
}

// ==========================================================================
// EditorModule — Building Editor (integrated)
// ==========================================================================
/**
 * @namespace EditorModule
 * @description IIFE-encapsulated building editor. Provides sidebar, interactive SVG map,
 * edit form, merge/duplicate/delete, undo/redo, viewer overlay, and IDB persistence.
 * Public API: init(data), bindEvents(), initFromIDB(), isActive(), hasUnsavedChanges(), getBuildingsData()
 */
const EditorModule = (() => {
    // ---- State ----
    let buildingsData = null;
    let currentBuilding = null;
    let hasChanges = false;
    let mergeMode = false;
    let mergeTarget = null;
    let draggedElement = null;
    let draggedBuildingId = null;
    let _mapResizeObserver = null;

    // ---- UndoManager ----
    const UndoManager = (() => {
        const MAX_ENTRIES = 50;
        let undoStack = [];
        let redoStack = [];
        let debounceTimer = null;
        let debounceStateCaptured = false;

        function snapshot() { return structuredClone(buildingsData.buildings); }

        function pushState() {
            undoStack.push(snapshot());
            if (undoStack.length > MAX_ENTRIES) undoStack.shift();
            redoStack = [];
            debounceStateCaptured = false;
            updateButtons();
        }

        function pushStateDebounced() {
            if (!debounceStateCaptured) {
                undoStack.push(snapshot());
                if (undoStack.length > MAX_ENTRIES) undoStack.shift();
                redoStack = [];
                debounceStateCaptured = true;
                updateButtons();
            }
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => { debounceStateCaptured = false; }, 500);
        }

        function undo() {
            if (undoStack.length === 0) return;
            redoStack.push(snapshot());
            buildingsData.buildings = undoStack.pop();
            afterRestore();
        }

        function redo() {
            if (redoStack.length === 0) return;
            undoStack.push(snapshot());
            buildingsData.buildings = redoStack.pop();
            afterRestore();
        }

        function afterRestore() {
            persistToIDB();
            renderMap();
            setTimeout(() => {
                renderSidebar();
                if (currentBuilding) {
                    const still = buildingsData.buildings.find(b => b.id === currentBuilding.id);
                    if (still) { selectBuilding(still); }
                    else {
                        currentBuilding = null;
                        document.getElementById('edEditorContent').innerHTML = '<div class="ed-empty-state"><h3>Gebäude nicht mehr vorhanden</h3><p>Wählen Sie ein Gebäude aus der Liste.</p></div>';
                    }
                }
                updateButtons();
            }, 100);
        }

        function clear() {
            undoStack = []; redoStack = [];
            debounceStateCaptured = false;
            updateButtons();
        }

        function updateButtons() {
            const undoBtn = document.getElementById('undoBtn');
            const redoBtn = document.getElementById('redoBtn');
            if (undoBtn) undoBtn.disabled = undoStack.length === 0;
            if (redoBtn) redoBtn.disabled = redoStack.length === 0;
        }

        return { pushState, pushStateDebounced, undo, redo, clear, updateButtons };
    })();

    // ---- Persist to IDB (debounced) ----
    let _persistTimer = null;
    function persistToIDB() {
        clearTimeout(_persistTimer);
        _persistTimer = setTimeout(() => {
            try {
                const copy = structuredClone(buildingsData);
                if (copy.image) delete copy.image.dataUrl;
                PipelineDB.put('editor', 'buildingsData', copy).catch(e => {
                    console.warn('[editor] IDB-Speicherung fehlgeschlagen:', e.message);
                });
            } catch(e) { console.warn('[editor] IDB-Speicherung fehlgeschlagen:', e.message); }
        }, 1500);
    }

    // ---- Render map ----
    function renderMap() {
        const mapContainer = document.getElementById('edMapContainer');
        if (!buildingsData || !buildingsData.image) {
            mapContainer.innerHTML = '<div class="ed-empty-state"><p>Keine Bilddaten vorhanden</p></div>';
            return;
        }
        const { filename, width, height, dataUrl } = buildingsData.image;

        const container = document.createElement('div');
        container.className = 'ed-image-container';

        const img = document.createElement('img');
        img.src = dataUrl || filename;
        img.alt = (buildingsData.title || 'Gebäudekarte') + ' Karte';
        container.appendChild(img);

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'ed-svg-overlay');
        svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
        svg.setAttribute('preserveAspectRatio', 'xMinYMin meet');

        buildingsData.buildings.forEach(building => {
            const polys = building.polygons || [building.polygon];
            polys.forEach(poly => {
                const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
                const points = poly.map(([x, y]) => (x * width) + ',' + (y * height)).join(' ');
                polygon.setAttribute('points', points);
                polygon.setAttribute('class', 'ed-building-polygon');
                polygon.setAttribute('data-building-id', building.id);
                polygon.addEventListener('mouseenter', () => highlightPolygon(building.id));
                polygon.addEventListener('mouseleave', () => unhighlightPolygon(building.id));
                polygon.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (mergeMode) { handleMergeClick(building); }
                    else { selectBuilding(building); }
                });
                svg.appendChild(polygon);
            });
        });

        container.appendChild(svg);
        mapContainer.innerHTML = '';
        mapContainer.appendChild(container);

        img.addEventListener('load', () => {
            const imgRect = img.getBoundingClientRect();
            svg.style.width = imgRect.width + 'px';
            svg.style.height = imgRect.height + 'px';
        });
        if (_mapResizeObserver) _mapResizeObserver.disconnect();
        _mapResizeObserver = new ResizeObserver(() => {
            const imgRect = img.getBoundingClientRect();
            svg.style.width = imgRect.width + 'px';
            svg.style.height = imgRect.height + 'px';
        });
        _mapResizeObserver.observe(img);
    }

    // ---- Highlight/unhighlight ----
    function highlightPolygon(buildingId) {
        const building = buildingsData.buildings.find(b => b.id === buildingId);
        const hc = building?.highlightColor || '#FFC107';
        const rgb = hexToRgb(hc);
        document.querySelectorAll('.ed-svg-overlay .ed-building-polygon[data-building-id="' + buildingId + '"]').forEach(p => {
            if (!p.classList.contains('selected')) {
                p.style.fill = 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',0.25)';
                p.style.stroke = hc; p.style.strokeWidth = '2';
            }
        });
    }

    function unhighlightPolygon(buildingId) {
        if (currentBuilding && currentBuilding.id === buildingId) return;
        document.querySelectorAll('.ed-svg-overlay .ed-building-polygon[data-building-id="' + buildingId + '"]').forEach(p => {
            if (!p.classList.contains('selected')) {
                p.style.fill = 'rgba(255,193,7,0)';
                p.style.stroke = 'rgba(255,193,7,0)';
                p.style.strokeWidth = '2';
            }
        });
    }

    // ---- Render sidebar ----
    function renderSidebar() {
        const sidebar = document.getElementById('edSidebarContent');
        const groupHierarchy = {};
        const ungroupedBuildings = [];
        const disabledBuildings = [];

        buildingsData.buildings.forEach(building => {
            if (building.disabled) { disabledBuildings.push(building); return; }
            const gruppe = (building.gruppe || '').trim();
            if (!gruppe) { ungroupedBuildings.push(building); return; }
            const parts = gruppe.split(' > ').map(p => p.trim());
            let currentLevel = groupHierarchy;
            parts.forEach((part, index) => {
                if (!currentLevel[part]) currentLevel[part] = { buildings: [], subgroups: {} };
                if (index === parts.length - 1) currentLevel[part].buildings.push(building);
                currentLevel = currentLevel[part].subgroups;
            });
        });

        const sortGroupNames = ViewerWidget.sortGroupNames;
        const getAllBuildingIds = ViewerWidget.getAllGroupIds;

        function createBuildingItem(building, paddingLeft) {
            const item = document.createElement('div');
            item.className = 'building-item';
            item.style.paddingLeft = paddingLeft + 'px';
            item.setAttribute('data-building-id', building.id);
            item.setAttribute('data-search-text', [building.name, building.nummer, building.gruppe].filter(Boolean).join(' ').toLowerCase());
            item.setAttribute('draggable', 'true');
            item.innerHTML = '<span class="drag-handle">\u22EE\u22EE</span><div class="building-info"><div class="building-name">' + escapeHtml(building.name) + '</div><div class="building-id">' + escapeHtml(building.nummer || '') + '</div></div><div class="color-indicator" style="background-color: ' + escapeHtml(building.highlightColor || '#FFC107') + '"></div>';
            item.addEventListener('click', (e) => {
                if (e.target.classList.contains('drag-handle')) return;
                if (mergeMode) { handleMergeClick(building); return; }
                selectBuilding(building);
            });
            item.addEventListener('mouseenter', () => highlightPolygon(building.id));
            item.addEventListener('mouseleave', () => unhighlightPolygon(building.id));
            item.addEventListener('dragstart', handleDragStart);
            item.addEventListener('dragend', handleDragEnd);
            item.addEventListener('dragover', handleDragOver);
            item.addEventListener('drop', handleDrop);
            item.addEventListener('dragleave', handleDragLeave);
            return item;
        }

        function renderGroup(groupName, groupData, level) {
            const group = document.createElement('div');
            group.className = 'ed-group';
            group.style.marginLeft = (level * 15) + 'px';
            const buildingIds = getAllBuildingIds(groupData);
            const header = document.createElement('div');
            header.className = 'ed-group-header';
            header.style.paddingLeft = (20 - level * 5) + 'px';
            header.innerHTML = '<h2>' + escapeHtml(groupName) + '</h2><span class="ed-group-toggle">\u25BC</span>';
            header.addEventListener('click', () => group.classList.toggle('collapsed'));
            header.addEventListener('mouseenter', () => buildingIds.forEach(id => highlightPolygon(id)));
            header.addEventListener('mouseleave', () => buildingIds.forEach(id => unhighlightPolygon(id)));
            group.appendChild(header);
            const content = document.createElement('div');
            content.className = 'ed-group-buildings';
            groupData.buildings.forEach(b => content.appendChild(createBuildingItem(b, 35 + level * 15)));
            sortGroupNames(Object.keys(groupData.subgroups)).forEach(sn => content.appendChild(renderGroup(sn, groupData.subgroups[sn], level + 1)));
            group.appendChild(content);
            return group;
        }

        sidebar.innerHTML = '';
        ungroupedBuildings.forEach(b => sidebar.appendChild(createBuildingItem(b, 20)));
        sortGroupNames(Object.keys(groupHierarchy)).forEach(gn => sidebar.appendChild(renderGroup(gn, groupHierarchy[gn], 0)));

        if (disabledBuildings.length > 0) {
            const hiddenGroup = document.createElement('div');
            hiddenGroup.className = 'ed-group collapsed';
            hiddenGroup.style.opacity = '0.55';
            const hiddenHeader = document.createElement('div');
            hiddenHeader.className = 'ed-group-header';
            hiddenHeader.style.paddingLeft = '20px';
            hiddenHeader.innerHTML = '<h2>Versteckt (' + disabledBuildings.length + ')</h2><span class="ed-group-toggle">\u25BC</span>';
            hiddenHeader.addEventListener('click', () => hiddenGroup.classList.toggle('collapsed'));
            hiddenGroup.appendChild(hiddenHeader);
            const hiddenContent = document.createElement('div');
            hiddenContent.className = 'ed-group-buildings';
            disabledBuildings.forEach(b => hiddenContent.appendChild(createBuildingItem(b, 35)));
            hiddenGroup.appendChild(hiddenContent);
            sidebar.appendChild(hiddenGroup);
        }

        document.getElementById('edSearchInput').value = '';
        // Update sidebar info
        document.getElementById('edSidebarInfo').textContent = buildingsData.buildings.length + ' Gebäude geladen';
        updateEditorBadge(buildingsData.buildings.length);
        updatePipelineBadge(buildingsData.buildings.length);
    }

    // ---- Search filter ----
    function filterSidebar(query) {
        const q = query.toLowerCase().trim();
        const container = document.getElementById('edSidebarContent');
        container.querySelectorAll('.building-item').forEach(it => {
            it.style.display = (!q || it.getAttribute('data-search-text').includes(q)) ? '' : 'none';
        });
        container.querySelectorAll('.ed-group').forEach(g => {
            g.style.display = Array.from(g.querySelectorAll('.building-item')).some(it => it.style.display !== 'none') ? '' : 'none';
        });
    }

    // ---- Select building ----
    function selectBuilding(building) {
        currentBuilding = building;
        document.querySelectorAll('#edSidebarContent .building-item').forEach(item => item.classList.remove('selected'));
        const item = document.querySelector('#edSidebarContent .building-item[data-building-id="' + building.id + '"]');
        if (item) { item.classList.add('selected'); item.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }

        document.querySelectorAll('.ed-svg-overlay .ed-building-polygon').forEach(p => {
            p.classList.remove('selected');
            p.style.fill = 'rgba(255,193,7,0)'; p.style.stroke = 'rgba(255,193,7,0)'; p.style.strokeWidth = '2';
        });
        const existingCircle = document.querySelector('.ed-selection-circle');
        const existingDim = document.querySelector('.ed-dim-overlay');
        const existingMask = document.getElementById('ed-selection-mask');
        if (existingCircle) existingCircle.remove();
        if (existingDim) existingDim.remove();
        if (existingMask) existingMask.remove();

        const mapPolygons = document.querySelectorAll('.ed-svg-overlay .ed-building-polygon[data-building-id="' + building.id + '"]');
        if (mapPolygons.length > 0) {
            const hc = building.highlightColor || '#FFC107';
            const rgb = hexToRgb(hc);
            mapPolygons.forEach(mp => {
                mp.classList.add('selected');
                mp.style.fill = 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',0.35)';
                mp.style.stroke = hc; mp.style.strokeWidth = '3';
            });
        }
        // Add selection circle + dim overlay
        if (mapPolygons.length > 0) {
            const svg = mapPolygons[0].closest('svg');
            const viewBox = svg.getAttribute('viewBox').split(' ');
            const svgWidth = parseFloat(viewBox[2]);
            const svgHeight = parseFloat(viewBox[3]);
            const polys = building.polygons || [building.polygon];
            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            polys.forEach(poly => poly.forEach(([x, y]) => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }));
            const centerX = (minX + maxX) / 2, centerY = (minY + maxY) / 2;
            const bW = maxX - minX, bH = maxY - minY;
            const radius = Math.max(Math.max(bW, bH) / 2 * 1.8, 0.04);

            let defs = svg.querySelector('defs');
            if (!defs) { defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs'); svg.insertBefore(defs, svg.firstChild); }
            const mask = document.createElementNS('http://www.w3.org/2000/svg', 'mask');
            mask.setAttribute('id', 'ed-selection-mask');
            const mr = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            mr.setAttribute('width', svgWidth); mr.setAttribute('height', svgHeight); mr.setAttribute('fill', 'white');
            mask.appendChild(mr);
            const mc = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            mc.setAttribute('cx', centerX * svgWidth); mc.setAttribute('cy', centerY * svgHeight);
            mc.setAttribute('r', radius * Math.max(svgWidth, svgHeight)); mc.setAttribute('fill', 'black');
            mask.appendChild(mc);
            defs.appendChild(mask);
            const dr = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            dr.setAttribute('class', 'ed-dim-overlay');
            dr.setAttribute('width', svgWidth); dr.setAttribute('height', svgHeight);
            dr.setAttribute('mask', 'url(#ed-selection-mask)');
            svg.appendChild(dr);
            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('class', 'ed-selection-circle');
            circle.setAttribute('cx', centerX * svgWidth); circle.setAttribute('cy', centerY * svgHeight);
            circle.setAttribute('r', radius * Math.max(svgWidth, svgHeight));
            svg.appendChild(circle);
        }
        renderEditor();
    }

    // ---- Editor form ----
    function renderEditor() {
        const container = document.getElementById('edEditorContent');
        container.innerHTML =
            '<h2>Gebäude bearbeiten</h2>' +
            '<div class="ed-stats"><div class="ed-stats-row"><span class="ed-stats-label">ID:</span><span class="ed-stats-value">' + currentBuilding.id + '</span></div>' +
            '<div class="ed-stats-row"><span class="ed-stats-label">Polygon-Punkte:</span><span class="ed-stats-value">' + (currentBuilding.polygons || [currentBuilding.polygon]).reduce((s, p) => s + p.length, 0) + (currentBuilding.polygons && currentBuilding.polygons.length > 1 ? ' (' + currentBuilding.polygons.length + ' Polygone)' : '') + '</span></div></div>' +
            '<div class="ed-form-group"><label class="ed-form-label" for="edNummer">Nummer <span class="info-tip" tabindex="0"><span class="info-tip-text">Optionale Gebäudenummer oder -kennzeichnung (z.B. „B3").</span></span></label>' +
            '<div style="display:flex;align-items:center;gap:10px;"><input type="text" id="edNummer" class="ed-form-input" value="' + escapeHtml(currentBuilding.nummer || '') + '" placeholder="z.B. B3" style="width:100px;flex:none;">' +
            '<label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:12px;color:#4b5320;white-space:nowrap;"><input type="checkbox" id="edVisible" ' + (!currentBuilding.disabled ? 'checked' : '') + ' style="width:14px;height:14px;accent-color:#4b5320;cursor:pointer;"> Sichtbar</label></div></div>' +
            '<div class="ed-form-group"><label class="ed-form-label" for="edName">Name <span class="info-tip" tabindex="0"><span class="info-tip-text">Anzeigename des Gebäudes.</span></span></label>' +
            '<input type="text" id="edName" class="ed-form-input" value="' + escapeHtml(currentBuilding.name) + '" placeholder="z.B. Hauptgebäude"></div>' +
            '<div class="ed-form-group"><label class="ed-form-label" for="edGruppe">Gruppe <span class="info-tip" tabindex="0"><span class="info-tip-text">Ordnet das Gebäude einer Kategorie zu. Verschachtelte Gruppen mit &quot; &gt; &quot; trennen.</span></span></label>' +
            '<input type="text" id="edGruppe" class="ed-form-input" value="' + escapeHtml(currentBuilding.gruppe) + '" placeholder="Verwaltung > Hauptgebäude"></div>' +
            '<div class="ed-form-group"><label class="ed-form-label" for="edBeschreibung">Beschreibung <span class="info-tip" tabindex="0"><span class="info-tip-text">Optionaler Freitext. Wird beim Klick auf das Gebäude angezeigt.</span></span></label>' +
            '<textarea id="edBeschreibung" class="ed-form-input" placeholder="Optionale Beschreibung">' + escapeHtml(currentBuilding.beschreibung) + '</textarea></div>' +
            '<div class="ed-form-group"><label class="ed-form-label">Highlight-Farbe <span class="info-tip" tabindex="0"><span class="info-tip-text">Farbe für Hervorhebung beim Überfahren oder Auswählen.</span></span></label>' +
            '<div class="ed-color-picker-group"><div class="ed-color-input-wrapper"><input type="color" id="edColor" value="' + (currentBuilding.highlightColor || '#FFC107') + '"></div>' +
            '<input type="text" id="edColorHex" class="ed-form-input ed-color-hex" value="' + (currentBuilding.highlightColor || '#FFC107') + '" placeholder="#FFC107">' +
            '<button type="button" class="btn btn-sm" id="edRandomColor" title="Zufällige Farbe" style="padding:0;width:40px;height:40px;min-width:40px;font-size:18px;line-height:1;letter-spacing:0;">&#x1f3b2;</button></div></div>' +
            '<div style="margin-top:30px;padding-top:20px;border-top:1px solid #c0bda8;">' +
            '<button class="btn btn-duplicate btn-sm" id="edDuplicate" style="width:100%;margin-bottom:10px;">Gebäude duplizieren</button>' +
            '<span class="info-tip" tabindex="0" style="margin-bottom:10px;"><span class="info-tip-text">Erstellt eine Kopie dieses Gebäudes mit gleichem Polygon.</span></span>' +
            '<button class="btn btn-primary btn-sm" id="edMerge" style="width:100%;margin-bottom:10px;">Zusammenführen</button>' +
            '<span class="info-tip" tabindex="0" style="margin-bottom:10px;"><span class="info-tip-text">Führt ein anderes Gebäude in dieses zusammen (Multi-Polygon).</span></span>' +
            '<button class="btn btn-danger btn-sm" id="edDelete" style="width:100%;">Gebäude löschen</button>' +
            '<span class="info-tip" tabindex="0"><span class="info-tip-text">Entfernt das Gebäude. Kann mit Rückgängig (Strg+Z) wiederhergestellt werden.</span></span></div>';

        // Attach event listeners
        function autoEnable() { document.getElementById('edVisible').checked = true; }
        let saveTimeout = null;
        function debouncedSave() { autoEnable(); clearTimeout(saveTimeout); saveTimeout = setTimeout(saveBuilding, 400); }
        document.getElementById('edNummer').addEventListener('input', debouncedSave);
        document.getElementById('edName').addEventListener('input', debouncedSave);
        document.getElementById('edGruppe').addEventListener('input', debouncedSave);
        document.getElementById('edBeschreibung').addEventListener('input', debouncedSave);
        document.getElementById('edColor').addEventListener('input', (e) => { autoEnable(); document.getElementById('edColorHex').value = e.target.value; saveBuilding(); });
        document.getElementById('edColorHex').addEventListener('input', (e) => {
            autoEnable();
            if (/^#[0-9A-F]{6}$/i.test(e.target.value)) { document.getElementById('edColor').value = e.target.value; saveBuilding(); }
        });
        document.getElementById('edVisible').addEventListener('change', saveBuilding);
        document.getElementById('edRandomColor').addEventListener('click', () => {
            autoEnable();
            const hue = Math.floor(Math.random() * 360);
            const sat = 60 + Math.floor(Math.random() * 30);
            const lum = 45 + Math.floor(Math.random() * 20);
            const s = sat / 100, l = lum / 100;
            const a = s * Math.min(l, 1 - l);
            const f = n => { const k = (n + hue / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
            const toHex = x => Math.round(x * 255).toString(16).padStart(2, '0');
            const color = '#' + toHex(f(0)) + toHex(f(8)) + toHex(f(4));
            document.getElementById('edColor').value = color;
            document.getElementById('edColorHex').value = color;
            saveBuilding();
        });
        document.getElementById('edDuplicate').addEventListener('click', duplicateBuilding);
        document.getElementById('edMerge').addEventListener('click', startMergeMode);
        document.getElementById('edDelete').addEventListener('click', deleteBuilding);
    }

    // ---- Save building ----
    function saveBuilding() {
        const nummer = document.getElementById('edNummer').value.trim();
        const name = document.getElementById('edName').value.trim();
        const gruppe = document.getElementById('edGruppe').value.trim();
        const beschreibung = document.getElementById('edBeschreibung').value.trim();
        const highlightColor = document.getElementById('edColor').value;
        const disabled = !document.getElementById('edVisible').checked;
        const buildingIndex = buildingsData.buildings.findIndex(b => b.id === currentBuilding.id);
        if (buildingIndex !== -1) {
            UndoManager.pushStateDebounced();
            const b = buildingsData.buildings[buildingIndex];
            const oldGruppe = b.gruppe, oldDisabled = b.disabled, oldColor = b.highlightColor;
            b.nummer = sanitizeString(nummer, 500); b.name = sanitizeString(name, 500); b.gruppe = sanitizeString(gruppe, 500);
            b.beschreibung = sanitizeString(beschreibung, 5000); b.highlightColor = sanitizeColor(highlightColor); b.disabled = disabled;
            currentBuilding = b;
            hasChanges = true;
            persistToIDB();
            if (oldGruppe !== gruppe || oldDisabled !== disabled) {
                renderSidebar();
                const it = document.querySelector('#edSidebarContent .building-item[data-building-id="' + currentBuilding.id + '"]');
                if (it) it.classList.add('selected');
            } else {
                updateSidebarItemInPlace(b);
                if (oldColor !== highlightColor) updateMapPolygonStyle(b);
            }
        }
    }

    function updateSidebarItemInPlace(building) {
        const item = document.querySelector('#edSidebarContent .building-item[data-building-id="' + building.id + '"]');
        if (!item) return;
        const nameEl = item.querySelector('.building-name');
        if (nameEl) nameEl.textContent = building.name;
        const idEl = item.querySelector('.building-id');
        if (idEl) idEl.textContent = building.nummer || '';
        const colorEl = item.querySelector('.color-indicator');
        if (colorEl) colorEl.style.backgroundColor = building.highlightColor || '#FFC107';
        item.setAttribute('data-search-text', [building.name, building.nummer, building.gruppe].filter(Boolean).join(' ').toLowerCase());
    }

    function updateMapPolygonStyle(building) {
        const hc = building.highlightColor || '#FFC107';
        const rgb = hexToRgb(hc);
        document.querySelectorAll('.ed-svg-overlay .ed-building-polygon[data-building-id="' + building.id + '"]').forEach(p => {
            if (p.classList.contains('selected')) {
                p.style.fill = 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',0.35)';
                p.style.stroke = hc;
            }
        });
    }

    // ---- Merge mode ----
    function startMergeMode() {
        if (!currentBuilding) return;
        if (mergeMode) { cancelMergeMode(); return; }
        mergeMode = true; mergeTarget = currentBuilding;
        document.body.style.cursor = 'crosshair';
        const btn = document.getElementById('edMerge');
        if (btn) { btn.textContent = 'Abbrechen'; btn.classList.remove('btn-primary'); btn.classList.add('btn-danger'); }
        const hint = document.createElement('div');
        hint.id = 'ed-merge-hint';
        hint.className = 'ed-info-message';
        hint.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:500;background:#fff;box-shadow:0 4px 12px rgba(0,0,0,0.2);';
        hint.innerHTML = '<strong>Zusammenführen:</strong> Klicke auf das Gebäude, das zu \u201E' + escapeHtml(mergeTarget.name) + '\u201C hinzugefügt werden soll. <em>ESC</em> zum Abbrechen.';
        document.body.appendChild(hint);
    }

    function cancelMergeMode() {
        mergeMode = false; mergeTarget = null;
        document.body.style.cursor = '';
        const hint = document.getElementById('ed-merge-hint');
        if (hint) hint.remove();
        const btn = document.getElementById('edMerge');
        if (btn) { btn.textContent = 'Zusammenführen'; btn.classList.remove('btn-danger'); btn.classList.add('btn-primary'); }
    }

    function handleMergeClick(source) {
        if (!mergeTarget || source.id === mergeTarget.id) return;
        UndoManager.pushState();
        const targetPolys = mergeTarget.polygons || [mergeTarget.polygon];
        const sourcePolys = source.polygons || [source.polygon];
        mergeTarget.polygons = targetPolys.concat(sourcePolys);
        mergeTarget.polygon = mergeTarget.polygons[0];
        const sourceIndex = buildingsData.buildings.findIndex(b => b.id === source.id);
        if (sourceIndex !== -1) buildingsData.buildings.splice(sourceIndex, 1);
        hasChanges = true; persistToIDB();
        const target = mergeTarget;
        cancelMergeMode();
        renderMap();
        requestAnimationFrame(() => { renderSidebar(); selectBuilding(target); });
    }

    // ---- Duplicate ----
    function duplicateBuilding() {
        if (!currentBuilding) return;
        const buildingIndex = buildingsData.buildings.findIndex(b => b.id === currentBuilding.id);
        if (buildingIndex === -1) return;
        const maxId = buildingsData.buildings.reduce((max, b) => {
            const match = b.id.match(/building_(\d+)/);
            return match ? Math.max(max, parseInt(match[1])) : max;
        }, 0);
        const duplicate = {
            id: 'building_' + (maxId + 1),
            nummer: currentBuilding.nummer || '',
            name: currentBuilding.name + ' (Kopie)',
            gruppe: currentBuilding.gruppe,
            beschreibung: currentBuilding.beschreibung,
            highlightColor: currentBuilding.highlightColor,
            polygon: JSON.parse(JSON.stringify(currentBuilding.polygon)),
            ...(currentBuilding.polygons ? { polygons: JSON.parse(JSON.stringify(currentBuilding.polygons)) } : {})
        };
        UndoManager.pushState();
        buildingsData.buildings.splice(buildingIndex + 1, 0, duplicate);
        hasChanges = true; persistToIDB();
        renderMap();
        requestAnimationFrame(() => { renderSidebar(); selectBuilding(duplicate); });
    }

    // ---- Delete ----
    function deleteBuilding() {
        if (!currentBuilding) return;
        if (!confirm('Möchten Sie das Gebäude "' + currentBuilding.name + '" (' + currentBuilding.id + ') wirklich löschen?')) return;
        const idx = buildingsData.buildings.findIndex(b => b.id === currentBuilding.id);
        if (idx !== -1) {
            UndoManager.pushState();
            buildingsData.buildings.splice(idx, 1);
            hasChanges = true; persistToIDB();
            currentBuilding = null;
            renderMap();
            setTimeout(() => {
                renderSidebar();
                document.getElementById('edEditorContent').innerHTML = '<div class="ed-empty-state"><h3>Gebäude gelöscht</h3><p>Wählen Sie ein anderes Gebäude aus der Liste.</p></div>';
            }, 100);
        }
    }

    // ---- Drag and Drop ----
    function handleDragStart(e) {
        draggedElement = e.currentTarget;
        draggedBuildingId = draggedElement.getAttribute('data-building-id');
        draggedElement.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/html', draggedElement.innerHTML);
    }
    function handleDragEnd(e) {
        e.currentTarget.classList.remove('dragging');
        document.querySelectorAll('#edSidebarContent .building-item').forEach(it => it.classList.remove('drag-over'));
    }
    function handleDragOver(e) {
        e.preventDefault(); e.dataTransfer.dropEffect = 'move';
        if (e.currentTarget !== draggedElement) e.currentTarget.classList.add('drag-over');
        return false;
    }
    function handleDrop(e) {
        e.stopPropagation(); e.preventDefault();
        const dropBuildingId = e.currentTarget.getAttribute('data-building-id');
        if (draggedBuildingId === dropBuildingId) return false;
        const draggedIndex = buildingsData.buildings.findIndex(b => b.id === draggedBuildingId);
        const dropIndex = buildingsData.buildings.findIndex(b => b.id === dropBuildingId);
        if (draggedIndex !== -1 && dropIndex !== -1) {
            UndoManager.pushState();
            const [db] = buildingsData.buildings.splice(draggedIndex, 1);
            buildingsData.buildings.splice(draggedIndex < dropIndex ? dropIndex - 1 : dropIndex, 0, db);
            hasChanges = true; persistToIDB();
            renderSidebar();
            if (currentBuilding) {
                const it = document.querySelector('#edSidebarContent .building-item[data-building-id="' + currentBuilding.id + '"]');
                if (it) it.classList.add('selected');
            }
        }
        return false;
    }
    function handleDragLeave(e) { e.currentTarget.classList.remove('drag-over'); }

    // ---- Download JSON ----
    function saveJSONToFile() {
        const blob = new Blob([JSON.stringify(buildingsData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'gebaeude_polygone.json'; a.click();
        URL.revokeObjectURL(url);
        hasChanges = false;
    }

    // ---- Viewer overlay (uses ViewerWidget) ----
    let voWidget = null;

    function renderViewerOverlay() {
        voWidget = ViewerWidget.create({
            prefix: 'vo',
            highlightOpacity: 0.35,
            highlightStroke: 3,
            selectionStroke: 4,
            aspectRatio: 'xMidYMid meet',
            modalGap: 20,
            modalMargin: 15,
            filterDisabled: true,
            imageContainerId: 'voImageContainer',
            getBuildingsData: () => buildingsData,
            onBuildingClick: (b) => voWidget.showPopup(b),
            sidebarHeaderRenderer: (bd) => '<h3>' + escapeHtml(bd.title || 'Gebäudekarte') + '</h3><p>Interaktive Vorschau</p>',
        });
        voWidget.renderSidebar(document.getElementById('voSidebar'), buildingsData);
        voWidget.renderMap(document.getElementById('voImageContainer'), buildingsData);
    }

    function showViewerOverlay() {
        renderViewerOverlay();
        document.getElementById('viewerOverlay').classList.add('active');
    }
    function hideViewerOverlay() {
        if (voWidget) voWidget.hidePopup();
        document.getElementById('viewerOverlay').classList.remove('active');
    }

    // ---- Public API ----
    /**
     * Initialize the editor with building data. Deep-clones the input.
     * @param {Object} [data] - Building JSON data (if null, uses existing state)
     */
    function init(data) {
        if (data) {
            buildingsData = structuredClone(data);
        }
        if (!buildingsData) return;
        currentBuilding = null;
        hasChanges = false;
        UndoManager.clear();
        renderMap();
        requestAnimationFrame(() => { renderSidebar(); });
    }

    /** Bind all editor event listeners. Call once after DOM is ready. */
    function bindEvents() {
        document.getElementById('edSaveBtn').addEventListener('click', saveJSONToFile);
        document.getElementById('edPreviewBtn').addEventListener('click', () => { if (buildingsData) showViewerOverlay(); });
        document.getElementById('voCloseBtn').addEventListener('click', hideViewerOverlay);
        document.getElementById('undoBtn').addEventListener('click', () => UndoManager.undo());
        document.getElementById('redoBtn').addEventListener('click', () => UndoManager.redo());
        document.getElementById('edSearchInput').addEventListener('input', function() { filterSidebar(this.value); });

        // Keyboard: Escape priority: merge > viewer popup > viewer overlay
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && mergeMode) { cancelMergeMode(); e.stopPropagation(); return; }
            if (e.key === 'Escape' && document.getElementById('viewerOverlay').classList.contains('active')) {
                if (voWidget && voWidget.getSelectedId()) { voWidget.hidePopup(); } else { hideViewerOverlay(); }
                e.stopPropagation();
            }
        });

        // Click outside in viewer overlay
        document.addEventListener('click', (e) => {
            if (!document.getElementById('viewerOverlay').classList.contains('active')) return;
            if (e.target.id === 'viewerOverlay') { hideViewerOverlay(); return; }
            if (e.target.closest('.vo-building-polygon') || e.target.closest('.vo-building-item') || e.target.closest('.vo-sidebar') || e.target.closest('.vo-modal-content')) return;
            if (e.target.closest('.vo-dialog') && voWidget) voWidget.hidePopup();
        });

        // Undo/redo keyboard
        document.addEventListener('keydown', (e) => {
            // Only intercept when editor is active
            if (document.getElementById('accordionEditor').classList.contains('collapsed')) return;
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
                if (!e.ctrlKey && !e.metaKey) return;
            }
            if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); UndoManager.undo(); }
            else if ((e.ctrlKey || e.metaKey) && (e.key === 'Z' || e.key === 'y')) { e.preventDefault(); UndoManager.redo(); }
        });

        // Warn before leaving if unsaved changes
        window.addEventListener('beforeunload', (e) => {
            if (hasChanges) { e.preventDefault(); e.returnValue = ''; }
        });
    }

    /** Restore editor state from IndexedDB (used on page reload). */
    async function initFromIDB() {
        try {
            const editorData = await PipelineDB.get('editor', 'buildingsData');
            if (editorData) {
                buildingsData = editorData;
                const imageBlob = await PipelineDB.get('images', 'rendered_map');
                if (imageBlob) {
                    buildingsData.image = buildingsData.image || {};
                    buildingsData.image.dataUrl = URL.createObjectURL(imageBlob);
                }
                UndoManager.clear();
                renderMap();
                requestAnimationFrame(() => { renderSidebar(); });
            }
        } catch(e) { console.warn('[editor] Konnte Editor-Daten nicht aus IDB laden:', e.message); }
    }

    return {
        init,
        bindEvents,
        initFromIDB,
        isActive() { return !document.getElementById('accordionEditor').classList.contains('collapsed'); },
        hasUnsavedChanges() { return hasChanges; },
        getBuildingsData() { return buildingsData; }
    };
})();

// Async init flow
(async function initApp() {
    await PipelineDB.open();
    await migrateFromLocalStorage();
    await loadParams();
    await loadGeojson();
    pipeline = new Pipeline({ onProgress, onLog, onComplete, onError });
    EditorModule.bindEvents();
    await loadBuildingsCache();
    await loadResultCache();
    await renderProjectList();
    await restoreMapState();
})();

// ---- Run buttons ----
btnRun.addEventListener('click', () => { if (!geojsonData) return; resetUI(); btnRun.disabled=true; btnRerender.disabled=true; saveParams(); pipeline.run(geojsonData, getParams()); });
btnRerender.addEventListener('click', () => { if (!geojsonData) return; resetUI(); btnRun.disabled=true; btnRerender.disabled=true; saveParams(); onLog('[INFO] Verwende gecachte Gebäudedaten, starte Neurendering...'); pipeline.rerender(geojsonData, getParams()); });
btnRerender2.addEventListener('click', () => { btnRerender.click(); });

function resetUI() {
    resultCard.classList.remove('visible'); logConsole.innerHTML=''; logConsole.classList.remove('visible');
    progressSteps.classList.add('hidden'); progressBarWrap.classList.add('hidden');
    progressBarFill.style.width='0%'; progressBarFill.style.background='';
    pSteps.forEach(el => el.classList.remove('active','completed'));
}

// ---- Export buttons ----
btnEditor.addEventListener('click', () => { if (!pipelineResult) return; openEditorAccordion(); });
btnStandalone.addEventListener('click', () => { if (pipeline) pipeline.exportStandalone(geojsonData, getParams()); });
btnDownloadGeojson.addEventListener('click', () => { if (pipeline) pipeline.exportGeojson(); });
btnDownloadImage.addEventListener('click', () => { if (pipeline) pipeline.exportImage(); });
btnReset.addEventListener('click', () => {
    geojsonData=null; pipelineResult=null;
    pipeline = new Pipeline({ onProgress, onLog, onComplete, onError });
    fileInfo.classList.add('hidden'); fileInput.value=''; btnRun.disabled=true; btnRerender.classList.add('hidden'); btnRerender2.classList.add('hidden');    PipelineDB.clearAll().catch(e => console.warn('[idb] Fehler:', e.message));
    clearDrawnPolygon();
    uploadedLayer.clearLayers();
    resetUI();
    // Reset editor
    document.getElementById('edMapContainer').innerHTML = '<div class="ed-empty-state"><p>Noch keine Kartendaten vorhanden.</p></div>';
    document.getElementById('edSidebarContent').innerHTML = '<div class="ed-empty-state"><p>Führen Sie zuerst die Pipeline aus, um Gebäude zu laden.</p></div>';
    document.getElementById('edEditorContent').innerHTML = '<div class="ed-empty-state"><h3>Kein Gebäude ausgewählt</h3><p>Wählen Sie ein Gebäude aus der Liste oder klicken Sie auf ein Gebäude in der Karte.</p></div>';
    document.getElementById('accordionEditor').classList.add('collapsed');
    updateEditorBadge(0); updatePipelineBadge(0);
    updateUndoRedoVisibility();
});

// ==========================================================================
// Tab switching
// ==========================================================================
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(btn.dataset.tab).classList.add('active');
        if (btn.dataset.tab === 'tabDraw') drawMap.invalidateSize();
    });
});

// ==========================================================================
// Leaflet draw map
// ==========================================================================

const drawInfo = document.getElementById('drawInfo');
const btnClearPolygon = document.getElementById('btnClearPolygon');
const btnDownloadPolygon = document.getElementById('btnDownloadPolygon');

const drawMap = L.map('drawMap').setView([51.1, 10.4], 6);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19
}).addTo(drawMap);

const drawnItems = new L.FeatureGroup();
drawMap.addLayer(drawnItems);

// Layer for displaying uploaded GeoJSON on the map
const uploadedLayer = new L.FeatureGroup();
drawMap.addLayer(uploadedLayer);

function showGeojsonOnMap(data) {
    uploadedLayer.clearLayers();
    drawnItems.clearLayers();
    drawInfo.classList.add('hidden');
    btnClearPolygon.classList.add('hidden');
    btnDownloadPolygon.classList.add('hidden');
    try {
        const layer = L.geoJSON(data, {
            style: { color: '#6b7530', weight: 2, fillColor: '#6b7530', fillOpacity: 0.15 }
        });
        uploadedLayer.addLayer(layer);
        const bounds = uploadedLayer.getBounds();
        if (bounds.isValid()) {
            drawMap.fitBounds(bounds.pad(0.2));
        }
        // Switch to map tab to show the result
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        document.querySelector('[data-tab="tabDraw"]').classList.add('active');
        document.getElementById('tabDraw').classList.add('active');
        setTimeout(() => drawMap.invalidateSize(), 50);
    } catch(e) {
        console.warn('[map] Konnte GeoJSON nicht anzeigen:', e.message);
    }
}

const drawControl = new L.Control.Draw({
    draw: {
        polygon: { shapeOptions: { color: '#6b7530', weight: 2 } },
        polyline: false,
        rectangle: false,
        circle: false,
        circlemarker: false,
        marker: false
    },
    edit: { featureGroup: drawnItems }
});
drawMap.addControl(drawControl);

function setGeojsonFromDrawnLayer(layer) {
    const latlngs = layer.getLatLngs()[0];
    const coords = latlngs.map(ll => [ll.lng, ll.lat]);
    // Close the ring
    coords.push([coords[0][0], coords[0][1]]);
    geojsonData = { type: 'Polygon', coordinates: [coords] };
    btnRun.disabled = false;
    drawInfo.textContent = 'Polygon mit ' + latlngs.length + ' Punkten gezeichnet';
    drawInfo.classList.remove('hidden');
    btnClearPolygon.classList.remove('hidden');
    btnDownloadPolygon.classList.remove('hidden');
    saveGeojson(geojsonData, 'Gezeichnetes Polygon');
    PipelineDB.put('meta', 'geojson_source', 'drawn').catch(e => console.warn('[idb] Fehler:', e.message));
}

drawMap.on(L.Draw.Event.CREATED, function(e) {
    drawnItems.clearLayers();
    uploadedLayer.clearLayers();
    drawnItems.addLayer(e.layer);
    setGeojsonFromDrawnLayer(e.layer);
});

drawMap.on(L.Draw.Event.EDITED, function() {
    const layers = drawnItems.getLayers();
    if (layers.length > 0) setGeojsonFromDrawnLayer(layers[0]);
});

drawMap.on(L.Draw.Event.DELETED, function() {
    clearDrawnPolygon();
});

function clearDrawnPolygon() {
    drawnItems.clearLayers();
    drawInfo.classList.add('hidden');
    btnClearPolygon.classList.add('hidden');
    btnDownloadPolygon.classList.add('hidden');
    // Only clear geojsonData if it came from the map
    PipelineDB.get('meta', 'geojson_source').then(source => {
        if (source === 'drawn') {
            geojsonData = null;
            btnRun.disabled = true;
            PipelineDB.remove('geojson', 'input').catch(e => console.warn('[idb] Fehler:', e.message));
            PipelineDB.remove('meta', 'geojson_name').catch(e => console.warn('[idb] Fehler:', e.message));
            PipelineDB.remove('meta', 'geojson_source').catch(e => console.warn('[idb] Fehler:', e.message));
        }
    }).catch(e => console.warn('[idb] Fehler:', e.message));
}

btnClearPolygon.addEventListener('click', () => {
    clearDrawnPolygon();
});

btnDownloadPolygon.addEventListener('click', () => {
    if (!geojsonData) return;
    _triggerDownload(new Blob([JSON.stringify(geojsonData, null, 2)], {type: 'application/geo+json'}), 'polygon.geojson');
});

// Restore GeoJSON on map from IDB on load
async function restoreMapState() {
    try {
        const source = await PipelineDB.get('meta', 'geojson_source');
        const data = await PipelineDB.get('geojson', 'input');
        if (!data) return;

        if (source === 'drawn') {
            if (!data || !data.coordinates || !data.coordinates[0]) return;
            const coords = data.coordinates[0];
            const latlngs = coords.slice(0, -1).map(c => L.latLng(c[1], c[0]));
            if (latlngs.length < 3) return;
            const polygon = L.polygon(latlngs, { color: '#6b7530', weight: 2 });
            drawnItems.addLayer(polygon);
            drawMap.fitBounds(polygon.getBounds().pad(0.2));
            drawInfo.textContent = 'Polygon mit ' + latlngs.length + ' Punkten (wiederhergestellt)';
            drawInfo.classList.remove('hidden');
            btnClearPolygon.classList.remove('hidden');
            btnDownloadPolygon.classList.remove('hidden');
        } else if (source === 'upload') {
            const layer = L.geoJSON(data, {
                style: { color: '#6b7530', weight: 2, fillColor: '#6b7530', fillOpacity: 0.15 }
            });
            uploadedLayer.addLayer(layer);
            const bounds = uploadedLayer.getBounds();
            if (bounds.isValid()) drawMap.fitBounds(bounds.pad(0.2));
        }
    } catch(e) { console.warn('[map] Kartenstatus konnte nicht wiederhergestellt werden:', e.message); }
}
