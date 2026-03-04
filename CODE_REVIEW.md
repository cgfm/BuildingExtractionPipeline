# Comprehensive Code Review Report

**Date:** 2026-03-03
**Scope:** `index.html`, `editor.html`, `js/`, `css/`, exported viewer templates

---

## Changes Applied (2026-03-03)

### Critical — Security (all XSS vectors closed)

| ID | Issue | Fix Applied |
|----|-------|-------------|
| SEC-1 | `beschreibung` injected via `innerHTML` in 3 viewer contexts | Changed all 3 locations to use `textContent` instead of `innerHTML` |
| SEC-2 | `JSON.stringify` output could contain `</script>` in exported HTML | Added `.replace(/<\//g, '<\\/')` after `JSON.stringify` in `createStandaloneHtml()` |
| SEC-3 | `name`, `gruppe`, `title` injected via `innerHTML` in sidebar rendering | Applied `escapeHtml()` to all user-derived strings in `innerHTML` across both files (12+ locations) |
| SEC-4 | `</textarea>` breakout in editor form template literal | Applied `escapeHtml()` to all interpolated values in the `renderEditor()` template (`nummer`, `name`, `gruppe`, `beschreibung`) |
| SEC-7 | `error.message` injected via `innerHTML` | Changed to `textContent` via `createElement`/`appendChild` in both `editor.html` init and standalone viewer template |

**New utility functions added:**
- `escapeHtml(s)` — added to both `index.html` and `editor.html` (replaces `&`, `<`, `>`, `"`, `'`)
- `esc(s)` — compact version added inside the standalone viewer template (`_getViewerTemplate()`)

### Critical — Performance

| ID | Issue | Status |
|----|-------|--------|
| PERF-1 | Full DOM rebuild on every keystroke | **Not fixed** — requires major refactoring to decouple field edits from `renderMap()`/`renderSidebar()` |

### High Priority

| ID | Issue | Fix Applied |
|----|-------|-------------|
| PERF-2 | ResizeObserver never disconnected | Added `_mapResizeObserver` module variable; `.disconnect()` called before creating new observer in `renderMap()` |
| PERF-3 | 3 deep clones in `onComplete()`, 2 in `loadProject()` | Reduced to 1 clone + `structuredClone()` reuse in both functions |
| MAP-1 | No OSM attribution on rendered canvas | Added "© OpenStreetMap contributors" text drawn in bottom-right corner of canvas after tile compositing, with semi-transparent background |
| MAP-2 | Equirectangular vs. Mercator projection mismatch | Added `_latToMercY()` helper; rewrote `lonLatToPixel()` to use Mercator Y projection; updated tile crop math in `_drawMapBackground()` to use Mercator for latitude calculations |

| ID | Issue | Status |
|----|-------|--------|
| PERF-4 | `canvas.toDataURL()` blocks main thread | **Not fixed** — requires API changes to pipeline flow |
| PERF-5 | Entire buildingsCache stored per project | **Not fixed** — requires IndexedDB schema migration |
| ARCH-1 | Stale `js/` and `css/` directories | **Not fixed** — requires user decision on deletion vs. archival |
| ARCH-2 | Massive code duplication between files | **Not fixed** — major refactoring to extract shared modules |

### Medium Priority

| ID | Issue | Fix Applied |
|----|-------|-------------|
| SEC-5 | Missing SRI on CDN scripts | Added `integrity="sha384-..."` and `crossorigin="anonymous"` to all 4 Leaflet resources in `index.html` |
| SEC-6 | No Content Security Policy | Added `<meta http-equiv="Content-Security-Policy">` to both `index.html` and `editor.html` with appropriate directives |
| PERF-6 | Blob URLs never revoked in project list | Added `_projectThumbUrls` array; all URLs revoked via `URL.revokeObjectURL()` at start of `renderProjectList()` |
| PERF-7 | Undo stack uses `JSON.parse(JSON.stringify(...))` | Changed `snapshot()` and `persistToIDB()` to use `structuredClone()` |
| MAP-3 | Incomplete Leaflet attribution | Changed to `'© <a href="...">OpenStreetMap</a> contributors'` |
| MAP-4 | Inner rings (holes) discarded for relations | Added collection of `role === 'inner'` members; included as additional coordinate arrays in GeoJSON Polygon |
| MAP-5 | MultiPolygon only renders first polygon | Added `extractAllCoordinates()` method; rewrote `renderBuilding()` to iterate all coordinate rings, accumulating pixels and centroids across all parts |
| CODE-1 | `handleDrop` index calculation bug | Fixed ternary from `dropIndex : dropIndex` to `dropIndex - 1 : dropIndex` |
| CODE-2 | `dataUrlToBlob` no input validation | Added guards for missing comma, missing MIME match; throws descriptive errors |
| CODE-3 | `PipelineDB.clearAll()` divergence | Editor's `clearAll()` now filters out `projects` store, matching `index.html` behavior |
| ARCH-4 | Silent empty catch blocks | Added `console.warn()` with descriptive messages to all 5 empty catch blocks in `index.html` and 1 in editor |

