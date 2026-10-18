# Forstplanung mit ZIP-Daten · ab 13.45

Die aktive Datenquelle ist dateibasiert. Beim Öffnen der Forstplanung wird die
Skogsstyrelsen-API weder geprüft noch aufgerufen. Ausgewertete GeoJSON-/CSV-Dateien
können neue Bestände anlegen oder nach Prüfung die Kennzahlen bestehender Nummern ersetzen.
Zusätzlich kann die App vorbereitete regionale Rasterpakete direkt am Gerät auswerten.

## Benötigte Quellen

Der Downloadkatalog wird aus der offiziellen Seite
<https://www.skogsstyrelsen.se/laddanergeodata> und deren Atom-Feeds ermittelt:

- Volumen, mittlere Höhe, mittlerer Durchmesser und Grundfläche aus Omdrev 2 und 3.
  Omdrev 3 ist noch nicht flächendeckend. Omdrev 1 bleibt als historischer Fallback verfügbar.
- Bestandsmittelalter 2025: Birke, Mischwald, Fichte, Kiefer und übriges Laubholz.
  Dies sind verschiedene Modellvarianten; nicht ungeprüft zu einem gemeinsamen Alterswert mischen.
- Standortindex SIS für Fichte und Kiefer, passend zur Baumart.
- SLU Skogskarta: Gesamtvolumen sowie Kiefer, Fichte, Birke, Contorta, Eiche, Buche und übrige Arten.

Die Katalogüberschrift stammt von der offiziellen Downloadseite. Einige Feed-Titel
enthalten veraltete Begriffe wie P95. Län-Ziffern am Dateinamen sind keine Aufnahmejahre.
Änderungsdatum des Archivs und Feed-Datum sind ebenfalls keine Aufnahmejahre. Rohangaben
zu Rechten werden mitgeführt; für die Verwendung gelten die aktuellen Produktbedingungen.

## Katalog und Downloads

Das Werkzeug benötigt nur Python 3.11+ und verwendet keine Berechnungs-API oder API-Schlüssel:

```sh
python tools/forest_downloads.py catalog --output /daten/catalog.json --cache-dir /daten/feeds
python tools/forest_downloads.py probe --catalog /daten/catalog.json --county 25 --output /daten/groessen.json
python tools/forest_downloads.py download --catalog /daten/catalog.json --county 25 --destination /daten/zip
```

`25` steht für Norrbotten; es ist nur ein Befehlsbeispiel, keine Zuordnung zu den echten
Waldflächen des Betreibers. Mehrere Län: `--county 24 25`. `--national` wählt stattdessen
landesweite Archive. Landes- und Län-Archive nicht doppelt laden. Einige nationale
SLU-Links sind im Feed aufgeführt, liefern jedoch 404; dafür die Län-Archive verwenden.
`--datasets volume_omdrev3 height_omdrev3 diameter_omdrev3 basal_area_omdrev3` grenzt die
Datentypen ein. `--include-historical` nimmt auch Omdrev 1 auf.

Vollständige Archive werden erst nach Größen-, ZIP-CRC- und SHA-256-Prüfung freigegeben.
Eine `.receipt.json` dokumentiert Quelle, Downloadzeit, Dateigröße und Prüfsumme. Fehler
bleiben in `download-status.json` sichtbar; ein Katalogeintrag ist kein abgeschlossener
Download. Abgebrochene Transfers können bei unveränderter ETag fortgesetzt werden.
Fehlende Archive oder unzureichender Speicher führen zu einer Fehlermeldung.

Die großen Dateien gehören auf einen dauerhaften Datenspeicher außerhalb des Git-
Repositories. Ein lokaler Download bzw. eine gesicherte Kopie ist noch kein laufender
Rasterdienst für die Web-App. Für die Auswertung werden außerdem echte Flächengrenzen
benötigt; die Treebula-Beispielkarten werden nicht als Betriebsgrenzen verwendet.

## Auswertung und Import

ZIPs können direkt mit `tools/forest_rasters.py` gelesen werden, ohne sie auszupacken.
Bei mehreren TIFFs muss die Datei innerhalb der ZIP explizit gewählt werden. Beispiel:

```sh
python -m pip install -r tools/forest-raster-requirements.txt
python tools/forest_rasters.py --stands lignum-bestaende.geojson \
  --volume /daten/zip/volumen.zip --height /daten/zip/hoehe.zip \
  --height-scale 0.1 --source 'Skogsstyrelsen · Rasterimport' --output auswertung.geojson
```

