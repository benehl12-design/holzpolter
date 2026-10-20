# Forstplanung · ab Lignum 13.44

**Ab 13.45 ist Dateibetrieb aktiv.** Einrichtung und Downloadwerkzeug stehen in
[ZIP-DATEN.md](ZIP-DATEN.md). Die unten beschriebene API-Anbindung bleibt vorbereitet,
wird aber in der Oberfläche nicht mehr verwendet. „ZIP-Daten auswerten“ arbeitet
mit den lokal vorbereiteten Rasterausschnitten.

Die Kachel **Forstplanung** öffnet Grundstücke, Bestände und Maßnahmen. Admins können
bearbeiten; Mitarbeiter desselben Betriebs können die Planung ansehen. Die bestehenden
Polter-, Maschinen- und Auftragsfunktionen bleiben eigenständige Arbeitsansichten.

## Direkt auswerten · ab 13.48

- **Fläche auswerten**: Grenzpunkte setzen, **Walddaten anzeigen** wählen,
  bei Bedarf Alterskarte und Standortbaumart festlegen und **Auswerten** drücken.
  Dafür muss kein Grundstück oder Bestand angelegt werden.
- Bestehende Grenzen aus der normalen Polterkarte erscheinen gelb gestrichelt.
  Grenze anklicken oder **Vorhandene Flächen** öffnen, dann **Walddaten anzeigen**.
  Ab 13.49 erscheinen zusätzlich alle importierten Grundstückspolygone aus `geojson_layers` mit ihren Originalfarben und Flurstücksnamen. Lokal noch nicht gespeicherte Importe desselben Benutzers und Betriebs werden ebenfalls angezeigt. Polygonlöcher und MultiPolygone bleiben erhalten.
  Es werden dieselben betriebseigenen `areas` und `geojson_layers` gelesen, keine Grundstücke automatisch
  kopiert. Beim Öffnen und Aktualisieren werden die Grenzen neu geladen.
- Die Ergebnisse enthalten Kennzahlen, Baumarten, Quellen und Abdeckung. Eine
  geänderte Grenze verwirft das bisherige temporäre Ergebnis. Außerhalb des
  regionalen Datenpakets stehen weiterhin keine Rasterwerte zur Verfügung.
- **Optional speichern** öffnet für Admins die Zuordnung zu einem Grundstück.
  Bei einem neuen Grundstück folgt nach dessen Speicherung das Bestandsformular
  mit vorausgefüllter Grenze und Auswertung. Erst das jeweilige **Speichern**
  schreibt Daten. Abbrechen der Auswertung legt keine Datensätze an.
- Mitarbeiter können freie Flächen auswerten; dauerhaft speichern dürfen Admins.
  Ungespeicherte Auswertungen sind temporär und überleben keinen App-Neustart.
  Die vorhandene Offline-Datenversorgung gilt auch für die direkte Auswertung.

## Dauerhafte Planung (optional)

1. Grundstück anlegen, Name/Grundstücksbezeichnung und Fläche angeben. Grenze zeichnen
   oder eine einzelne Polygon-/MultiPolygon-Fläche als GeoJSON hochladen.
2. Bestände zeichnen, manuell anlegen, aus bestehenden Lignum-Gebieten übernehmen oder
   als GeoJSON/CSV importieren. Importvorschau vor dem Übernehmen prüfen.
3. Bestandsdaten und ihre Quelle ergänzen. Kartenfarben nach Bestandsklasse, Alter,
   dominierender Baumart oder Vorrat wählen. Ein Antippen öffnet das Datenblatt.
4. Maßnahme und Entnahme festlegen. **Auftrag vorbereiten** überträgt Daten in das
   vorhandene Auftragsformular; erst dessen Speichern legt den Auftrag an.

Bestandsflächen dürfen sich nicht überlappen oder außerhalb einer vorhandenen
Grundstücksgrenze liegen. Auch die Summe darf die Grundstücksfläche nicht überschreiten.
Die Grenzprüfung läuft im Client; gleichzeitige neue Bestände mehrerer Admins sollten
anschließend gemeinsam geprüft werden. Bereits geladene Daten und Änderungen sind über
den vorhandenen kontogebundenen Offline-Speicher verfügbar. Satellitenbilder benötigen
separat gespeicherte Kartenkacheln. Neue externe Grunddaten lassen sich nur online abrufen.

## Was jetzt verfügbar ist

- Grundstücke und nummerierte Bestände mit eigenen Grenzen und Notizen.
- Wald, unproduktiver Wald, Moor, Wasser, Landwirtschaft und sonstige Flächen.
- Vorrat m³sk und m³sk/ha, ausgewertete Fläche, Höhe m, Durchmesser cm, Grundfläche m²/ha,
  Alter, Standortindex T/G, Baumartenanteile, Aufnahme-/Bezugs-/Fortschreibungsjahr.
