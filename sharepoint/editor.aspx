<%@ Page Language="C#" %>
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="referrer" content="no-referrer-when-downgrade">
    <title>Geb&auml;udekarten-Designer</title>
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha384-sHL9NAb7lN7rfvG5lfHpm643Xkcjzp4jFvuavGOndn6pjVqS6ny56CAt3nsEVT4H" crossorigin="anonymous" />
    <link rel="stylesheet" href="https://unpkg.com/leaflet-draw@1.0.4/dist/leaflet.draw.css" integrity="sha384-NZLkVuBRMEeB4VeZz27WwTRvlhec30biQ8Xx7zG7JJnkvEKRg5qi6BNbEXo9ydwv" crossorigin="anonymous" />
    <link rel="stylesheet" href="css/style.css">
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha384-cxOPjt7s7Iz04uaHJceBmS+qpjv2JkIHNVcuOrM+YHwZOmJGBXI00mdUXEq65HTH" crossorigin="anonymous"></script>
    <script src="https://unpkg.com/leaflet-draw@1.0.4/dist/leaflet.draw.js" integrity="sha384-JP5UPxIO2Tm2o79Fb0tGYMa44jkWar53aBoCbd8ah0+LcCDoohTIYr+zIXyfGIJN" crossorigin="anonymous"></script>
    <style>
        /* SharePoint-mode overrides: hide UI elements not applicable in this deployment */
        body.sp-mode #btnStandalone,
        body.sp-mode #btnDownloadGeojson,
        body.sp-mode #btnDownloadImage,
        body.sp-mode #btnReset,
        body.sp-mode #edPreviewBtn,
        body.sp-mode #edSaveMenu,
        body.sp-mode #tabBtnProjects,
        body.sp-mode #viewerOverlay { display: none !important; }
        body.sp-mode .export-list { display: none !important; }

        /* Toast notifications for save feedback */
        #spToast {
            position: fixed; top: 20px; right: 20px;
            background: #2d331a; color: #fff;
            padding: 10px 16px; border-radius: 3px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.25);
            z-index: 10000; font-size: 14px;
            opacity: 0; transform: translateY(-8px);
            transition: opacity 0.25s, transform 0.25s;
            max-width: 360px;
        }
        #spToast.visible { opacity: 1; transform: translateY(0); }
        #spToast[data-kind="success"] { background: #4b5320; }
        #spToast[data-kind="warn"]    { background: #b78512; }
        #spToast[data-kind="error"]   { background: #a93226; }

        /* Role banner */
        body[data-role="viewer"] .pipeline-wrap::before {
            content: "Nur Lese-Modus \2014  Bearbeitung erfordert Schreibrechte auf diese Bibliothek.";
            display: block;
            padding: 10px 16px;
            margin-bottom: 12px;
            background: #fff3cd;
            border-left: 3px solid #f0ad4e;
            color: #856404;
            font-size: 13px;
        }
    </style>
</head>
<body>

