# Construction Guide: Serverless Building Map (Pure HTML/JS)

Rebuild the entire Building Extraction Pipeline as a **static site** that runs directly from GitHub Pages (or any file server) — no Python, no Docker, no backend.

---

## What the Current Project Does

1. User uploads a **GeoJSON polygon** defining an area of interest
2. Backend queries the **Overpass API** (OpenStreetMap) to download building footprints
3. Backend **renders a 2.5D isometric image** (PNG) with extruded building walls/roofs
4. Backend **extracts clickable polygon coordinates** from the rendered geometry
5. Result: an **interactive map** (HTML) with hover/click on buildings, a sidebar menu, and a metadata editor

The new version must do all of this **in the browser**.

---

## Architecture Overview

```
index.html              — Single entry point (pipeline UI + viewer + editor)
  or split into:
  index.html            — Pipeline UI: upload GeoJSON, configure, run
  viewer.html           — Interactive map viewer (read-only)
  editor.html           — Building metadata editor

js/
  pipeline.js           — Orchestrates the full pipeline
  overpass.js           — Downloads buildings from OSM via Overpass API
  renderer.js           — 2.5D isometric rendering to <canvas>
  polygon-extractor.js  — Extracts clickable polygon outlines from rendered geometry
  viewer.js             — Interactive map with SVG overlays
  editor.js             — Metadata editing (name, group, description, color)
  export.js             — Standalone HTML export + JSON download

css/
  styles.css            — All styles (or inline in each HTML)
```

No build tools, no bundler, no npm. Just `<script type="module">` imports.

---

## File-by-File Specification

### 1. `overpass.js` — Building Downloader

Replaces `download_buildings.py` (316 lines).

**Input:** GeoJSON object (parsed from uploaded file) containing a Polygon geometry.

**Core logic:**

```js
async function downloadBuildings(geojsonPolygon) {
    // 1. Extract coordinates from the GeoJSON
    //    Support FeatureCollection, Feature, or bare Polygon geometry
    //    Use first feature's geometry, first ring only (no holes)
    const coords = extractPolygonCoords(geojsonPolygon);
    // coords = [[lon, lat], [lon, lat], ...]

    // 2. Build Overpass QL query
    //    Convert to "lat lon lat lon ..." format (Overpass uses lat-first)
    const polyStr = coords.map(([lon, lat]) => `${lat} ${lon}`).join(' ');
    const query = `
        [out:json][timeout:60];
        (
          way["building"](poly:"${polyStr}");
          relation["building"](poly:"${polyStr}");
        );
        out geom;
        >;
        out skel qt;
    `;

    // 3. POST to Overpass API
    const response = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        body: 'data=' + encodeURIComponent(query),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    const data = await response.json();

    // 4. Convert OSM elements to GeoJSON FeatureCollection
    return osmToGeojson(data);
}
```

**OSM-to-GeoJSON conversion (`osmToGeojson`):**

- Iterate `data.elements`
- Only process elements where `type === 'way'` or `type === 'relation'`
- For **ways**: extract `element.geometry` array → `[{lon, lat}, ...]` → `[[lon, lat], ...]`
  - Close the ring if first coord !== last coord
  - Create `{ type: 'Polygon', coordinates: [ring] }`
- For **relations**: find members with `role === 'outer'` that have `geometry`
  - Single outer → Polygon
  - Multiple outers → MultiPolygon
- Extract `element.tags` as properties, add `osm_id` and `osm_type`
- Return `{ type: 'FeatureCollection', features: [...] }`

**CORS note:** The Overpass API at `https://overpass-api.de/api/interpreter` supports CORS. No proxy needed.

---

### 2. `renderer.js` — 2.5D Isometric Renderer

Replaces `render_buildings_25d.py` (872 lines). This is the most complex module.

**Input:**
- `buildingsGeojson` — FeatureCollection from step 1
- `boundingPolygon` — original user polygon coords `[[lon, lat], ...]`
- Parameters: `{ tilt, rotation, extrude, width, height, roofColor, outlineColor, simplify, minArea }`

**Output:**
- A rendered `<canvas>` element (the 2.5D image)
- An array of building polygon data (clickable regions, normalized 0–1 coords)

