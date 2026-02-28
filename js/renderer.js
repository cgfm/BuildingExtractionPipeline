/**
 * renderer.js — Pure ES module for 2.5D isometric rendering of buildings on HTML canvas.
 *
 * Replaces the original 872-line Python rendering backend with a client-side
 * implementation that produces identical visual output.
 */

const EARTH_RADIUS = 6378137;

export class Building25DRenderer {
  /**
   * @param {Object} buildingsGeojson  — GeoJSON FeatureCollection (e.g. from Overpass)
   * @param {Array}  boundingPolygon   — User-drawn polygon coords [[lon, lat], ...]
   * @param {Object} params            — Rendering parameters (all optional)
   */
  constructor(buildingsGeojson, boundingPolygon, params = {}) {
    this.buildingsGeojson = buildingsGeojson;
    this.boundingPolygon = boundingPolygon;

    // Merge supplied params with defaults
    const defaults = {
      tilt: 45,
      rotation: 0,
      extrude: 4,
      width: 2000,
      height: 1150,
      roofColor: '#cccccc',
      outlineColor: '#333333',
      simplify: true,
      minArea: 25,
    };
    const merged = { ...defaults, ...params };

    this.tilt = merged.tilt;
    this.rotation = merged.rotation;
    this.extrude = merged.extrude;
    this.width = merged.width;
    this.height = merged.height;
    this.roofColor = merged.roofColor;
    this.outlineColor = merged.outlineColor;
    this.simplify = merged.simplify;
    this.minArea = merged.minArea;

    // Populated during render()
    this.buildingPolygons = [];

    // Geographic bounds — set by calculateBounds()
    this.minLon = 0;
    this.maxLon = 0;
    this.minLat = 0;
    this.maxLat = 0;
    this.refLon = 0;
    this.refLat = 0;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Render the full 2.5D scene and return the resulting <canvas> element.
   * Downloads OSM map tiles as background, then draws buildings on top.
   * @returns {Promise<HTMLCanvasElement>}
   */
  async render() {
    this.buildingPolygons = [];
    this.calculateBounds();

    const canvas = document.createElement('canvas');
    canvas.width = this.width;
    canvas.height = this.height;
    const ctx = canvas.getContext('2d');

    // Background: try map tiles, fall back to solid color
    ctx.fillStyle = '#f0f0f0';
    ctx.fillRect(0, 0, this.width, this.height);
    try {
      await this._drawMapBackground(ctx);
    } catch (e) {
      console.warn('[renderer] Map tile download failed, using solid background:', e.message);
    }

    // Isometric projection offsets
    const rotRad = (this.rotation * Math.PI) / 180;
    const tiltRad = (this.tilt * Math.PI) / 180;
    const isoOffsetX = -Math.sin(rotRad) * 1.5;
    const isoOffsetY = 2.5 + Math.sin(tiltRad) * 1.5;

    // Sort buildings north-to-south (descending centroid latitude) so that
    // southern buildings are drawn on top of northern ones.
    const features = [...(this.buildingsGeojson.features || [])];
    features.sort((a, b) => {
      const centA = this._centroidLat(a);
      const centB = this._centroidLat(b);
      return centB - centA; // descending latitude
    });

    // Render each building
    features.forEach((feature, index) => {
      this.renderBuilding(ctx, feature, isoOffsetX, isoOffsetY, index);
    });

    return canvas;
  }

  // ---------------------------------------------------------------------------
  // Coordinate conversion
  // ---------------------------------------------------------------------------

  /**
   * Convert a lon/lat pair to pixel coordinates on the canvas.
   * @param {number} lon
   * @param {number} lat
   * @returns {[number, number]} [x, y]
   */
  lonLatToPixel(lon, lat) {
    const xNorm = (lon - this.minLon) / (this.maxLon - this.minLon);
    const yNorm = (this.maxLat - lat) / (this.maxLat - this.minLat); // Y inverted
    return [Math.round(xNorm * this.width), Math.round(yNorm * this.height)];
  }

  // ---------------------------------------------------------------------------
  // Bounds
  // ---------------------------------------------------------------------------

  /**
   * Collect all coordinates from the GeoJSON features and the bounding polygon,
   * then set the geographic extent with 8 % padding on each side.
   */
  calculateBounds() {
    const lons = [];
    const lats = [];

    // Bounding polygon
    if (this.boundingPolygon) {
      for (const [lon, lat] of this.boundingPolygon) {
        lons.push(lon);
        lats.push(lat);
      }
    }

    // GeoJSON features
    const features = this.buildingsGeojson.features || [];
    for (const feature of features) {
      const coords = this.extractCoordinates(feature.geometry);
      if (!coords) continue;
      for (const [lon, lat] of coords) {
        lons.push(lon);
        lats.push(lat);
      }
    }

    if (lons.length === 0 || lats.length === 0) {
      // Fallback — avoid division by zero later
      this.minLon = 0;
      this.maxLon = 1;
      this.minLat = 0;
      this.maxLat = 1;
      this.refLon = 0.5;
      this.refLat = 0.5;
      return;
    }

    let minLon = Math.min(...lons);
    let maxLon = Math.max(...lons);
    let minLat = Math.min(...lats);
    let maxLat = Math.max(...lats);

    // 8 % padding
    const lonPad = (maxLon - minLon) * 0.08;
    const latPad = (maxLat - minLat) * 0.08;

    this.minLon = minLon - lonPad;
    this.maxLon = maxLon + lonPad;
    this.minLat = minLat - latPad;
    this.maxLat = maxLat + latPad;

    this.refLon = (this.minLon + this.maxLon) / 2;
    this.refLat = (this.minLat + this.maxLat) / 2;
  }

  // ---------------------------------------------------------------------------
  // Area calculation
  // ---------------------------------------------------------------------------

  /**
   * Calculate the area of a polygon ring (in square metres) using the Shoelace
   * formula after projecting lon/lat to metres.
   * @param {Array} coords — [[lon, lat], ...]
   * @returns {number} area in m^2
   */
  calculateBuildingArea(coords) {
    if (!coords || coords.length < 3) return 0;

    const projected = coords.map(([lon, lat]) => this._lonLatToMeters(lon, lat));

    let area = 0;
    const n = projected.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      area += projected[i][0] * projected[j][1];
      area -= projected[j][0] * projected[i][1];
    }
    return Math.abs(area) / 2;
  }