Skalierung und Aufnahmejahr müssen aus den Produktmetadaten kommen. `--height-scale 0.1`
gilt nur für Höhen in Dezimetern. Ein Raster für einen ganzen Aufnahmezyklus hat nicht
zwangsläufig ein einheitliches Jahr. Ohne gesichertes Jahr bleibt es unbekannt.

Für die Vier-Gruppen-Anzeige in Lignum sind alle Baumartenvolumen erforderlich. Zusätzliche
Arten müssen vorab auf demselben Gitter fachgerecht zur Gruppe „Weitere Baumarten“
zusammengeführt werden. Die vorhandene Rasterauswertung übernimmt keine automatische
Aggregation verschiedener Zusatzarten. Die Ausgabe anschließend unter **Daten importieren**
bzw. **Rasterauswertung importieren** prüfen und übernehmen.


## Direkt in der App auswerten · 13.46

Der geprüfte Katalog `data/forest-sources-norrbotten.json` umfasst 30 ZIPs
(ca. 10,01 GB) für Norrbotten: Grunddaten aus Omdrev 2/3, fünf Altersmodelle,
beide SIS-Modelle, SLU-Gesamtvolumen und alle sieben Baumartengruppen,
zusätzliche historische SLU-Kennzahlen sowie klassierte Bodenfeuchte.
Der allgemeine Feed-Downloader oben bleibt für weitere Regionen verfügbar.
Für diesen eingefrorenen, größenkontrollierten Katalog gibt es den Batch-Befehl:

```sh
python tools/download_forest_data.py \
  --catalogue data/forest-sources-norrbotten.json \
  --destination /daten/lignum/norrbotten --workers 4
python tools/pack_forest_rasters.py \
  --downloads /daten/lignum/norrbotten \
  --bounds 780000 7413000 790000 7423000 \
  --output data/forest-rasters
```

`download-report.json` hält je ZIP Dateigröße, SHA-256, Rastermitglieder und
CRC-Werte fest. Die regionalen JSON-Kacheln enthalten unveränderte native
Rasterzellen, Quelle, Einheit und Datenstand. Der erweiterte Ausschnitt umfasst
10 × 10 km (100 Kacheln) um Sarvisvaara einschließlich des westlichen und
nördlichen Umfelds. Dieser Datenausschnitt ist keine Grundstücksgrenze. Andere Gebiete benötigen ein entsprechend vorbereitetes
und ausgeliefertes regionales Paket. Die großen ZIPs werden nicht in Git oder
auf das Handy geladen.

**Forstplanung → Bestand mit Grenze → ZIP-Daten auswerten.** Bei Bedarf die
Alterskarte und standortanzeigende Baumart wählen, Ergebnis prüfen und
**Kennzahlen übernehmen**. Geladene Ausschnitte bleiben im eigenen Offline-Cache
auch bei App-Updates erhalten. Vor dem ersten Offline-Einsatz jeden benötigten
Bestand einmal online auswerten. Die Berechnung läuft auf unterstützten Geräten
in einem Hintergrund-Worker und blockiert die Karte nicht.

Die neue Auswertung berücksichtigt Schnittflächen einzelner Zellen mit Polygonen,
Aussparungen und MultiPolygonen. Vorrat/Höhe/Durchmesser/Grundfläche verwenden
Omdrev 3, bei NoData Omdrev 2; ein beobachteter Nullwert des neueren Durchgangs
blockiert ältere Werte. Historischer SLU-Vorrat wird nicht automatisch eingesetzt.
Nicht ausgewertete Flächen werden nicht hochgerechnet. Fehlende benötigte
Kacheln brechen die Berechnung ab, statt ein unbemerkt unvollständiges Ergebnis
zu liefern. Baumartenanteile verwenden gemeinsame gültige Zellen aller sieben
Gruppen; Contorta, Eiche, Buche und weiteres Laubholz gehören zu „Weitere“.

Die Alterskarte erfordert den tatsächlichen Waldtyp: mindestens 65 % Grundfläche
für eine dominierende Baumart, sonst Mischwald. Die älteren SLU-Volumenanteile
allein ersetzen diese Information nicht. Die SIS-Baumart muss standortanzeigend
sein; sie kann von der häufigsten Baumart abweichen. Alter hat Bezugsjahr 2025,
Baumarten stammen aus dem Produkt SLU Skogskarta 2015. Ein Produkt- oder
Downloadjahr wird nicht als tatsächliches Aufnahmejahr ausgegeben. Alterswerte
unterschätzen ältere Bestände. Eingriffe nach der Aufnahme sind zu ergänzen.