**Core algorithm:**

```js
class Building25DRenderer {
    constructor(buildingsGeojson, boundingPolygon, params) {
        this.features = buildingsGeojson.features;
        this.boundingPolygon = boundingPolygon;
        this.params = params; // { tilt, rotation, extrude, width, height, roofColor, outlineColor, simplify, minArea }
        this.buildingPolygons = []; // collected during render for export
    }

    render() {
        // 1. Calculate geographic bounds
        this.calculateBounds();

        // 2. Create canvas
        const canvas = document.createElement('canvas');
        canvas.width = this.params.width;
        canvas.height = this.params.height;
        const ctx = canvas.getContext('2d');

        // 3. Draw map background (solid color or optional tile layer)
        ctx.fillStyle = '#f0f0f0';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        // Optional: load OSM tiles as background (see Map Tiles section below)

        // 4. Calculate isometric offsets
        const tiltRad = this.params.tilt * Math.PI / 180;
        const rotRad = this.params.rotation * Math.PI / 180;
        const isoOffsetX = -Math.sin(rotRad) * 1.5;
        const isoOffsetY = 2.5 + Math.sin(tiltRad) * 1.5;

        // 5. Sort buildings north-to-south for correct overlap
        const sorted = this.sortByLatitude();

        // 6. Render each building
        this.buildingPolygons = [];
        sorted.forEach((feature, idx) => {
            this.renderBuilding(ctx, feature, isoOffsetX, isoOffsetY, idx + 1);
        });

        return canvas;
    }
}
```

**Geographic coordinate conversion:**

```js
// Convert lon/lat to pixel coordinates within the canvas
lonLatToPixel(lon, lat) {
    const xNorm = (lon - this.minLon) / (this.maxLon - this.minLon);
    const yNorm = (this.maxLat - lat) / (this.maxLat - this.minLat); // Y inverted
    return [
        Math.round(xNorm * this.params.width),
        Math.round(yNorm * this.params.height)
    ];
}
```

**Bounding box calculation:**

```js
calculateBounds() {
    const allCoords = [];

    // Collect all coords from buildings
    this.features.forEach(f => {
        const coords = this.extractCoordinates(f.geometry);
        allCoords.push(...coords);
    });

    // Include bounding polygon
    if (this.boundingPolygon) {
        allCoords.push(...this.boundingPolygon);
    }

    const lons = allCoords.map(c => c[0]);
    const lats = allCoords.map(c => c[1]);

    // Add 8% padding on all sides
    const lonSpan = Math.max(...lons) - Math.min(...lons);
    const latSpan = Math.max(...lats) - Math.min(...lats);
    const pad = 0.08;

    this.minLon = Math.min(...lons) - lonSpan * pad;
    this.maxLon = Math.max(...lons) + lonSpan * pad;
    this.minLat = Math.min(...lats) - latSpan * pad;
    this.maxLat = Math.max(...lats) + latSpan * pad;
}
```

**Building area filter (Shoelace formula in meters):**

```js
calculateBuildingArea(coords) {
    // Convert to local meters first
    const meterCoords = coords.map(([lon, lat]) => this.lonLatToMeters(lon, lat));

    let area = 0;
    for (let i = 0; i < meterCoords.length; i++) {
        const j = (i + 1) % meterCoords.length;
        area += meterCoords[i][0] * meterCoords[j][1];
        area -= meterCoords[j][0] * meterCoords[i][1];
    }
    return Math.abs(area) / 2;
}

lonLatToMeters(lon, lat) {
    const R = 6378137.0;
    const refLon = (this.minLon + this.maxLon) / 2;
    const refLat = (this.minLat + this.maxLat) / 2;
    const x = R * (lon - refLon) * Math.PI / 180 * Math.cos(refLat * Math.PI / 180);
    const y = R * (lat - refLat) * Math.PI / 180;
    return [x, y];
}
```

**Building height extraction from OSM tags:**

```js
getBuildingHeight(properties) {
    if (properties.height) {
        const h = parseFloat(String(properties.height).replace('m', ''));
        if (!isNaN(h)) return h;
    }
    if (properties['building:levels']) {
        const levels = parseInt(properties['building:levels']);
        if (!isNaN(levels)) return levels * 3.0; // 3m per level
    }
    return this.params.extrude; // default height
}
```