  // ---------------------------------------------------------------------------
  // Building height
  // ---------------------------------------------------------------------------

  /**
   * Determine the rendered height for a building feature based on OSM tags.
   * @param {Object} properties
   * @returns {number}
   */
  getBuildingHeight(properties) {
    if (!properties) return this.extrude;

    // Explicit height tag (may include trailing 'm')
    if (properties.height != null) {
      const parsed = parseFloat(String(properties.height).replace(/m$/i, ''));
      if (!isNaN(parsed)) return parsed;
    }

    // building:levels
    if (properties['building:levels'] != null) {
      const levels = parseFloat(properties['building:levels']);
      if (!isNaN(levels)) return levels * 3.0;
    }

    return this.extrude;
  }

  // ---------------------------------------------------------------------------
  // Rendering a single building
  // ---------------------------------------------------------------------------

  /**
   * Render one building feature onto the canvas context.
   * @param {CanvasRenderingContext2D} ctx
   * @param {Object} feature — GeoJSON Feature
   * @param {number} isoOffsetX
   * @param {number} isoOffsetY
   * @param {number} index
   */
  renderBuilding(ctx, feature, isoOffsetX, isoOffsetY, index) {
    const coords = this.extractCoordinates(feature.geometry);
    if (!coords || coords.length < 3) return;

    // Filter by minimum area
    const area = this.calculateBuildingArea(coords);
    if (area < this.minArea) return;

    const height = this.getBuildingHeight(feature.properties);

    // Ground and roof pixel coordinates
    const groundPixels = coords.map(([lon, lat]) => this.lonLatToPixel(lon, lat));
    const roofPixels = groundPixels.map(([x, y]) => [
      x + Math.round(height * isoOffsetX),
      y - Math.round(height * isoOffsetY),
    ]);

    const wallColor = this.darkenColor(this.roofColor, 0.7);

    // --- Draw walls ---
    for (let i = 0; i < groundPixels.length; i++) {
      const j = (i + 1) % groundPixels.length;

      ctx.beginPath();
      ctx.moveTo(groundPixels[i][0], groundPixels[i][1]);
      ctx.lineTo(groundPixels[j][0], groundPixels[j][1]);
      ctx.lineTo(roofPixels[j][0], roofPixels[j][1]);
      ctx.lineTo(roofPixels[i][0], roofPixels[i][1]);
      ctx.closePath();

      ctx.fillStyle = wallColor;
      ctx.fill();
      ctx.strokeStyle = this.outlineColor;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // --- Draw roof ---
    ctx.beginPath();
    ctx.moveTo(roofPixels[0][0], roofPixels[0][1]);
    for (let i = 1; i < roofPixels.length; i++) {
      ctx.lineTo(roofPixels[i][0], roofPixels[i][1]);
    }
    ctx.closePath();

    ctx.fillStyle = this.roofColor;
    ctx.fill();
    ctx.strokeStyle = this.outlineColor;
    ctx.lineWidth = 1;
    ctx.stroke();

    // --- Collect clickable polygon ---
    // Combine ground + roof points, normalise to 0-1 range
    const allPoints = [...groundPixels, ...roofPixels];
    let clickPoly;
    if (this.simplify) {
      clickPoly = this.convexHull(allPoints);
    } else {
      clickPoly = allPoints;
    }

    const normalised = clickPoly.map(([x, y]) => [x / this.width, y / this.height]);

    this.buildingPolygons.push({
      index,
      polygon: normalised,
      properties: feature.properties || {},
    });
  }

  // ---------------------------------------------------------------------------
  // Geometry helpers
  // ---------------------------------------------------------------------------

  /**
   * Extract the outer coordinate ring from a GeoJSON Geometry.
   * Handles Polygon and MultiPolygon (uses first polygon).
   * @param {Object} geometry
   * @returns {Array|null} [[lon, lat], ...] or null
   */
  extractCoordinates(geometry) {
    if (!geometry) return null;

    if (geometry.type === 'Polygon') {
      return geometry.coordinates[0] || null;
    }

    if (geometry.type === 'MultiPolygon') {
      const firstPoly = geometry.coordinates[0];
      if (!firstPoly) return null;
      return firstPoly[0] || null;
    }

    return null;
  }

  /**
   * Compute the convex hull of a set of 2D points using Andrew's monotone
   * chain algorithm.
   * @param {Array} points — [[x, y], ...]
   * @returns {Array} hull points in counter-clockwise order
   */
  convexHull(points) {
    if (points.length <= 1) return points.slice();

    // Sort by x, then y
    const sorted = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);

    const cross = (o, a, b) =>
      (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

    // Lower hull
    const lower = [];
    for (const p of sorted) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
        lower.pop();
      }
      lower.push(p);
    }