| ID | Issue | Status |
|----|-------|--------|
| PERF-8 | Individual IndexedDB transactions per `put()` | **Not fixed** — would need new `putMulti()` API method |
| MAP-6 | Building height not scaled to geographic extent | **Not fixed** — design decision needed on height scaling behavior |
| ARCH-3 | No data/view separation | **Not fixed** — major architectural refactoring |
| ARCH-5 | Fragile `setTimeout(100)` for render sync | **Not fixed** — needs Promise-based `renderMap()` |

### Low Priority

| ID | Issue | Fix Applied |
|----|-------|-------------|
| Hardcoded title | `editor.html` title was "Gebäude Editor - Albkaserne" | Changed to generic "Gebäude Editor" |
| Hardcoded alt text | `img.alt` was "Albkaserne Karte" | Changed to `(buildingsData.title \|\| 'Gebäudekarte') + ' Karte'` |
| Empty CSS rule | `.building-polygon:hover` had empty body | Removed the empty rule |
| Empty export row | `<div class="export-row"></div>` leftover | Removed the empty div |
| Redundant Overpass suffix | `>;\nout skel qt;` after `out geom;` | Removed — `out geom` already includes full geometry |
| Canvas memory | Intermediate tile composite canvas not freed | Added `comp.width = 0; comp.height = 0;` after use |
| Null guard | `buildingsData.image` destructured without check | Added guard in `renderMap()` with error state fallback |

| ID | Issue | Status |
|----|-------|--------|
| No IndexedDB fallback | App fails if IDB unavailable | **Not fixed** |
| `var` in tooltip code | Inconsistent with `const`/`let` | **Not fixed** |
| Mixed template literals / concatenation | Style inconsistency | **Not fixed** |
| Magic numbers | Tooltip/spotlight constants | **Not fixed** |
| Tile URLs hardcoded | Not configurable | **Not fixed** |
| Overpass endpoint hardcoded | Not configurable | **Not fixed** |
| No tile request throttling | 64 tiles in parallel | **Not fixed** |
| Painter's sort ignores rotation | Only sorts by latitude | **Not fixed** |
| No winding order enforcement | GeoJSON RFC compliance | **Not fixed** |
| Search input not debounced | Full DOM traversal per keystroke | **Not fixed** |
| `max-height` CSS transition | Expensive layout recalc | **Not fixed** |

---

## Summary

| Priority | Total | Fixed | Remaining |
|----------|-------|-------|-----------|
| **Critical** | 5 | 4 | 1 (PERF-1) |
| **High** | 8 | 4 | 4 (PERF-4/5, ARCH-1/2) |
| **Medium** | 15 | 11 | 4 (PERF-8, MAP-6, ARCH-3/5) |
| **Low** | 15 | 7 | 8 |
| **Total** | **43** | **26** | **17** |

### Remaining high-impact work

1. **PERF-1: Decouple text field edits from full DOM rebuilds** — The editor rebuilds the entire SVG map and sidebar on every keystroke (400ms debounce). For text-only changes, only the affected sidebar item and polygon attributes should update. This is the single biggest remaining performance issue.

2. **ARCH-1/2: Extract shared code** — ~800–1000 lines of viewer/sidebar/highlight/popup logic are duplicated across `index.html` and `editor.html`. Extracting into shared `.js` files would dramatically improve maintainability.

3. **ARCH-3: Introduce state management** — Global mutable variables with no encapsulation make the code fragile. A minimal store pattern would make state changes predictable and testable.

---

## Original Findings (reference)

The sections below preserve the original findings for context.

### SEC-1: Stored XSS via `beschreibung` field — exploitable in exported HTML
**Files:** `index.html:1976`, `index.html:1780`, `editor.html:2242`
`building.beschreibung` is injected into the DOM via `innerHTML` without sanitization. A description like `<img src=x onerror=alert(1)>` executes JavaScript in every viewer — including shared exported HTML files.

### SEC-2: Script context escape in exported HTML via `JSON.stringify`
**File:** `index.html:1797`
If any building field contains `</script>`, it breaks out of the script tag in the exported file.

### SEC-3: XSS via `building.name`, `gruppe`, `title` in innerHTML
**Files:** `editor.html:1462-1466`, `editor.html:1501`, `editor.html:2240`, `index.html:2060`, `index.html:2050`, `index.html:2011`
Building names, group names, and titles are injected into `innerHTML` throughout all sidebar/viewer rendering.