**Rendering a single building on canvas:**

```js
renderBuilding(ctx, feature, isoOffsetX, isoOffsetY, index) {
    const coords = this.extractCoordinates(feature.geometry);
    if (coords.length < 3) return;

    // Filter by area
    if (this.params.minArea > 0) {
        if (this.calculateBuildingArea(coords) < this.params.minArea) return;
    }

    const height = this.getBuildingHeight(feature.properties || {});

    // Ground-level pixel coords
    const ground = coords.map(([lon, lat]) => this.lonLatToPixel(lon, lat));

    // Roof-level pixel coords (shifted by isometric offset * height)
    const roof = ground.map(([x, y]) => [
        x + Math.round(height * isoOffsetX),
        y - Math.round(height * isoOffsetY)
    ]);

    // Colors
    const roofRgb = this.params.roofColor || '#cccccc';
    const outlineRgb = this.params.outlineColor || '#333333';
    const wallRgb = this.darkenColor(roofRgb, 0.7);

    // Draw walls (connect ground[i] -> ground[i+1] -> roof[i+1] -> roof[i])
    for (let i = 0; i < ground.length - 1; i++) {
        ctx.beginPath();
        ctx.moveTo(ground[i][0], ground[i][1]);
        ctx.lineTo(ground[i + 1][0], ground[i + 1][1]);
        ctx.lineTo(roof[i + 1][0], roof[i + 1][1]);
        ctx.lineTo(roof[i][0], roof[i][1]);
        ctx.closePath();
        ctx.fillStyle = wallRgb;
        ctx.strokeStyle = outlineRgb;
        ctx.lineWidth = 1;
        ctx.fill();
        ctx.stroke();
    }

    // Draw roof
    ctx.beginPath();
    ctx.moveTo(roof[0][0], roof[0][1]);
    for (let i = 1; i < roof.length; i++) {
        ctx.lineTo(roof[i][0], roof[i][1]);
    }
    ctx.closePath();
    ctx.fillStyle = roofRgb;
    ctx.strokeStyle = outlineRgb;
    ctx.lineWidth = 1;
    ctx.fill();
    ctx.stroke();

    // Collect clickable polygon (union of ground + roof, optionally convex hull)
    const allPoints = [...ground, ...roof];
    const polygon = this.params.simplify
        ? this.convexHull(allPoints)
        : allPoints;

    // Normalize to 0–1 range
    const normalized = polygon.map(([x, y]) => [
        Math.round(x / this.params.width * 10000) / 10000,
        Math.round(y / this.params.height * 10000) / 10000
    ]);

    this.buildingPolygons.push({
        index,
        polygon: normalized,
        properties: feature.properties || {}
    });
}
```