    // Upper hull
    const upper = [];
    for (let i = sorted.length - 1; i >= 0; i--) {
      const p = sorted[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
        upper.pop();
      }
      upper.push(p);
    }

    // Remove last point of each half because it's repeated
    lower.pop();
    upper.pop();

    return lower.concat(upper);
  }

  // ---------------------------------------------------------------------------
  // Colour helpers
  // ---------------------------------------------------------------------------

  /**
   * Darken a hex colour by the given factor (0-1).
   * @param {string} hex — e.g. '#cccccc'
   * @param {number} factor — e.g. 0.7
   * @returns {string} rgb() string
   */
  darkenColor(hex, factor) {
    // Normalise hex
    let h = hex.replace('#', '');
    if (h.length === 3) {
      h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    }

    const r = Math.round(parseInt(h.substring(0, 2), 16) * factor);
    const g = Math.round(parseInt(h.substring(2, 4), 16) * factor);
    const b = Math.round(parseInt(h.substring(4, 6), 16) * factor);

    return `rgb(${r}, ${g}, ${b})`;
  }

  // ---------------------------------------------------------------------------
  // Map tile background
  // ---------------------------------------------------------------------------

  /**
   * Convert lon/lat to OSM tile coordinates at a given zoom level.
   * @param {number} lon
   * @param {number} lat
   * @param {number} zoom
   * @returns {[number, number]} [tileX, tileY]
   */
  _lonLatToTile(lon, lat, zoom) {
    const n = 2 ** zoom;
    const tileX = Math.floor((lon + 180) / 360 * n);
    const latRad = lat * Math.PI / 180;
    const tileY = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
    return [tileX, tileY];
  }

  /**
   * Convert tile coordinates back to lon/lat (top-left corner of tile).
   * @param {number} tileX
   * @param {number} tileY
   * @param {number} zoom
   * @returns {[number, number]} [lon, lat]
   */
  _tileToLonLat(tileX, tileY, zoom) {
    const n = 2 ** zoom;
    const lon = tileX / n * 360 - 180;
    const latRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * tileY / n)));
    const lat = latRad * 180 / Math.PI;
    return [lon, lat];
  }

  /**
   * Download a single OSM tile as an Image.
   * @param {number} tileX
   * @param {number} tileY
   * @param {number} zoom
   * @returns {Promise<HTMLImageElement>}
   */
  _downloadTile(tileX, tileY, zoom) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Tile ${zoom}/${tileX}/${tileY} failed`));
      img.src = `https://tile.openstreetmap.org/${zoom}/${tileX}/${tileY}.png`;
    });
  }

  /**
   * Download OSM map tiles and draw them as background on the canvas context.
   * @param {CanvasRenderingContext2D} ctx
   */
  async _drawMapBackground(ctx) {
    const maxTiles = 64;

    // Find highest zoom level that stays within tile budget
    let zoom = 17;
    for (let z = 18; z >= 10; z--) {
      const [minTX, maxTY] = this._lonLatToTile(this.minLon, this.minLat, z);
      const [maxTX, minTY] = this._lonLatToTile(this.maxLon, this.maxLat, z);
      const total = (maxTX - minTX + 1) * (maxTY - minTY + 1);
      if (total <= maxTiles) {
        zoom = z;
        break;
      }
    }

    // Get tile range
    const [minTileX, maxTileY] = this._lonLatToTile(this.minLon, this.minLat, zoom);
    const [maxTileX, minTileY] = this._lonLatToTile(this.maxLon, this.maxLat, zoom);
    const tilesWide = maxTileX - minTileX + 1;
    const tilesHigh = maxTileY - minTileY + 1;
    const tileSize = 256;

    // Download all tiles in parallel
    const tilePromises = [];
    for (let ty = minTileY; ty <= maxTileY; ty++) {
      for (let tx = minTileX; tx <= maxTileX; tx++) {
        tilePromises.push(
          this._downloadTile(tx, ty, zoom)
            .then(img => ({ img, tx, ty }))
            .catch(() => ({ img: null, tx, ty }))
        );
      }
    }
    const tiles = await Promise.all(tilePromises);

    // Draw tiles onto an offscreen composite canvas
    const compW = tilesWide * tileSize;
    const compH = tilesHigh * tileSize;
    const comp = document.createElement('canvas');
    comp.width = compW;
    comp.height = compH;
    const compCtx = comp.getContext('2d');

    for (const { img, tx, ty } of tiles) {
      if (!img) continue;
      const xOff = (tx - minTileX) * tileSize;
      const yOff = (ty - minTileY) * tileSize;
      compCtx.drawImage(img, xOff, yOff, tileSize, tileSize);
    }

    // Calculate the geographic bounds of the tile composite
    const [compMinLon, compMaxLat] = this._tileToLonLat(minTileX, minTileY, zoom);
    const [compMaxLon, compMinLat] = this._tileToLonLat(maxTileX + 1, maxTileY + 1, zoom);

    // Crop composite to our exact geographic bounds
    const lonRange = compMaxLon - compMinLon;
    const latRange = compMaxLat - compMinLat;

    const cropLeft = (this.minLon - compMinLon) / lonRange * compW;
    const cropRight = (this.maxLon - compMinLon) / lonRange * compW;
    const cropTop = (compMaxLat - this.maxLat) / latRange * compH;
    const cropBottom = (compMaxLat - this.minLat) / latRange * compH;

    const srcW = cropRight - cropLeft;
    const srcH = cropBottom - cropTop;

    if (srcW > 0 && srcH > 0) {
      ctx.drawImage(comp, cropLeft, cropTop, srcW, srcH, 0, 0, this.width, this.height);
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Project lon/lat to flat metres using an equirectangular approximation
   * centred on the bounds reference point.
   * @param {number} lon
   * @param {number} lat
   * @returns {[number, number]} [x, y] in metres
   */
  _lonLatToMeters(lon, lat) {
    const x =
      EARTH_RADIUS *
      ((lon - this.refLon) * Math.PI) / 180 *
      Math.cos((this.refLat * Math.PI) / 180);
    const y = EARTH_RADIUS * ((lat - this.refLat) * Math.PI) / 180;
    return [x, y];
  }

  /**
   * Return the latitude of the centroid of a feature (simple average).
   * Used for painter's-algorithm sorting.
   * @param {Object} feature
   * @returns {number}
   */
  _centroidLat(feature) {
    const coords = this.extractCoordinates(feature.geometry);
    if (!coords || coords.length === 0) return 0;
    let sum = 0;
    for (const [, lat] of coords) {
      sum += lat;
    }
    return sum / coords.length;
  }
}
