# ZIP-Datenversorgung · Prüfung 17.10.2026

App-Version 13.45, ohne Skogsstyrelsen-API-Aufrufe.

- 98 Node-Prüfungen und 26 Python-Prüfungen bestanden.
- GitHub-Pages-Unterverzeichnis: App-Installation, Startadresse, erforderliche
  Module und Offline-Navigation zusätzlich geprüft.
- Echter GeoTIFF-Vergleich mit einem 8,208-ha-Testausschnitt bei Sarvisvaara:
  Vorrat, mittlere Höhe, Durchmesser und Grundfläche stimmen zwischen direkter
  Python-Auswertung und der lokalen JavaScript-Auswertung überein.
- Echte Baumartenwerte aus SLU Trädslag 2018 zusätzlich unabhängig geprüft:
  native 10-m- und 12,5-m-Zellen auf ihrem gemeinsamen 2,5-m-Untergitter,
  exakte Randschnittflächen, Volumengewichtung, sieben Baumartengruppen und
  gemeinsame gültige Fläche stimmen überein.
- 36 Kacheln und 36 Quellen für einen 6 × 6 km großen öffentlichen
  Datenausschnitt. Dieser Ausschnitt ist keine Grundstücksgrenze.
- UI-Ablauf Auswerten → Prüfen → Übernehmen getestet; Offline-Neustart mit
  gecachten Datendateien, relativer GitHub-Pages-Pfad, Hintergrund-Worker und
  Erhalt des Daten-Caches bei App-Updates geprüft.
- NoData, neuere ungeschätzte Nullwerte, Löcher, MultiPolygone, teilweise
  Abdeckung, fehlende Kacheln, echte Maßeinheiten und unverfälschte Quellenjahre
  abgedeckt. Alter und Standortindex erfordern die fachliche Auswahl des Nutzers.

Die SLU-2015-Originale reichen nicht bis Sarvisvaara. Die regionale Ergänzung
SLU Trädslag 2018 (Satellitenbilder 2017–2019) schließt diese Datenlücke. Ihre
Prozentanteile werden mit dem verfügbaren Grunddatenvorrat auf exakten
Raster-Schnittflächen gewichtet. Das Ergebnis ist eine Modellschätzung mit
unterschiedlichen Datenständen; Durchforstung nach der Aufnahme ist zu ergänzen.

Die UI-Prüfungen laufen mit echtem Leaflet in einem simulierten Browser. Ein
Praxistest der neuen ZIP-Auswertung auf dem iPhone steht nach Veröffentlichung
noch aus. Es wurden keine produktiven Bestandsdaten überschrieben.

GitHub Pages veröffentlicht aus dem Zweig `lignum-harvester`. Änderungen an
`main` allein aktualisieren diesen öffentlichen App-Link nicht. Die vorhandenen
Harvester-Änderungen werden bei der Veröffentlichung beibehalten.