### SEC-4: `</textarea>` breakout in editor form
**File:** `editor.html:1756`
A description containing `</textarea><script>alert(1)</script>` escapes the textarea.

### PERF-1: Full DOM rebuild on every keystroke (editor)
**File:** `editor.html:1852-1886`
`saveBuilding()` triggers `renderMap()` + `renderSidebar()` on every debounced keystroke.

### PERF-2: ResizeObserver never disconnected
**File:** `editor.html:1352-1357`
Every `renderMap()` call creates a new `ResizeObserver` without disconnecting the previous one.

### PERF-3: Multiple deep clones of buildingJson on completion
**File:** `index.html:2615-2637`
`onComplete()` creates 3 separate `JSON.parse(JSON.stringify(...))` deep clones back-to-back.

### PERF-4: `canvas.toDataURL()` blocks main thread
**File:** `index.html:1845`
Synchronous PNG encoding of a 2000×1150 canvas blocks for 100–500ms.

### PERF-5: Entire buildingsCache stored per project
**File:** `index.html:2438-2455`
Each saved project includes the full OSM GeoJSON (500KB–2MB).

### MAP-1: No OSM attribution on rendered canvas/exported PNG
**File:** `index.html:1585-1611`
The `_drawMapBackground()` composites OSM tiles without any attribution text.

### MAP-2: Equirectangular vs. Mercator projection mismatch
**File:** `index.html:1491-1493`
`lonLatToPixel()` uses equirectangular projection but OSM tiles use Web Mercator.

### ARCH-1: Stale js/ and css/ directories
**Files:** `js/*.js`, `css/styles.css`
Earlier modular version that has diverged significantly from the runtime code.

### ARCH-2: Massive code duplication between files
**Files:** `index.html` + `editor.html`
`PipelineDB`, blob helpers, tooltip, `hexToRgb` (4×), viewer sidebar (4×), popup/spotlight (4×), search filtering (4×), viewer CSS (3×).

### SEC-5: Missing Subresource Integrity on CDN scripts
**File:** `index.html:7-10`
Leaflet loaded from unpkg.com without `integrity` or `crossorigin` attributes.

### SEC-6: No Content Security Policy
**Files:** `index.html`, `editor.html`
No CSP meta tag.

### SEC-7: Error messages in innerHTML
**Files:** `editor.html:1283`, `index.html:1774`
`error.message` injected via innerHTML.

### PERF-6: Blob URLs never revoked in project list
**File:** `index.html:2474-2493`
`URL.createObjectURL()` called for thumbnails but never revoked.

### PERF-7: Undo stack deep-clones entire buildings array
**File:** `editor.html:1153-1234`
`JSON.parse(JSON.stringify(buildingsData.buildings))` on every state change.

### PERF-8: Individual IndexedDB transactions per put()
**File:** `index.html:1250-1256`
Each `PipelineDB.put()` opens a separate transaction.

### MAP-3: Incomplete Leaflet attribution
**File:** `index.html:2704`
Attribution reads `'© OpenStreetMap'` instead of `'© OpenStreetMap contributors'` with link.

### MAP-4: Inner rings (holes) discarded for building relations
**File:** `index.html:1443-1449`
Only `role === 'outer'` members are processed.

### MAP-5: MultiPolygon only renders first polygon
**File:** `index.html:1551`
`extractCoordinates()` returns only `coordinates[0][0]` for MultiPolygon features.

### MAP-6: Building height not scaled to geographic extent
**File:** `index.html:1527-1529`
Height in meters used directly as pixel offset regardless of zoom level.

### ARCH-3: No data/view separation
**Files:** `index.html:2120-2840`, `editor.html:1132-2442`
Global mutable state freely mutated from anywhere.

### ARCH-4: Silent empty catch blocks
**Files:** `index.html:2186,2235,2245,2838`, `editor.html:1868`
Multiple `catch(e) {}` blocks silently swallow errors.

### ARCH-5: Fragile `setTimeout(100)` for render synchronization
**File:** `editor.html:1277,1877,1953,1999,2031`
Used 6 times to delay sidebar rendering after map rendering.

### CODE-1: `handleDrop` index calculation bug
**File:** `editor.html:2106`
Ternary always evaluates to `dropIndex` regardless of condition.

### CODE-2: `dataUrlToBlob` no input validation
**File:** `index.html:1287-1294`
`header.match(/:(.*?);/)[1]` throws `TypeError` on malformed data URLs.

### CODE-3: `PipelineDB.clearAll()` divergence
**Files:** `editor.html:1080-1087` vs `index.html:1266-1274`
Editor version clears ALL stores including `projects`.