**Convex hull (Graham scan or Andrew's monotone chain):**

```js
convexHull(points) {
    // Andrew's monotone chain algorithm
    points = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (points.length <= 2) return points;

    const cross = (O, A, B) =>
        (A[0] - O[0]) * (B[1] - O[1]) - (A[1] - O[1]) * (B[0] - O[0]);

    const lower = [];
    for (const p of points) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
            lower.pop();
        lower.push(p);
    }

    const upper = [];
    for (const p of points.reverse()) {
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
            upper.pop();
        upper.push(p);
    }

    upper.pop();
    lower.pop();
    return lower.concat(upper);
}
```

**Color utilities:**

```js
darkenColor(hex, factor) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgb(${Math.round(r * factor)}, ${Math.round(g * factor)}, ${Math.round(b * factor)})`;
}
```

**Map tile background (optional, for visual context):**

The Python version downloads OSM tiles as a background image. In JS this is possible but you must respect OSM's tile usage policy and handle CORS. A simpler approach:

- Option A: Use a solid light-gray background (works offline, no tile requests)
- Option B: Load tiles via `<img>` elements drawn onto canvas — but OSM tiles require a `User-Agent` header which browsers can't set in `fetch` for CORS tile requests. Use a tile CDN that allows browser access, e.g.:
  ```
  https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png
  ```
  These DO work in `<img>` tags (no CORS issues for rendering onto canvas IF the server sets `Access-Control-Allow-Origin`). If not, use option A.

**Recommendation:** Start with option A (solid background). It keeps the project truly serverless and offline-capable.

---

### 3. `polygon-extractor.js` — Export Building Polygons

This is already handled within `renderer.js` above (the `buildingPolygons` array collected during rendering). After rendering, format the output:

```js
function createBuildingJson(canvas, buildingPolygons, imageFilename) {
    const colorPalette = [
        '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8',
        '#F7DC6F', '#BB8FCE', '#85C1E2', '#F8B739', '#52B788',
        '#E63946', '#F77F00', '#06D6A0', '#118AB2', '#073B4C',
        '#FFB703', '#FB8500', '#8338EC', '#3A86FF', '#FF006E'
    ];

    const buildings = buildingPolygons.map((poly) => ({
        id: `building_${poly.index}`,
        name: `Gebäude ${poly.index}`,
        gruppe: 'Unbekannt',
        beschreibung: '',
        highlightColor: colorPalette[(poly.index - 1) % colorPalette.length],
        polygon: poly.polygon
    }));

    return {
        image: {
            filename: imageFilename,
            width: canvas.width,
            height: canvas.height
        },
        buildings
    };
}
```

---

### 4. `viewer.js` — Interactive Map Viewer

Port of the current `index.html` (788 lines). This is already pure HTML/JS and works without a server — it just needs `gebaeude_polygone.json` and the image file served alongside it.

**Key features to preserve:**

- **Sidebar** with nested, collapsible groups (parsed from `gruppe` field using ` > ` separator)
- **SVG overlay** on top of the image with `<polygon>` elements
- **Hover highlight**: fill polygon with building's `highlightColor` at 35% opacity
- **Click popup**: dimmed background with mask, selection circle, positioned modal
- **Keyboard**: Escape closes popup
- **Group hover**: hovering a group header highlights all buildings in that group

**Data flow:**
1. Load `gebaeude_polygone.json` (or receive it from the pipeline in-memory)
2. Create `<img>` with `src` = image filename (or canvas `toDataURL()`)
3. Create `<svg>` overlay with `viewBox="0 0 {width} {height}"`
4. For each building, create `<polygon>` with points = normalized coords × image dimensions

**The existing `index.html` is already self-contained** — it just needs `fetch('gebaeude_polygone.json')` to work. For the new project, you can either:
- Keep loading from a file (works on any static server including GitHub Pages)
- Pass the data in-memory from the pipeline (for the integrated version)

---

### 5. `editor.js` — Building Metadata Editor

Port of the current `editor.html` (1206 lines). Also already pure HTML/JS.

**Key features to preserve:**

- **Click to select** building (on map or sidebar)
- **Edit fields**: name, gruppe (group path), beschreibung (description), highlightColor
- **Color picker** synced with hex text input
- **Drag & drop** reordering in sidebar
- **Duplicate / Delete** buildings
- **Save**: download as JSON file (replace server POST with `Blob` + `<a download>`)
- **Unsaved changes** warning via `beforeunload`

**Key change from server version:**

Replace the server-save function:
```js
// OLD (server)
await fetch('/api/save-json', { method: 'POST', body: JSON.stringify(data) });

// NEW (client download)
function downloadJson(data, filename = 'gebaeude_polygone.json') {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}
```

---

### 6. `export.js` — Standalone HTML Export

Creates a single self-contained HTML file with embedded image (base64) and JSON data.

```js
function createStandaloneHtml(viewerHtmlTemplate, buildingsData, canvasElement) {
    // 1. Convert canvas to base64 PNG
    const imageDataUrl = canvasElement.toDataURL('image/png');

    // 2. Inline the JSON data into the template
    //    Replace fetch('gebaeude_polygone.json') with inline data
    let html = viewerHtmlTemplate;
    html = html.replace(
        "const response = await fetch('gebaeude_polygone.json');",
        "const response = { ok: true };"
    );
    html = html.replace(
        "buildingsData = await response.json();",
        `buildingsData = ${JSON.stringify(buildingsData)};`
    );
    html = html.replace(
        "img.src = filename;",
        `img.src = "${imageDataUrl}";`
    );

    return html;
}