- Grundstückssummen, Flächennutzung, Alters- und Baumartenverteilung mit Datenabdeckung.
- GeoJSON/CSV-Import, GeoJSON-Export der Bestände und Grundstücksgrenze.
- Entnahme/Restvorrat, optionale lineare Zuwachsannahme und Bruttoerlösannahme in SEK.
  Ein Preis in SEK/m³fub muss fachgerecht umgerechnet werden, bevor er als SEK/m³sk
  eingetragen wird. Es gibt keine automatische Grundstücksbewertung oder Bonitäts- bzw.
  Zuwachsberechnung aus dem Standortindex.

Die Treebula-Bilder waren Funktionsbeispiele. Es wurden keine Beispielgrenzen oder
Zahlen daraus als echte Betriebsdaten angelegt. Bestandsgrenzen sind auch keine
amtlichen Eigentumsgrenzen. Baumarten-, Alter- und Standortindexraster müssen passend zur
Region, Baumart und zum Datenstand gewählt werden; Dateisuffixe können Kreisnummern sein.

## Automatischer Grunddatenabruf

Der bereitgestellte Supabase-Endpunkt `forest-data` nutzt die offizielle
**Skogliga grunddata API 1.1** für `Volym`, `Medelhojd`, `Medeldiameter` und `Grundyta`.
Die Version 1.0 wird nicht verwendet. Der Abruf erwartet WGS84-GeoJSON, wandelt die Grenze
nach SWEREF99 TM (EPSG:3006) um und fordert `marktyper: ["AllSkogsmark"]` an. Es wird die
standardmäßig verfügbare Aufnahme verwendet, keine stillschweigende Fortschreibung.

Für echte Abrufe fehlen noch vom Betreiber bereitzustellende API-Zugangsdaten:

