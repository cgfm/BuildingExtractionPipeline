/**
 * pipeline.js — ES module orchestrating the full building extraction pipeline.
 *
 * Imports all other modules and provides a single Pipeline class that
 * drives: download -> render -> extract -> export.
 */

import { downloadBuildings, extractPolygonCoords } from './overpass.js';
import { Building25DRenderer } from './renderer.js';
import { createBuildingJson } from './polygon-extractor.js';
import { createStandaloneHtml, downloadHtml, downloadJson, downloadImage } from './export.js';

export class Pipeline {
    /**
     * @param {Object} callbacks
     * @param {function(number, string)} callbacks.onProgress - (step, message)
     * @param {function(string)}         callbacks.onLog      - log line
     * @param {function(Object)}         callbacks.onComplete - result object
     * @param {function(string)}         callbacks.onError    - error message
     */
    constructor(callbacks) {
        this.callbacks = callbacks;
        this.buildingsGeojson = null; // cached for re-render
        this.canvas = null;
        this.buildingJson = null;
    }

    /**
     * Run the full pipeline: download buildings, render, extract polygons.
     * @param {Object} geojsonData - Parsed GeoJSON with the bounding polygon
     * @param {Object} params      - Rendering parameters
     */
    async run(geojsonData, params) {
        try {
            this.callbacks.onProgress(1, 'Downloading buildings from OpenStreetMap...');
            this.callbacks.onLog('[INFO] Starte Download von OpenStreetMap...');

            this.buildingsGeojson = await downloadBuildings(geojsonData);
            const buildingCount = this.buildingsGeojson.features.length;
            this.callbacks.onLog(`[INFO] ${buildingCount} Gebäude gefunden`);

            await this.renderAndExtract(geojsonData, params);
        } catch (error) {
            this.callbacks.onError(error.message);
        }
    }

    /**
     * Render the 2.5D view and extract clickable polygons.
     * @param {Object} geojsonData - Parsed GeoJSON with the bounding polygon
     * @param {Object} params      - Rendering parameters
     */
    async renderAndExtract(geojsonData, params) {
        this.callbacks.onProgress(2, 'Rendering 2.5D view...');
        this.callbacks.onLog('[INFO] Lade Kartenhintergrund und starte 2.5D Rendering...');

        const polygon = extractPolygonCoords(geojsonData);
        const renderer = new Building25DRenderer(this.buildingsGeojson, polygon, params);
        this.canvas = await renderer.render();
        this.callbacks.onLog(`[INFO] ${renderer.buildingPolygons.length} Gebäude gerendert`);

        this.callbacks.onProgress(3, 'Extracting polygons...');
        this.callbacks.onLog('[INFO] Extrahiere Polygone...');

        this.buildingJson = createBuildingJson(this.canvas, renderer.buildingPolygons, 'rendered.png');
        this.callbacks.onLog(`[INFO] ${this.buildingJson.buildings.length} klickbare Polygone extrahiert`);

        // Add dataUrl to image for viewer/editor
        this.buildingJson.image.dataUrl = this.canvas.toDataURL('image/png');

        const avgPoints = this.buildingJson.buildings.length > 0
            ? Math.round(
                this.buildingJson.buildings.reduce((sum, b) => sum + b.polygon.length, 0) /
                this.buildingJson.buildings.length
              )
            : 0;

        this.callbacks.onProgress(4, 'Complete!');
        this.callbacks.onLog('[INFO] Pipeline abgeschlossen!');

        this.callbacks.onComplete({
            buildingCount: this.buildingJson.buildings.length,
            imageWidth: this.canvas.width,
            imageHeight: this.canvas.height,
            avgPoints: avgPoints,
            canvas: this.canvas,
            buildingJson: this.buildingJson
        });
    }

    /**
     * Re-render using cached building data (skips download).
     * @param {Object} geojsonData - Parsed GeoJSON with the bounding polygon
     * @param {Object} params      - Rendering parameters
     */
    async rerender(geojsonData, params) {
        if (!this.buildingsGeojson) {
            this.callbacks.onError('No buildings data cached. Run full pipeline first.');
            return;
        }
        try {
            await this.renderAndExtract(geojsonData, params);
        } catch (error) {
            this.callbacks.onError(error.message);
        }
    }

    /**
     * Fetch the viewer.html template for standalone export.
     * @returns {Promise<string>}
     */
    getViewerHtml() {
        return fetch('viewer.html').then(r => r.text());
    }

    /**
     * Export a standalone HTML file with embedded data and image.
     */
    async exportStandalone() {
        const template = await this.getViewerHtml();
        const html = createStandaloneHtml(template, this.buildingJson, this.canvas);
        downloadHtml(html);
    }

    /**
     * Download the building JSON data.
     */
    exportJson() {
        downloadJson(this.buildingJson);
    }

    /**
     * Download the rendered canvas as a PNG image.
     */
    exportImage() {
        downloadImage(this.canvas);
    }
}
