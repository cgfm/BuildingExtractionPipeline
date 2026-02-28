/**
 * overpass.js — ES module for downloading building data from OpenStreetMap
 * via the Overpass API.
 *
 * Input:  GeoJSON object containing a Polygon geometry.
 * Output: GeoJSON FeatureCollection of buildings.
 */

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const RETRY_DELAYS = [5000, 10000, 20000]; // exponential backoff in ms
const BBOX_AREA_WARN_KM2 = 5;

/**
 * Extract polygon coordinates from a GeoJSON object.
 * Supports FeatureCollection, Feature, or bare Polygon geometry.
 * Uses the first feature's geometry and the first (outer) ring only.
 *
 * @param {object} geojson - Parsed GeoJSON object.
 * @returns {number[][]} Array of [lng, lat] coordinate pairs (first ring).
 */
export function extractPolygonCoords(geojson) {
    let geometry = null;

    if (!geojson || typeof geojson !== 'object') {
        throw new Error('Invalid GeoJSON: input is not an object');
    }

    if (geojson.type === 'FeatureCollection') {
        if (!geojson.features || geojson.features.length === 0) {
            throw new Error('FeatureCollection contains no features');
        }
        geometry = geojson.features[0].geometry;
    } else if (geojson.type === 'Feature') {
        geometry = geojson.geometry;
    } else if (geojson.type === 'Polygon') {
        geometry = geojson;
    } else if (geojson.type === 'MultiPolygon') {
        // Use the first polygon from a MultiPolygon
        geometry = {
            type: 'Polygon',
            coordinates: geojson.coordinates[0]
        };
    } else {
        throw new Error(`Unsupported GeoJSON type: ${geojson.type}`);
    }

    if (!geometry || geometry.type !== 'Polygon') {
        throw new Error(`Expected Polygon geometry, got: ${geometry ? geometry.type : 'null'}`);
    }

    if (!geometry.coordinates || geometry.coordinates.length === 0) {
        throw new Error('Polygon has no coordinate rings');
    }

    // Return the first (outer) ring only
    return geometry.coordinates[0];
}

/**
 * Estimate the bounding box area in km² for a set of coordinates.
 *
 * @param {number[][]} coords - Array of [lng, lat] pairs.
 * @returns {number} Approximate area of the bounding box in km².
 */
function estimateBboxAreaKm2(coords) {
    let minLat = Infinity, maxLat = -Infinity;
    let minLng = Infinity, maxLng = -Infinity;

    for (const [lng, lat] of coords) {
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
    }

    const latMid = (minLat + maxLat) / 2;
    const latDist = (maxLat - minLat) * 111.32; // degrees lat to km
    const lngDist = (maxLng - minLng) * 111.32 * Math.cos(latMid * Math.PI / 180);

    return latDist * lngDist;
}

/**
 * Build an Overpass QL query string for buildings within a polygon.
 *
 * @param {number[][]} coords - Array of [lng, lat] coordinate pairs.
 * @returns {string} Overpass QL query.
 */
function buildOverpassQuery(coords) {
    // Overpass poly filter expects "lat lng lat lng ..." (space-separated, lat before lng)
    const polyString = coords
        .map(([lng, lat]) => `${lat} ${lng}`)
        .join(' ');

    return `[out:json][timeout:60];
(
  way["building"](poly:"${polyString}");
  relation["building"](poly:"${polyString}");
);
out geom;
>;
out skel qt;`;
}

/**
 * Sleep for the given number of milliseconds.
 *
 * @param {number} ms - Duration in milliseconds.
 * @returns {Promise<void>}
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Download buildings from OpenStreetMap via the Overpass API.
 *
 * Extracts the polygon from the provided GeoJSON, builds an Overpass query,
 * and returns a GeoJSON FeatureCollection of buildings.
 *
 * Implements retry with exponential backoff (5s, 10s, 20s) for 429 responses.
 *
 * @param {object} geojsonPolygon - Parsed GeoJSON containing a Polygon.
 * @returns {Promise<object>} GeoJSON FeatureCollection of buildings.
 */