Quellen: Skogsstyrelsen / SLU, insbesondere Skogliga grunddata,
Beståndsmedelålder 2025, Ståndortsindex SIS, SLU Skogskarta.
Bearbeitung: regionaler Ausschnitt, verlustfreie Packung, flächengewichtete
Auswertung. Alter und SIS: <https://creativecommons.org/licenses/by/4.0/>; weitere Quellen
nach den [Originalbedingungen](https://www.skogsstyrelsen.se/e-tjanster-och-kartor/karttjanster/geodatatjanster/villkor/).


Bei einem einzelnen großen Restdownload können sechs parallele, exakt geprüfte
Bytebereiche genutzt werden, ohne mehr als sechs Verbindungen zu öffnen:

```sh
python tools/download_forest_data.py \
  --catalogue data/forest-sources-norrbotten.json \
  --destination /daten/lignum/norrbotten --workers 1 --segments 6
```

Immer nur einen Downloadprozess für dasselbe Zielverzeichnis betreiben. Die
Bereiche werden in der richtigen Reihenfolge angehängt; abgebrochene Präfixe
und fertige Bereiche können wiederverwendet werden.


## Ergänzung für Sarvisvaara: SLU Trädslag 2018

Die Originalraster von SLU Skogskarta 2015 für Norrbotten enden bei Nordkoordinate
7.400.000 und decken die Kartenposition bei Sarvisvaara nicht ab. Deshalb ergänzt
Lignum die landesweite SLU-Baumartenkarte Trädslag 2018:
<https://gis.slu.se/data/slu_forest_map/2018/>. Laut Produktdokumentation beruhen die
Volumenanteile überwiegend auf Sentinel-2-Bildern von 2018, stellenweise 2017/2019.

```sh
python tools/clip_slu_species.py \
  --destination /daten/lignum/norrbotten/species2018 \
  --bounds 780000 7413000 790000 7423000
```

Das Werkzeug liest native Zellen der sieben öffentlich herunterladbaren GeoTIFFs
über HTTP-Dateibereiche. Es verwendet keine Berechnungs-API und lädt keine vollständigen
nationalen GeoTIFFs auf das Handy. Die Ausschnitte, Prüfsummen, Quelllinks und
Originaldokumentation werden zusätzlich als `SLU-2018-Sarvisvaara.zip` gesichert.
Das Paketwerkzeug findet `species2018/report.json` im Downloadverzeichnis automatisch.

Bei vorhandener 2018-Ergänzung verwendet die App diese statt der älteren Baumartenraster.
Die gerundeten Prozentanteile werden pro Zelle normalisiert und mit dem verfügbaren
Grunddatenvorrat gewichtet. Schnittflächen zwischen dem 12,5-m-Baumartenraster und dem
10-m-Vorratsraster werden exakt berechnet; Abdeckung meint gemeinsame gültige Fläche.
Damit werden Flächenanteile nicht fälschlich als Volumenanteile interpretiert.
Quelle, Bildzeitraum 2017–2019 und die Gewichtung bleiben am Ergebnis sichtbar.
Die Werte sind Modellschätzungen mit unterschiedlichen Datenständen, keine aktuelle
Inventur nach euren letzten Eingriffen.


## Korrekturen in 13.46

Der Datenindex wird online frisch geladen; bei einem Netzausfall wird der zuletzt
geprüfte Offline-Index verwendet. Ein alter App-Cache darf ein neu ausgeliefertes
Regionalpaket nicht verdecken. Fehlgeschlagene Cache-Zugriffe verhindern die
Online-Auswertung nicht. Der ZIP-Dialog zeigt die regionale Abdeckung und
Fehlermeldungen direkt an. Außerhalb des Regionalpakets sind weitere Ausschnitte
vorzubereiten; die landesweiten Originalarchive werden nicht auf das Handy geladen.

Die Karte reagiert auf die tatsächliche Containergröße, auch nach zunächst
verdecktem Start, erneutem Öffnen oder einem Wechsel der Ausrichtung. Fehlgeschlagene
Hintergrundkacheln erhalten einen begrenzten automatischen Wiederholungsversuch;
zusätzlich gibt es Erneut laden und eine Straßenkarte.

Raster-Schnittflächen werden in lokalen, an den Kacheln ausgerichteten Koordinaten
berechnet. Das vermeidet numerische Polygonfehler bei Grenzen genau auf Rasterlinien.
Die originalen Zellwerte und die exakten Grenzflächen bleiben erhalten.
