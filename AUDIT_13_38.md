# Lignum 13.38 — Polter innerhalb einer Erntefläche

## Fehler und Korrektur

Das gespeicherte Ernteflächen-Polygon hatte ein Popup auf der gesamten Innenfläche. Leaflet stoppte beim Öffnen dieses Popups das Klickereignis, sodass das Polterformular den Kartentipp nicht erhielt.

- Die sichtbare Erntefläche ist jetzt nicht interaktiv. Kartentipps innerhalb der Fläche erreichen das bestehende Polterformular, auch auf einem gespeicherten Abfuhrweg.
- Nur eine schmale Trefferlinie am Flächenrand öffnet die Erntedaten. Dort gibt es im Harvester-/Forwarder-Modus zusätzlich „Polter hier anlegen“ mit den Koordinaten des Randklicks. Bereits eingegebene Polterdaten bleiben erhalten.
- Fläche und Rand gehören zu einer gemeinsamen Layergruppe; Neuladen und Löschen entfernen beide. Die Hervorhebung beim Admin-Sprung ändert nur die sichtbare Fläche.
- Neue Ernteflächen verwenden dieselbe Darstellung unmittelbar nach dem Speichern. Zeichen-/GPS-Vorschauen blockieren keine Kartentipps; beim manuellen Zeichnen werden vorhandene Flächenränder durchlässig.
- Flächennamen werden im Popup escaped; Aktionen verwenden DOM-Ereignisse statt zusammengesetzter Inline-Handler.
- App und Service Worker haben Version 13.38, damit die Korrektur über ein reguläres App-Update verfügbar wird.

## Prüfung

- `node --test tests/*.test.cjs`: 39 bestehende Regressionstests bestehen.
- `tests/map-interactions.dom.cjs`: acht zusätzliche DOM-Integrationstests bestehen, darunter die ursprüngliche Klickblockade als Kontrollfall, Polter innerhalb der Fläche, Rand-Popup/-Position, Erhalt eingegebener Daten, sichere Flächennamen, bestehende Polter-Popups, erneutes Zeichnen/Speichern und Entfernen alter Layer.
- Die DOM-Tests verwenden Leaflet 1.9.4, dessen CSS und die unveränderten Anwendungsfunktionen in jsdom 26.1.0. jsdom hat kein natives SVG-Hit-Testing; das Klickziel wird anhand der tatsächlichen CSS-`pointer-events` gewählt. Diese Tests ersetzen keinen iPhone-/Safari-Test.
- JavaScript-Syntaxprüfung bestanden. Keine Änderung an Datenbank oder Offline-Synchronisierung.

Die DOM-Prüfung lässt sich mit einer temporären Testabhängigkeit ausführen:

```sh
npm install --prefix /tmp/lignum-map-tests --no-package-lock --ignore-scripts jsdom@26.1.0
LIGNUM_TEST_JSDOM=/tmp/lignum-map-tests/node_modules/jsdom node --test tests/map-interactions.dom.cjs
```

Für einen Offline-Test kann `LIGNUM_TEST_LEAFLET` auf eine lokal gespeicherte `leaflet.min.js` zeigen; daneben muss `leaflet.min.css` liegen.

## Praxistest

Der Nutzer hat am 1. Oktober 2026 den Polter-/Synchronisations-Praxistest von Version 13.37 als funktionierend bestätigt. Für die neue Karteninteraktion: Version 13.38 online laden, innerhalb der bestehenden Erntefläche auf den Abfuhrweg tippen und einen Polter speichern. Am Flächenrand bleiben die Erntedaten erreichbar; „Polter hier anlegen“ übernimmt dort den angetippten Standort.