export async function downloadBuildings(geojsonPolygon) {
    const coords = extractPolygonCoords(geojsonPolygon);

    // Warn if the bounding box is large
    const area = estimateBboxAreaKm2(coords);
    if (area > BBOX_AREA_WARN_KM2) {
        console.warn(
            `[overpass] Polygon bounding box is approximately ${area.toFixed(1)} km², ` +
            `which exceeds the ${BBOX_AREA_WARN_KM2} km² warning threshold. ` +
            `Large queries may be slow or rejected by the Overpass API.`
        );
    }

    const query = buildOverpassQuery(coords);

    let lastError = null;

    for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
        try {
            const response = await fetch(OVERPASS_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: `data=${encodeURIComponent(query)}`
            });

            if (response.status === 429) {
                if (attempt < RETRY_DELAYS.length) {
                    const delay = RETRY_DELAYS[attempt];
                    console.warn(
                        `[overpass] Rate limited (429). Retrying in ${delay / 1000}s ` +
                        `(attempt ${attempt + 1}/${RETRY_DELAYS.length})...`
                    );
                    await sleep(delay);
                    continue;
                }
                throw new Error('Overpass API rate limit exceeded after all retries');
            }

            if (!response.ok) {
                throw new Error(`Overpass API error: HTTP ${response.status} ${response.statusText}`);
            }

            const data = await response.json();

            if (!data.elements) {
                throw new Error('Overpass response missing "elements" array');
            }

            return osmToGeojson(data);
        } catch (err) {
            lastError = err;

            // Only retry on 429 (handled above), not on other errors
            if (err.message && !err.message.includes('429')) {
                throw err;
            }
        }
    }

    throw lastError || new Error('Overpass API request failed after all retries');
}

/**
 * Close a coordinate ring if it is not already closed.
 *
 * @param {number[][]} ring - Array of [lng, lat] pairs.
 * @returns {number[][]} Closed ring.
 */
function closeRing(ring) {
    if (ring.length < 2) return ring;
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
        return [...ring, [first[0], first[1]]];
    }
    return ring;
}

/**
 * Convert a way element's geometry array to GeoJSON coordinates.
 *
 * @param {object[]} geometry - Array of {lat, lon} objects from Overpass.
 * @returns {number[][]} Array of [lng, lat] pairs (closed ring).
 */
function wayGeometryToCoords(geometry) {
    const coords = geometry.map(pt => [pt.lon, pt.lat]);
    return closeRing(coords);
}

/**
 * Convert OSM elements (from Overpass JSON response) to a GeoJSON FeatureCollection.
 *
 * Handles both ways and relations:
 * - Ways: extract geometry array, close ring if needed, produce Polygon.
 * - Relations: find outer members with geometry. Single outer = Polygon,
 *   multiple outers = MultiPolygon.
 *
 * @param {object} data - Overpass API JSON response with an `elements` array.
 * @returns {object} GeoJSON FeatureCollection.
 */
export function osmToGeojson(data) {
    const features = [];

    for (const element of data.elements) {
        if (element.type === 'way') {
            if (!element.geometry || element.geometry.length === 0) {
                continue;
            }

            const coords = wayGeometryToCoords(element.geometry);

            features.push({
                type: 'Feature',
                properties: {
                    ...(element.tags || {}),
                    osm_id: element.id,
                    osm_type: 'way'
                },
                geometry: {
                    type: 'Polygon',
                    coordinates: [coords]
                }
            });
        } else if (element.type === 'relation') {
            if (!element.members) {
                continue;
            }

            // Collect outer rings from members
            const outerRings = [];
            for (const member of element.members) {
                if (member.role === 'outer' && member.geometry && member.geometry.length > 0) {
                    const coords = wayGeometryToCoords(member.geometry);
                    outerRings.push(coords);
                }
            }

            if (outerRings.length === 0) {
                continue;
            }

            let geometry;
            if (outerRings.length === 1) {
                geometry = {
                    type: 'Polygon',
                    coordinates: [outerRings[0]]
                };
            } else {
                geometry = {
                    type: 'MultiPolygon',
                    coordinates: outerRings.map(ring => [ring])
                };
            }

            features.push({
                type: 'Feature',
                properties: {
                    ...(element.tags || {}),
                    osm_id: element.id,
                    osm_type: 'relation'
                },
                geometry
            });
        }
        // Skip nodes and other types
    }

    return {
        type: 'FeatureCollection',
        features
    };
}