function downloadHtml(htmlContent, filename = 'building-map.html') {
    const blob = new Blob([htmlContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}
```

---

### 7. Pipeline UI (`index.html`)

Port of current `main.html` (968 lines). Replace all `fetch('/api/...')` calls with direct JS function calls.

**Flow:**

```
Upload GeoJSON file (drag & drop or file picker)
  → Parse JSON in browser (FileReader + JSON.parse)
  → User configures parameters (tilt, rotation, height, colors, etc.)
  → Click "Start Pipeline"
     → Step 1: downloadBuildings(geojson) — fetches from Overpass API
     → Step 2: renderer.render() — draws 2.5D on <canvas>
     → Step 3: createBuildingJson() — extracts polygon data
  → Show results:
     → Preview image (canvas)
     → Stats (building count, image size, avg polygon points)
     → Buttons: "Open Viewer", "Open Editor", "Download Standalone HTML", "Download JSON"
```

**Parameter persistence:** Use `localStorage` (same as current implementation).

**Progress tracking:** Since everything runs in the browser, use callbacks or async/await with UI updates between steps. No polling needed (unlike the server version which polled `/api/pipeline-status`).

```js
async function runPipeline(geojsonData, params) {
    updateProgress(1, 'Downloading buildings from OpenStreetMap...');

    const buildingsGeojson = await downloadBuildings(geojsonData);
    const buildingCount = buildingsGeojson.features.length;
    addLog(`Found ${buildingCount} buildings`);

    updateProgress(2, 'Rendering 2.5D view...');

    const polygon = extractPolygonCoords(geojsonData);
    const renderer = new Building25DRenderer(buildingsGeojson, polygon, params);
    const canvas = renderer.render();
    addLog(`Rendered ${renderer.buildingPolygons.length} buildings`);

    updateProgress(3, 'Extracting polygons...');

    const buildingJson = createBuildingJson(canvas, renderer.buildingPolygons, 'rendered.png');
    addLog(`Extracted ${buildingJson.buildings.length} clickable polygons`);

    updateProgress(4, 'Complete!');

    return { canvas, buildingJson };
}
```

---

## Data Format Reference

### Input: GeoJSON polygon (uploaded by user)

```json
{
  "type": "FeatureCollection",
  "features": [{
    "type": "Feature",
    "properties": {},
    "geometry": {
      "type": "Polygon",
      "coordinates": [[[9.069, 48.140], [9.068, 48.140], ...]]
    }
  }]
}
```

### Intermediate: Buildings GeoJSON (from Overpass)

```json
{
  "type": "FeatureCollection",
  "features": [{
    "type": "Feature",
    "geometry": { "type": "Polygon", "coordinates": [[[lon, lat], ...]] },
    "properties": {
      "building": "yes",
      "building:levels": "3",
      "height": "12",
      "osm_id": 123456,
      "osm_type": "way"
    }
  }]
}
```

### Output: gebaeude_polygone.json

```json
{
  "image": {
    "filename": "rendered.png",
    "width": 2000,
    "height": 1150
  },
  "buildings": [
    {
      "id": "building_1",
      "name": "Gebäude 1",
      "gruppe": "Unbekannt",
      "beschreibung": "",
      "highlightColor": "#FF6B6B",
      "polygon": [[0.543, 0.862], [0.538, 0.886], ...]
    }
  ]
}
```

- Polygon coordinates are **normalized to 0–1** relative to image width/height
- `gruppe` supports nested groups via ` > ` separator (e.g. `"Verwaltung > Hauptgebäude"`)

---

## Rendering Parameters

| Parameter | Type | Default | Range | Description |
|-----------|------|---------|-------|-------------|
| tilt | float | 45 | 0–90 | Camera tilt (0=top-down, 90=horizontal) |
| rotation | float | 0 | 0–360 | Viewing direction (0=North, 90=East) |
| extrude | float | 10 | 1–50 | Default building height in meters |
| width | int | 2000 | 800–4000 | Output image width in pixels |
| height | int | 1150 | 600–3000 | Output image height in pixels |
| roofColor | string | #cccccc | — | Hex color for building roofs |
| outlineColor | string | #333333 | — | Hex color for building outlines |
| simplify | bool | true | — | Use convex hull for clickable polygons |
| minArea | float | 25 | 0–1000 | Min building footprint area in m² |

---

## Key Differences from Server Version

| Aspect | Server (Python/Flask) | Serverless (JS) |
|--------|----------------------|-----------------|
| Overpass query | Python `requests` | Browser `fetch()` (CORS OK) |
| 2.5D rendering | PIL + OpenCV on server | `<canvas>` 2D context |
| Polygon simplification | `cv2.convexHull()` (numpy) | JS convex hull (Andrew's algorithm) |
| Image output | PNG file on disk | Canvas `toDataURL()` or `toBlob()` |
| Save JSON | POST to Flask API | `Blob` + `<a download>` |
| Progress tracking | Polling `/api/pipeline-status` | Direct async/await with UI updates |
| Standalone export | Server builds HTML | JS inlines base64 image + JSON |
| Hosting | Docker container | GitHub Pages / any static host |
| Re-render | Server keeps `buildings.geojson` | Keep in JS variable / localStorage |

---

## GitHub Pages Deployment

```
my-repo/
├── index.html
├── viewer.html
├── editor.html
├── js/
│   ├── overpass.js
│   ├── renderer.js
│   ├── viewer.js
│   ├── editor.js
│   └── export.js
├── css/
│   └── styles.css
└── sample/                    # Optional sample data
    ├── albkaserne.geojson
    └── gebaeude_polygone.json
```

Enable GitHub Pages in repo settings → Source: main branch, root folder. The site will be live at `https://<user>.github.io/<repo>/`.

---

## Implementation Order

1. **`overpass.js`** — Test standalone: upload GeoJSON, get FeatureCollection back. Verify building count matches the Python version.
2. **`renderer.js`** — Hardest part. Start with top-down (tilt=0) flat rendering, then add isometric extrusion. Compare output visually with the Python version.
3. **`viewer.html`** — Copy existing `index.html` almost verbatim. Only change: accept in-memory data instead of fetching a file.
4. **`editor.html`** — Copy existing `editor.html`. Replace server save with download.
5. **`index.html`** (pipeline UI) — Wire everything together. Replace server API calls with direct JS calls.
6. **`export.js`** — Standalone HTML generation.
7. **Polish** — Progress UI, error handling, localStorage for re-render, mobile responsiveness.

---

## Sample Test Data

Use this GeoJSON polygon (Albkaserne area) to test the pipeline:

```json
{"type":"FeatureCollection","features":[{"type":"Feature","properties":{},"geometry":{"coordinates":[[[9.069897,48.140709],[9.068870,48.140788],[9.067288,48.136381],[9.060102,48.134223],[9.059978,48.132733],[9.059369,48.130588],[9.057479,48.130277],[9.056668,48.129647],[9.057042,48.128966],[9.060300,48.127629],[9.064525,48.126453],[9.064608,48.125143],[9.067754,48.124324],[9.069156,48.125158],[9.071956,48.125725],[9.072858,48.127544],[9.075487,48.127674],[9.075843,48.128132],[9.078842,48.128714],[9.077578,48.135058],[9.073054,48.140114],[9.069897,48.140709]]],"type":"Polygon"}}]}
```

Expected result: ~100+ buildings, matching the existing `gebaeude_polygone.json`.

---

## Edge Cases & Gotchas

- **Overpass rate limiting**: The API may return 429 if queried too often. Implement retry with exponential backoff (wait 5s, 10s, 20s).
- **Large polygons**: Very large areas may timeout on Overpass (60s limit). Consider warning the user if the polygon bbox exceeds ~5km².
- **MultiPolygon buildings**: Some OSM buildings are relations with multiple outer ways. Handle both Polygon and MultiPolygon geometry types.
- **Canvas size limits**: Browsers limit canvas size (usually 16384×16384 or based on GPU memory). Stay within 4000×3000 max.
- **Base64 image size**: For standalone export, large images produce huge base64 strings. Consider using JPEG for the data URL to reduce file size (canvas.toDataURL('image/jpeg', 0.85)).
- **Re-render without re-download**: Store the downloaded `buildingsGeojson` in a JS variable so the user can adjust rendering parameters without re-querying Overpass.