1. [API-Zugang bei Skogsstyrelsen beantragen](https://www.skogsstyrelsen.se/e-tjanster-och-kartor/karttjanster/geodatatjanster/skogsstyrelsens-api/).
2. Im Supabase-Projekt unter **Edge Functions → Secrets** `SKOGS_CLIENT_ID` und
   `SKOGS_CLIENT_SECRET` hinterlegen. Keine Zugangsdaten im Frontend oder Repository speichern.
3. In Lignum einen Bestand mit Grenze öffnen, **Grunddaten abrufen**, Vorschau prüfen
   und **Kennzahlen übernehmen**. Der Endpunkt prüft zusätzlich zum Gateway das aktive
   Benutzerprofil und die Adminberechtigung. Mitarbeiter können den Verbindungsstatus lesen.

OAuth verwendet Client Credentials mit Scope `sks_api` und
`https://auth.skogsstyrelsen.se/connect/token`. Die vier Auswertungen laufen serverseitig;
Zugangsdaten und Quelltoken werden nicht an die App zurückgegeben. Fehlt der Zugang,
meldet die App das ausdrücklich. Import und manuelle Erfassung funktionieren trotzdem.
Die echte Auswertung mit Kunden-Zugangsdaten ist bis zu deren Einrichtung nicht geprüft.

## ZIP-/GeoTIFF-Daten aufbereiten

Große Kreis-/Landesraster werden außerhalb des Handys auf die Bestandsgrenzen
zugeschnitten. Das Werkzeug liest ZIPs direkt, ohne sie auszupacken:

```sh
python -m pip install -r tools/forest-raster-requirements.txt
python tools/forest_rasters.py --stands lignum-bestaende.geojson \
  --volume /daten/volumen.zip --height /daten/hoehe.tif --height-scale 0.1 \
  --year 2022 --source 'SLU Skogskarta · Aufnahme 2022' --output angereichert.geojson
```

`--height-scale 0.1` nur verwenden, wenn die Metadaten Dezimeter angeben. Die API liefert
Höhe bereits in Metern. `--year` ist das tatsächliche Bezugsjahr des jeweiligen Rasters,
kein aus dem Dateinamen geratenes Jahr. Unterschiedliche Datenstände in getrennten
Durchläufen ergänzen; die Herkunft bleibt je Kennzahl erhalten. Weitere Optionen:
`--diameter`, `--basal-area`, `--age`, `--site-index`, `--site-species T|G` und
`--pine --spruce --birch --other` (alle vier zusammen, gleiches Rastergitter und gleiche
Einheiten; zusätzliche Arten vorab fachgerecht zur Gruppe `other` summieren).

Die Eingabe benötigt WGS84-GeoJSON, die Raster ein projiziertes Koordinatensystem in
Metern. Mehrere TIFFs in einer ZIP: `/daten/datei.zip!ordner/auswahl.tif` angeben.
Es werden anteilige Zellflächen und NoData berücksichtigt. Der Standard behandelt 0
als nicht ausgewertet, wie bei entsprechenden Jungbestandsdaten. `--include-zero` nur
nutzen, wenn die Quellmetadaten 0 ausdrücklich als gültigen Schätzwert definieren.
Bei Baumarten sind einzelne Nullanteile gültig; alle vier Raster müssen am selben
Pixel auswertbar sein. Vollständig ungeschätzte Zellen bleiben ausgeschlossen.

`--auto-stands --age /daten/alter.tif` kann aus einer Grundstücksgrenze vorläufige
zusammenhängende Altersklassen bilden. Das ersetzt keine forstliche Bestandsabgrenzung.
Nicht abgedeckte Bereiche bleiben als **ungeklärte Restfläche** erhalten. Grenzen und
Flächenart vor dem Einsatz prüfen. Höchstens 300 Bestände und 2.500 Grenzpunkte je Bestand.

Der App-Import erkennt vorhandene Bestandsnummern innerhalb des ausgewählten Grundstücks.
Bei gleicher Grenze/Fläche können deren **Kennzahlen ersetzt** werden. Die Vorschau nennt
alle Zuordnungen und verlangt dafür eine ausdrückliche Bestätigung; fehlende Kennzahlen
werden dann unbekannt. Vorhandene Grenzen, Namen, Notizen und Maßnahmen bleiben erhalten.
Abweichende Flächen oder Grenzen blockieren das Ersetzen. Neue Nummern werden als neue
Bestände angelegt. So können exportierte Bestände nach einer Rasterauswertung wieder
importiert werden, ohne Duplikate zu erzeugen.

## Datenformate und Berechnung

CSV nutzt exakte Feldnamen, Hektar sowie m³sk und kann Semikolon/Dezimalkomma verwenden:

```csv
number;name;area_ha;land_type;hk_class;volume_m3sk_ha;age_years;reference_year;pine_pct;spruce_pct;birch_pct;other_pct
1;Beispiel;3,1;forest;G2;200;50;2022;60;30;10;0
```

Leere Felder bleiben unbekannt. GeoJSON erlaubt WGS84 oder explizit EPSG:3006;
Kennzahlen stehen in `properties.inventory`. Grenzen in GeoJSON: Längengrad, Breitengrad.
Volumen wird mit der tatsächlich ausgewerteten Vorratsfläche multipliziert; fehlen deren
Angaben, gilt die ganze Bestandsfläche. Kein Ersetzen von NoData durch 0, keine
Hochrechnung des Vorrats auf unbekannte Teilflächen. Die Altersverteilung berücksichtigt
die Rasterabdeckung. Bei nur teilweiser Baumartenabdeckung wird der Bestand nicht in die
aufsummierte Baumartenverteilung aufgenommen. Einzelne Mittelwerte und Kartenfarben
sind weiterhin Schätzungen der jeweils ausgewerteten Zellen.

## Betrieb und Prüfung

Schema: `supabase/lignum_forest_planning.sql`, Endpunkt:
`supabase/functions/forest-data/`. Firmenzuordnung, Adminrechte, RLS, Fremdschlüssel,
Kennzahl-Validierung und Zeitstempel liegen zusätzlich in der Datenbank. Ein Online-Update
einer unveränderten, bereits synchronisierten Zeile prüft `updated_at`, um zwischenzeitliche
Änderungen zu erkennen. Bei Konflikten neu laden und die Werte vergleichen. Offline
erfasste Änderungen werden in Warteschlangenreihenfolge abgeglichen; parallele Bearbeitung
derselben Bestandsdaten ist zu vermeiden.

```sh
node --test tests/*.test.cjs
# Für die DOM-Tests zusätzlich jsdom 26.1.0 installieren:
LIGNUM_TEST_JSDOM=/absolut/node_modules/jsdom node --test tests/*.dom.cjs
python -m unittest discover -s tests -p 'test_forest_rasters.py'
```

Die DOM-Tests nutzen echtes Leaflet mit simuliertem Browser, die Rastertests echte kleine
GeoTIFFs. Der Serverhandler wird mit simulierten Auth-/Quellantworten getestet. Die SQL-
Regression `tests/forest-permissions.sql` legt ausschließlich transaktionale Testdatensätze
an und rollt sie zurück; sie kann im SQL-Editor ausgeführt werden. Die Automatisierung
konnte diese Fixture-Transaktion nicht ausführen; geprüft wurden live die bereitgestellten
RLS-Regeln, Tabellenrechte und Kennzahl-Constraints. Ein zusätzlicher Praxistest auf dem
iPhone mit echten Grundstücksgrenzen und eingerichtetem Datenzugang steht noch aus.

Offizielle Grundlagen:
[Geodaten](https://www.skogsstyrelsen.se/laddanergeodata),
[Datenqualität](https://www.skogsstyrelsen.se/skogligagrunddata),
[API 1.1](https://www.skogsstyrelsen.se/e-tjanster-och-kartor/karttjanster/geodatatjanster/skogsstyrelsens-api/),
[Konto für Rasterdaten](https://www.skogsstyrelsen.se/e-tjanster-och-kartor/karttjanster/geodatatjanster/anvandarkonto/).
