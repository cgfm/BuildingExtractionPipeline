# Building Extraction Pipeline

Interaktives Tool zum Herunterladen von OSM-Gebäuden, Rendern einer 2.5D-Ansicht und Extrahieren klickbarer Polygone — alles im Browser.

## Quick Start

1. `index.html` im Browser öffnen (funktioniert auch via `file://`)
2. Gebiet festlegen: Polygon auf der Karte zeichnen oder GeoJSON-Datei hochladen
3. Parameter anpassen (optional)
4. "Kompletten Prozess starten" klicken
5. Ergebnis im Editor bearbeiten oder als Standalone-HTML exportieren

## Schritt für Schritt

### Schritt 1: Gebiet festlegen

**Auf Karte zeichnen** — Mit dem Polygon-Werkzeug (Leaflet Draw) ein Gebiet auf der Karte markieren. Das Polygon kann nachträglich bearbeitet oder als GeoJSON heruntergeladen werden.

**Datei hochladen** — Eine bestehende `.geojson`- oder `.json`-Datei per Drag & Drop oder Klick hochladen. Es wird das erste Polygon-Feature verwendet.

### Schritt 2: Parameter

Alle Parameter werden automatisch im `localStorage` gespeichert und beim nächsten Besuch wiederhergestellt.

| Parameter | Beschreibung | Bereich | Standard |
|---|---|---|---|
| Neigung (Tilt) | Blickwinkel auf die Gebäude. 0° = Draufsicht, 90° = seitlich | 0–90 | 45 |
| Rotation | Dreht die gesamte Ansicht. 0° = Norden oben | 0–360 | 0 |
| 3D-Tiefe | Höhe der 3D-Extrusion (Pseudo-3D-Effekt) | 1–12 | 4 |
| Breite (px) | Breite des gerenderten Bildes in Pixeln | 800–4000 | 2000 |
| Höhe (px) | Höhe des gerenderten Bildes in Pixeln | 600–3000 | 1150 |
| Dachfarbe | Farbe der Gebäudedächer | Hex-Farbe | #cccccc |
| Kantenfarbe | Farbe der Gebäudekanten und Umrisse | Hex-Farbe | #333333 |
| Min. Gebäudefläche (px) | Filtert Gebäude kleiner als dieser Wert (Bildpixel) | 0–1000 | 25 |
| Polygon-Vereinfachung | Vereinfacht Polygone zu konvexen Hüllen | An/Aus | An |

### Schritt 3: Pipeline ausführen

- **Kompletten Prozess starten** — Lädt Gebäude von OpenStreetMap herunter, rendert die 2.5D-Ansicht und extrahiert Polygone.
- **Nur Rendering neu starten** — Verwendet die gecachten OSM-Daten und rendert nur neu. Bestehende Gebäude-Metadaten (Name, Gruppe, Beschreibung) werden per Centroid-Matching übernommen.

### Ergebnis

Nach Abschluss stehen folgende Optionen zur Verfügung:
- **Editor öffnen** — Startet den Gebäude-Editor (`editor.html`)
- **Standalone HTML** — Exportiert eine einzelne HTML-Datei mit eingebettetem Bild und Viewer
- **JSON herunterladen** — Lädt die Gebäude-Polygone als JSON
- **Bild herunterladen** — Lädt das gerenderte PNG-Bild

## Editor

Der Editor (`editor.html`) ermöglicht die Bearbeitung der extrahierten Gebäude:

- **Auswählen**: Gebäude in der Seitenleiste oder auf der Karte anklicken
- **Bearbeiten**: Name, Gruppe, Beschreibung und Highlight-Farbe ändern
- **Gruppen**: Verschachtelte Gruppen mit ` > ` trennen (z.B. `Verwaltung > Hauptgebäude`)
- **Reihenfolge**: Gebäude per Drag & Drop in der Seitenleiste umsortieren
- **Duplizieren**: Erstellt eine Kopie mit gleichem Polygon
- **Löschen**: Entfernt ein Gebäude unwiderruflich
- **Speichern**: Lädt eine JSON-Datei mit allen Änderungen herunter
- **Karte Anzeigen**: Öffnet den Viewer-Modus in einem neuen Tab

## Datenformate

### GeoJSON-Eingabe

Die Pipeline akzeptiert Standard-GeoJSON mit Polygon-Geometrie:

```json
{
  "type": "Polygon",
  "coordinates": [[[lon, lat], [lon, lat], ...]]
}
```

Auch `Feature`, `FeatureCollection` und `MultiPolygon` werden unterstützt (erstes Polygon wird verwendet).

### Gebäude-JSON-Ausgabe

```json
{
  "image": {
    "filename": "rendered.png",
    "width": 2000,
    "height": 1150,
    "dataUrl": "data:image/png;base64,..."
  },
  "buildings": [
    {
      "id": "building_0",
      "name": "Gebäude 0",
      "gruppe": "Unbekannt",
      "beschreibung": "",
      "highlightColor": "#FF6B6B",
      "polygon": [[0.1, 0.2], [0.15, 0.2], ...],
      "centroid": [9.123, 48.456]
    }
  ]
}
```

Polygon-Koordinaten sind auf [0, 1] normiert relativ zur Bildgröße. `centroid` enthält die geographische Position (Lon/Lat) für die Migration.

## Migration bei Neurendering

Beim "Nur Rendering neu starten" werden Metadaten bestehender Gebäude per Centroid-Matching (Haversine-Distanz, Schwelle: 15 m) auf die neuen Polygone übertragen. So bleiben Name, Gruppe, Beschreibung und Farbe erhalten, auch wenn sich die Polygon-Form durch geänderte Render-Parameter ändert.

## Technische Hinweise

- Funktioniert komplett clientseitig, auch via `file://`-Protokoll
- Alle Abhängigkeiten (Leaflet, Leaflet Draw) werden von CDN geladen
- Parameter und GeoJSON werden im `localStorage` persistiert
- Gebäude-Daten werden zwischen Pipeline und Editor via `sessionStorage` übergeben
- Kartenhintergrund: OpenStreetMap-Tiles
- Gebäude-Daten: Overpass API (mit automatischem Retry bei Rate-Limiting)
- Tooltips: Einheitliches JS-basiertes Tooltip-System (`#tooltip`) für Info-Icons (`.info-tip`) und Button-Tooltips (`data-tooltip`), das sich automatisch innerhalb des Viewports positioniert