<div class="pipeline-wrap">

    <!-- Header -->
    <div class="card header-card">
        <h1>Geb&auml;udekarten-Designer</h1>
        <p>OSM-Geb&auml;ude extrahieren, 2.5D-Rendering erstellen, beschriften &mdash; direkt in SharePoint speichern.</p>
    </div>

    <!-- Accordion 1: Pipeline -->
    <div class="accordion" id="accordionPipeline">
        <div class="accordion-header" onclick="toggleAccordion('accordionPipeline')">
            <h2><span class="step-badge">&#9881;</span> Pipeline <span class="accordion-badge hidden" id="pipelineBadge"></span></h2>
            <span class="accordion-toggle">&#9660;</span>
        </div>
        <div class="accordion-body">
            <div class="accordion-body-inner">

    <!-- Step 1: Area / Upload -->
    <div class="card">
        <div class="card-title">
            <span class="step-badge">1</span>
            Gebiet festlegen
            <span class="info-tip" tabindex="0"><span class="info-tip-text">Zeichnen Sie ein Polygon auf der Karte oder laden Sie eine GeoJSON-Datei hoch, um das Gebiet f&uuml;r die Geb&auml;ude-Extraktion festzulegen.</span></span>
        </div>
        <div class="step-desc">Polygon auf der Karte zeichnen oder GeoJSON hochladen.</div>
        <div class="tab-bar">
            <button class="tab-btn active" data-tab="tabDraw">Auf Karte zeichnen</button>
            <button class="tab-btn" data-tab="tabUpload">Datei hochladen</button>
            <button class="tab-btn" data-tab="tabProjects" id="tabBtnProjects" style="display:none">Projekte <span class="tab-badge" id="projectsBadge"></span></button>
        </div>
        <!-- Tab: Draw on map -->
        <div class="tab-panel active" id="tabDraw">
            <div id="drawMap"></div>
            <div class="draw-info hidden" id="drawInfo"></div>
            <div class="button-row" style="margin-top:10px">
                <button class="btn btn-secondary btn-sm hidden" id="btnClearPolygon">Polygon l&ouml;schen</button>
                <button class="btn btn-secondary btn-sm hidden" id="btnDownloadPolygon">GeoJSON herunterladen</button>
            </div>
        </div>
        <!-- Tab: File upload -->
        <div class="tab-panel" id="tabUpload">
            <div class="upload-zone" id="uploadZone">
                <span class="upload-icon">&#128194;</span>
                <span class="upload-label">Datei hierher ziehen oder klicken</span>
                <span class="upload-hint">GeoJSON-Polygon oder Geb&auml;ude-Metadaten (.json)</span>
                <div class="file-info hidden" id="fileInfo"></div>
                <input type="file" id="fileInput" accept=".geojson,.json,application/geo+json,application/json">
            </div>
        </div>
        <!-- Tab: Saved projects (hidden in SP mode but present so app.js binds cleanly) -->
        <div class="tab-panel" id="tabProjects">
            <div class="projects-grid" id="projectsGrid"></div>
            <div class="projects-empty" id="projectsEmpty" style="display:none">Keine gespeicherten Projekte.</div>
        </div>
    </div>

    <!-- Step 2: Parameters -->
    <div class="card">
        <div class="card-title">
            <span class="step-badge">2</span>
            Pipeline-Parameter
        </div>
        <div class="step-desc">Rendering-Einstellungen f&uuml;r die 2.5D-Ansicht und Polygon-Extraktion anpassen.</div>

        <!-- Rendering params -->
        <div class="params-section">
            <div class="params-section-title">Rendering</div>
            <div class="params-row cols-3">
                <div class="param-group">
                    <label for="paramTilt">Neigung (Tilt) <span class="info-tip" tabindex="0"><span class="info-tip-text">Blickwinkel auf die Geb&auml;ude. 0&deg; = Draufsicht, 90&deg; = seitlich. Empfohlen: 30&ndash;60&deg;</span></span></label>
                    <div class="param-row">
                        <input type="range" id="paramTilt" min="0" max="90" value="45">
                        <span class="param-value" id="paramTiltVal">45</span>
                    </div>
                </div>
                <div class="param-group">
                    <label for="paramRotation">Rotation <span class="info-tip" tabindex="0"><span class="info-tip-text">Dreht die gesamte Ansicht. 0&deg; = Norden oben.</span></span></label>
                    <div class="param-row">
                        <input type="range" id="paramRotation" min="0" max="360" value="0">
                        <span class="param-value" id="paramRotationVal">0</span>
                    </div>
                </div>
                <div class="param-group">
                    <label for="paramExtrude">3D-Tiefe <span class="info-tip" tabindex="0"><span class="info-tip-text">H&ouml;he der 3D-Extrusion der Geb&auml;ude. H&ouml;here Werte erzeugen st&auml;rkeren Pseudo-3D-Effekt.</span></span></label>
                    <div class="param-row">
                        <input type="range" id="paramExtrude" min="1" max="12" value="4" step="0.5">
                        <span class="param-value" id="paramExtrudeVal">4</span>
                    </div>
                </div>
            </div>
        </div>

        <!-- Image dimensions -->
        <div class="params-section">
            <div class="params-section-title">Bildgr&ouml;&szlig;e</div>
            <div class="params-row cols-2">
                <div class="param-group">
                    <label for="paramWidth">Breite (px) <span class="info-tip" tabindex="0"><span class="info-tip-text">Breite des gerenderten Bildes in Pixeln. Gr&ouml;&szlig;ere Werte = mehr Detail, l&auml;ngere Ladezeit.</span></span></label>
                    <input type="number" id="paramWidth" min="800" max="4000" value="2000">
                </div>
                <div class="param-group">
                    <label for="paramHeight">H&ouml;he (px) <span class="info-tip" tabindex="0"><span class="info-tip-text">H&ouml;he des gerenderten Bildes in Pixeln.</span></span></label>
                    <input type="number" id="paramHeight" min="600" max="3000" value="1150">
                </div>
            </div>
        </div>

        <!-- Colors -->
        <div class="params-section">
            <div class="params-section-title">Farben</div>
            <div class="params-row cols-2">
                <div class="param-group">
                    <label>Au&szlig;enfarbe <span class="info-tip" tabindex="0"><span class="info-tip-text">Farbe der Geb&auml;udeau&szlig;enseite (Dach und W&auml;nde) in der 2.5D-Ansicht.</span></span></label>
                    <div class="color-group">
                        <input type="color" id="paramRoofColor" value="#cccccc">
                        <span class="color-text" id="paramRoofColorText">#cccccc</span>
                    </div>
                </div>
                <div class="param-group">
                    <label>Kantenfarbe <span class="info-tip" tabindex="0"><span class="info-tip-text">Farbe der Geb&auml;udekanten und Umrisse.</span></span></label>
                    <div class="color-group">
                        <input type="color" id="paramOutlineColor" value="#333333">
                        <span class="color-text" id="paramOutlineColorText">#333333</span>
                    </div>
                </div>
            </div>
        </div>

        <!-- Polygon options -->
        <div class="params-section">
            <div class="params-section-title">Polygon-Optionen</div>
            <div class="params-row cols-2">
                <div class="param-group">
                    <label for="paramMinArea">Min. Geb&auml;udefl&auml;che (px) <span class="info-tip" tabindex="0"><span class="info-tip-text">Geb&auml;ude kleiner als dieser Wert (in Bildpixeln) werden ignoriert. Filtert sehr kleine Strukturen heraus.</span></span></label>
                    <input type="number" id="paramMinArea" min="0" max="1000" value="25">
                </div>
                <div class="param-group" style="display:flex;flex-direction:column;justify-content:flex-end;">
                    <div class="checkbox-row">
                        <input type="checkbox" id="paramSimplify" checked>
                        <label for="paramSimplify">Polygon-Vereinfachung <span class="info-tip" tabindex="0"><span class="info-tip-text">Vereinfacht die klickbaren Polygone zu konvexen H&uuml;llen. Reduziert Dateigr&ouml;&szlig;e, kann aber bei komplexen Geb&auml;udegrundrissen ungenau sein.</span></span></label>
                    </div>
                    <div class="checkbox-row" style="margin-top:8px;">
                        <input type="checkbox" id="paramUniformHeight">
                        <label for="paramUniformHeight">Einheitliche H&ouml;he <span class="info-tip" tabindex="0"><span class="info-tip-text">Ignoriert H&ouml;hendaten aus OpenStreetMap (height, building:levels) und verwendet f&uuml;r alle Geb&auml;ude den 3D-Tiefe-Wert.</span></span></label>
                    </div>
                </div>
                <div class="param-group">
                    <label for="paramTileProvider">Kartenkacheln</label>
                    <select id="paramTileProvider">
                        <option value="osm">OpenStreetMap (Referer n&ouml;tig)</option>
                        <option value="carto_voyager">CartoDB Voyager</option>
                        <option value="carto_light">CartoDB Positron (Hell)</option>
                        <option value="carto_dark">CartoDB Dark Matter</option>
                    </select>
                </div>
            </div>
        </div>
    </div>

    <!-- Step 3: Run + Results -->
    <div class="card">
        <div class="card-title">
            <span class="step-badge">3</span>
            Pipeline ausf&uuml;hren
        </div>
        <div class="step-desc">OSM-Geb&auml;ude herunterladen, 2.5D-Bild rendern und klickbare Polygone extrahieren.</div>

        <div class="button-row">
            <button class="btn btn-primary" id="btnRun" disabled>
                Kompletten Prozess starten
            </button>
            <span class="info-tip" tabindex="0"><span class="info-tip-text">L&auml;dt Geb&auml;ude von OpenStreetMap herunter, rendert die 2.5D-Ansicht und extrahiert klickbare Polygone.</span></span>
            <button class="btn btn-secondary hidden" id="btnRerender">
                Nur Rendering neu starten
            </button>
            <span class="info-tip hidden" id="rerenderTip" tabindex="0"><span class="info-tip-text">Verwendet gecachte OSM-Daten und rendert nur neu. Bestehende Geb&auml;ude-Metadaten (Name, Gruppe, Farbe) werden per Centroid-Matching &uuml;bernommen.</span></span>
        </div>

        <!-- Progress steps -->
        <div class="progress-steps hidden" id="progressSteps">
            <div class="progress-step" id="pStep1">
                <span class="step-label">1. Download</span>
            </div>
            <div class="progress-step" id="pStep2">
                <span class="step-label">2. Render &amp; Extract</span>
            </div>
            <div class="progress-step" id="pStep3">
                <span class="step-label">3. Fertig</span>
            </div>
        </div>

        <!-- Progress bar -->
        <div class="progress-bar-wrap hidden" id="progressBarWrap">
            <div class="progress-bar-fill" id="progressBarFill"></div>
        </div>

        <!-- Log console -->
        <div class="log-console" id="logConsole"></div>

        <!-- Result card -->
        <div class="result-card" id="resultCard">
            <h3>Ergebnis</h3>
            <div class="stats-grid" id="statsGrid">
                <div class="stat-card">
                    <div class="stat-value" id="statBuildings">-</div>
                    <div class="stat-label">Geb&auml;ude</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value" id="statResolution">-</div>
                    <div class="stat-label">Aufl&ouml;sung</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value" id="statAvgPoints">-</div>
                    <div class="stat-label">Punkte / Polygon</div>
                </div>
            </div>

            <div class="viewer-preview" id="viewerPreview" style="display:none;">
                <div class="vp-sidebar" id="vpSidebar"></div>
                <div class="vp-main">
                    <div class="vp-image-container" id="vpImageContainer"></div>
                </div>
            </div>

            <div class="button-row" style="margin-bottom:18px;">
                <button class="btn btn-success btn-sm" id="btnEditor" data-tooltip="&Ouml;ffnet den Geb&auml;ude-Editor zum Bearbeiten von Namen, Gruppen, Beschreibungen und Farben.">Zum Editor</button>
                <button class="btn btn-secondary btn-sm hidden" id="btnRerender2" data-tooltip="Rendert das Bild mit den aktuellen Parametern neu. Gecachte OSM-Daten und Geb&auml;ude-Metadaten bleiben erhalten.">Neurendering</button>
            </div>

            <!-- Download list is hidden in SP mode via CSS, but must exist for app.js to bind -->
            <div class="export-list">
                <div class="export-row">
                    <button class="btn btn-secondary btn-sm" id="btnStandalone">Standalone HTML</button>
                    <span class="export-desc">Einzelne HTML-Datei mit eingebettetem Bild und interaktivem Viewer</span>
                </div>
                <div class="export-row">
                    <button class="btn btn-secondary btn-sm" id="btnDownloadGeojson">GeoJSON herunterladen</button>
                    <span class="export-desc">OSM-Geb&auml;udedaten als GeoJSON-Datei</span>
                </div>
                <div class="export-row">
                    <button class="btn btn-secondary btn-sm" id="btnDownloadImage">Bild herunterladen</button>
                    <span class="export-desc">Gerendertes 2.5D-Bild als PNG-Datei</span>
                </div>
                <div class="export-row">
                    <button class="btn btn-secondary btn-sm" id="btnReset">Zur&uuml;cksetzen</button>
                    <span class="export-desc">Alle Daten und Cache l&ouml;schen, Pipeline komplett neu starten</span>
                </div>
            </div>
        </div>
    </div>

            </div><!-- /accordion-body-inner Pipeline -->
        </div><!-- /accordion-body Pipeline -->
    </div><!-- /accordion Pipeline -->

    <!-- Accordion 2: Geb&auml;ude Editor -->
    <div class="accordion collapsed" id="accordionEditor">
        <div class="accordion-header" onclick="toggleAccordion('accordionEditor')">
            <h2><span class="step-badge">&#9998;</span> Geb&auml;ude Editor <span class="accordion-badge hidden" id="editorBadge"></span></h2>
            <span class="accordion-toggle">&#9660;</span>
        </div>
        <div class="accordion-body">
            <div class="editor-layout">
                <aside class="editor-sidebar">
                    <div class="editor-sidebar-header">
                        <h3>Geb&auml;ude</h3>
                        <p id="edSidebarInfo">Interaktiver Geb&auml;ude-Editor</p>
                    </div>
                    <div class="editor-toolbar">
                        <button class="btn btn-secondary btn-sm" id="edLoadBtn" data-tooltip="Importiert eine zuvor gespeicherte JSON-Datei und &uuml;bernimmt Bezeichnungen, Beschreibungen und Gruppen.">Import</button>
                        <input type="file" id="edLoadFileInput" accept=".json" style="display:none">
                        <button class="btn btn-sm" id="edDrawAreaBtn" style="background:#2196F3;color:#fff;" data-tooltip="Zeichnet eine neue Fl&auml;che/Zone durch Klicken von Punkten auf der Karte.">&#x25A1; Fl&auml;che zeichnen</button>
                        <button class="btn btn-primary btn-sm" id="edPreviewBtn" data-tooltip="Vorschau (in SharePoint-Modus deaktiviert).">Vorschau</button>
                    </div>
                    <div class="ed-search-bar">
                        <input type="text" class="ed-search-input" id="edSearchInput" placeholder="Geb&#228;ude suchen...">
                    </div>
                    <div id="edSidebarContent">
                        <div class="ed-empty-state"><p>F&uuml;hren Sie zuerst die Pipeline aus, um Geb&auml;ude zu laden.</p></div>
                    </div>
                </aside>
                <main class="editor-main">
                    <div class="ed-map-panel">
                        <h2>Interaktive Karte</h2>
                        <div class="ed-map-container" id="edMapContainer">
                            <div class="ed-empty-state"><p>Noch keine Kartendaten vorhanden.</p></div>
                        </div>
                    </div>
                    <div class="ed-editor-panel">
                        <div id="edEditorContent">
                            <div class="ed-empty-state">
                                <h3>Kein Geb&auml;ude ausgew&auml;hlt</h3>
                                <p>W&auml;hlen Sie ein Geb&auml;ude aus der Liste oder klicken Sie auf ein Geb&auml;ude in der Karte, um es zu bearbeiten.</p>
                            </div>
                        </div>
                    </div>
                </main>
            </div>
        </div><!-- /accordion-body Editor -->
    </div><!-- /accordion Editor -->

</div><!-- /pipeline-wrap -->

<!-- Viewer overlay (hidden in SP mode via CSS, but retained for app.js bindings) -->
<div class="viewer-overlay" id="viewerOverlay">
    <div class="vo-dialog">
        <button class="vo-close-btn" id="voCloseBtn" title="Schlie&szlig;en">&times;</button>
        <div class="vo-sidebar" id="voSidebar"></div>
        <div class="vo-main">
            <div class="vo-image-container" id="voImageContainer"></div>
        </div>
    </div>
</div>

<!-- Floating undo/redo -->
<div class="undo-redo-float" id="undoRedoFloat">
    <button class="undo-redo-btn" id="undoBtn" disabled data-tooltip="R&uuml;ckg&auml;ngig (Strg+Z)">&#x21B6;</button>
    <button class="undo-redo-btn" id="redoBtn" disabled data-tooltip="Wiederholen (Strg+Umschalt+Z)">&#x21B7;</button>
</div>

<div id="tooltip"></div>

<script src="js/tooltip.js"></script>
<script src="js/viewer-widget.js"></script>
<script src="js/app.js"></script>
<script src="js/sharepoint-io.js"></script>
<script src="js/app-sharepoint.js"></script>

</body>
</html>
