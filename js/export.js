/**
 * Pure ES Module for exporting standalone HTML files and downloading JSON/images
 * No dependencies, no build tools required
 */

/**
 * Creates a standalone HTML file with inline data and canvas image
 * @param {string} viewerHtmlTemplate - The HTML template string from the viewer
 * @param {Object} buildingsData - The buildings/polygons data object
 * @param {HTMLCanvasElement} canvasElement - The canvas element to render as PNG
 * @returns {string} Modified HTML string with inline data and image
 */
export function createStandaloneHtml(viewerHtmlTemplate, buildingsData, canvasElement) {
  // Convert canvas to base64 PNG
  const imageDataUrl = canvasElement.toDataURL('image/png');

  // Start with the template
  let html = viewerHtmlTemplate;

  // Inject inline data by replacing the data loading block.
  // The viewer uses: window.__buildingsData check, then sessionStorage, then fetch.
  // We inject a script that sets window.__buildingsData before init() runs.
  const inlineData = { ...buildingsData };
  // Embed the image as a data URL in the image object
  inlineData.image = { ...buildingsData.image, dataUrl: imageDataUrl };

  const inlineScript = `<script>window.__buildingsData = ${JSON.stringify(inlineData)};<\/script>`;
  html = html.replace('</head>', inlineScript + '\n</head>');

  return html;
}

/**
 * Downloads HTML content as a file
 * @param {string} htmlContent - The HTML content to download
 * @param {string} [filename='building-map.html'] - The filename for download
 */
export function downloadHtml(htmlContent, filename = 'building-map.html') {
  const blob = new Blob([htmlContent], { type: 'text/html' });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(objectUrl);
}

/**
 * Downloads JSON data as a file
 * @param {Object} data - The data object to download as JSON
 * @param {string} [filename='gebaeude_polygone.json'] - The filename for download
 */
export function downloadJson(data, filename = 'gebaeude_polygone.json') {
  const jsonString = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(objectUrl);
}

/**
 * Downloads canvas as a PNG image file
 * @param {HTMLCanvasElement} canvas - The canvas element to download
 * @param {string} [filename='rendered.png'] - The filename for download
 */
export function downloadImage(canvas, filename = 'rendered.png') {
  canvas.toBlob((blob) => {
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(objectUrl);
  }, 'image/png');
}
