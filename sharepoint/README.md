# SharePoint-Version

Diese Variante der Building-Extraction-Pipeline ist für den Betrieb innerhalb einer
SharePoint-Dokumentbibliothek gedacht. Sie besteht aus zwei ASPX-Seiten (Viewer und
Editor) und einem `data/`-Unterordner, in dem die Kartendaten gespeichert werden.

## Ordnerstruktur

```
sharepoint/
├── viewer.aspx           Nur-Lese-Ansicht für alle Nutzer
├── editor.aspx           Designer-Oberfläche (Pipeline + Editor)
├── css/style.css         Gemeinsames Styling
├── js/
│   ├── tooltip.js
│   ├── viewer-widget.js
│   ├── app.js            Basis-App (Pipeline, Editor, Rendering)
│   ├── sharepoint-io.js  REST-Schicht (Laden/Speichern, Rollenerkennung)
│   └── app-sharepoint.js Overlay, der die Basis-App an SharePoint anbindet
└── data/
    ├── building.json     Gebäudemetadaten (wird vom Editor erzeugt)
    └── building.png      Gerenderte 2.5D-Karte (wird vom Editor erzeugt)
```

`data/` darf beim ersten Deployment leer sein — die Dateien werden beim ersten
Speichern im Editor automatisch angelegt.

## Deployment: eine neue Karte einrichten

1. **Ordner anlegen** in einer SharePoint-Dokumentbibliothek, z. B.
   `/sites/<portal>/MapApps/<standort>/`.
2. **Gesamten Inhalt** des `sharepoint/`-Verzeichnisses 1:1 in den Zielordner hochladen.
3. **Berechtigungen setzen** auf dem Ziel-Ordner:
   - Alle Nutzer, die die Karte **ansehen** sollen: Leserecht (reicht für `viewer.aspx`).
   - Alle Nutzer, die **bearbeiten** sollen: Schreibrecht (Mitwirken/Bearbeiten). Diese
     Rolle wird vom Editor per `EffectiveBasePermissions` erkannt — keine extra Gruppe nötig.
4. **Seite verlinken** aus einer normalen SharePoint-Seite per Link-Webpart oder direkt
   im Navigationsmenü: Link auf `viewer.aspx` im Zielordner.

## Mehrere Karten im gleichen Portal

Jeder Ordner ist eine eigenständige Instanz. Für eine zweite Karte den `sharepoint/`-Ordner
einfach in ein anderes Zielverzeichnis kopieren:

```
/sites/<portal>/MapApps/standort-a/    ← Karte A
/sites/<portal>/MapApps/standort-b/    ← Karte B
```

`viewer.aspx` und `editor.aspx` lesen und schreiben immer nur relativ zu ihrem eigenen
Ordner (`./data/building.json`). Es gibt keine zentrale Registrierung.

## Wie der Editor funktioniert

1. Designer öffnet `editor.aspx`.
2. `app-sharepoint.js` prüft per REST (`EffectiveBasePermissions`), ob der Nutzer
   Schreibrechte hat. Falls nicht → Redirect auf `viewer.aspx`.
3. Falls `data/building.json` existiert, wird die Karte direkt geladen und der Editor
   geöffnet. Andernfalls startet der Designer mit der leeren Pipeline (Polygon zeichnen
   → Rendern → Bearbeiten).
4. Der "Auf SharePoint speichern"-Button schreibt `building.json` und `building.png`
   via REST zurück in `./data/` (Overwrite). Eine Bestätigung erscheint als Toast.

Download-, Standalone-HTML- und Preview-Funktionen sind im SharePoint-Modus nicht
vorhanden — für die Vorschau dient direkt die `viewer.aspx`-Seite.

## Wie der Viewer funktioniert

`viewer.aspx` lädt bei jedem Aufruf frisch `data/building.json` + `data/building.png`.
Ein Cache-Buster (`?t=<timestamp>`) sorgt dafür, dass nach einem Save vom Designer
sofort die neue Version sichtbar ist. Hat der aufrufende Nutzer Schreibrechte, erscheint
zusätzlich ein "Bearbeiten ›"-Link, der auf `editor.aspx` zeigt.

## REST-Voraussetzungen

- SharePoint REST-API muss erreichbar sein (`/_api/web/...`).
- Die App nutzt sowohl JSON (`application/json;odata=verbose`) als auch XML-Antworten
  (Auto-Fallback in `sharepoint-io.js`) — OData-Verbose darf im Tenant also deaktiviert sein.
- Form-Digest wird dynamisch via `/_api/contextinfo` geholt und gecacht. Klassische
  SharePoint-Seiten mit `<input id="__REQUESTDIGEST">` werden als Fallback ebenfalls unterstützt.

## Migration aus der Hauptversion

Bestehende Karten, die bereits per "Standalone HTML"- oder "SharePoint"-Export aus der
Hauptversion (`index.html`) erzeugt wurden, lassen sich über den "Laden"-Button im Editor
importieren (JSON) — oder einfach per Drag&Drop auf den Upload-Bereich in der Pipeline-Seite.
Nach dem Import wie üblich "Auf SharePoint speichern" klicken.

## Entwicklung lokal

Für die lokale Arbeit an den ASPX-Seiten reicht ein einfacher statischer Web-Server
(z. B. `python -m http.server`). SharePoint-REST ist dann natürlich nicht verfügbar —
`app-sharepoint.js` zeigt eine Toast-Warnung und bleibt im Read-only-Modus. Zum Testen
der REST-Schicht muss die Seite in SharePoint deployed sein.
