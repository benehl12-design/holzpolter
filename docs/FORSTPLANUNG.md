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

## Baumartenbezogener Holzvorrat · ab 13.59

Die Wahl **Altersmodell: Kiefer, Fichte oder Birke** wählt ausschließlich die
passende Altersschätzkarte; sie ist **kein Filter** für den gesamten Vorrat,
die mittlere Höhe, den mittleren Durchmesser oder die Grundfläche. Diese
Kennzahlen gelten unverändert für den ausgewählten Bestand als Ganzes.

Unter **Baumart für die Vorratsanzeige** lassen sich *Kiefer, Fichte, Birke
und weitere Baumarten* vergleichen. Standardmäßig folgt die markierte Baumart
der ausdrücklich gewählten Alterskarte. Die Anzeige enthält zwei getrennte
Ebenen: den Gesamtvorrat aller Baumarten und den **geschätzten Vorrat je
Baumart (m³sk und m³sk/ha)**.

Die Schätzung entsteht aus den Anteilsrastern **SLU Trädslag 2018** (Aufnahmen
2017–2019) und den überlappenden gültigen Omdrev-Gesamtvorratsrasterzellen.
Je Zelle wird der Gesamtvorrat nach normalisierten Anteilen verteilt.
Die **gemeinsam abgedeckte Rasterfläche** ist der Nenner für die Baumartenwerte
je Hektar. Fehlende Rasterzellen werden weder ergänzt noch auf das ganze
Grundstück hochgerechnet. Die älteren, nicht dazu räumlich/zeitlich
verknüpften **SLU-2015-Baumartenraster** liefern weiterhin Anteilswerte,
aber keine als zuverlässig ausgegebenen Baumartenvorräte. 2015-Flächenanteile
werden nie mit 2018-vorratsgewichteten Anteilen zu einem einzigen Mittelwert
vermischt. Ergebnisse sind historische **Schätzwerte**, keine Baumaufnahme
und keine sichere Entscheidung über eine Erntemaßnahme.

Die **Vorratsfarben** zeigen lediglich die relative Dichte gegenüber dem
flächengewichteten Mittel der gültigen Zellen: weniger als 75 %,
75–125 % oder mehr als 125 %. Lignum zeigt diesen Mittelwert in m³sk/ha
an. Eine höhere Vorratsdichte ist keine automatische Ernteempfehlung.

## Schwedische Durchforstungsdiagramme · Version 13.61

Die automatische Forstplanung berechnet für jedes gespeicherte Bestandspolygon sowie
für die auf ZIP-Rasterzellen beruhenden zusammenhängenden Prüfbereiche eine
**modellgestützte Grundflächen-Entnahmestärke**, soweit die Daten reichen.

- Grundlage: **Skogforsk hprYield 2024, Bilaga 14 / INGVAR**.
  Für Kiefer (T14–T30) und Fichte (G16–G40) verwendet Lignum die
  dokumentierten artspezifischen Standortindex-Koeffizienten
  `B_ober = c + k * ln(Oberhöhe)`; die untere Bandgrenze ist `0,60 * B_ober`.
  [Originalbericht, Anhang 14](https://www.skogforsk.se/contentassets/2d0af30a469b4500b5cf61cef2ad4ca6/arbetsrapport-1228-2024-hpryield--berakningsmodul-for-generering-av-geografiskt-uppdelade-nyckeltal-baserade-pa-skordardata.pdf).
- **Eigene Planungsregel von Lignum**, nicht Teil der INGVAR-Formel: Zielwert
  `0,80 * B_ober` nach Eingriff; maximal 35 % Grundflächenentnahme in G1
  und 30 % in anderen Durchforstungen. Bei überschrittener Höchstgrenze
  wird ein Hinweis auf vorsichtiges mehrstufiges Vorgehen angezeigt.
  Dies ist keine belegte optimale Eingriffsstärke, sondern ein überprüfbarer,
  konservativ begrenzter Szenariowert.
- Der Standortindex stammt – sofern vollständig verfügbar – schon aus
  dem örtlichen Rasterpaket (Skogsstyrelsen, site_pine/site_spruce), oder
  wird im Bestandsdatenblatt manuell als T- bzw. G-Index eingetragen.
  Bei automatisch erschlossener standortanzeigender Baumart bleibt ein Warnhinweis.
  **Mischbestände** ohne eindeutig passenden Standortindex erhalten keinen
  erfundenen Zahlenwert. Die tatsächliche standortanzeigende Baumart ist im Gelände
  zu verifizieren.
- Die Originalraster enthalten **mittlere Höhe, nicht zuverlässig
  standesspezifische Oberhöhe**. Deshalb gibt es im Datenblatt ein neues
  Eingabefeld **Oberhöhe (gemessen)**. Nur mit diesem Wert kann die App einen
  einzelnen konkreten Prozentwert als Modell-Szenario anzeigen.
  Ohne Oberhöhe wird für die *Rechenprüfung* ein absichtlich breites
  Höhenintervall von 100–120 % der mittleren Höhe verwendet. Das ist
  eine explizite **Sensitivitätsannahme**, keine offiziell gültige
  Umrechnung. Die App zeigt je nach Fall einen provisorischen Prozentbereich,
  eine nicht entscheidbare Spanne oder ausdrücklich fehlende Daten.
- Der Prozentwert beschreibt **Grundflächenentnahme (m²/ha)** und darf nicht
  ohne weiteres als `m³sk`-Entnahme oder Sägeholzerlös interpretiert werden.
  Der vom Anwender gespeicherte `removal_pct` bleibt ein getrenntes
  **manuelles Volumenszenario**, wird nicht überschrieben und wird nicht
  automatisch als Einschlagsauftrag übernommen. Keine automatische Fällfreigabe.
- Geringe Rasterabdeckung, Schutzklassen, Nassflächen, Jungwuchs und ungleichaltrige
  Bestände sperren bzw. kennzeichnen die Modellanwendung. Frühere Eingriffe, Wind- und
  Schneebruchgefahr, Boden-/Schutzwerte sowie tatsächliche Bestandsstruktur
  sind weiterhin im Gelände zu beurteilen.

**So testen:** Version 13.61 laden, in *Forstplanung* eine vorhandene
Bestandsfläche wählen oder eine Fläche frei auswerten. Für nordschwedische
Kiefer-/Fichtenbestände ein geeignetes T-/G-Standortindexraster auswählen.
In *Schwedische Gallringsmall · INGVAR* den modellierten Bereich sehen.
Für einen gemessenen Wert Bestand bearbeiten, **Oberhöhe (gemessen)**
ergänzen und den konkreten Grundflächen-Entnahmeprozentsatz prüfen.
Bei zwei Beständen mit unterschiedlichen Grundflächen oder Oberhöhen müssen
unterschiedliche Ergebnisse herauskommen.

## Alle gespeicherten Bestände auf einer Karte · ab 13.60

- Forstplanung zeichnet **alle gespeicherten Bestandsflächen des aktuellen Betriebs**
  gleichzeitig, auch wenn sie unterschiedlichen Grundstücken zugeordnet sind.
  Die Grundstücksauswahl filtert nur noch die Detail-/Bearbeitungsansicht, nicht die Karte.
- Ein Tipp auf ein Bestandspolygon wählt automatisch das zugehörige Grundstück
  und öffnet die vorhandenen Bestandsdaten, Baumarten und Maßnahmen. Dafür
  muss nicht erst im Grundstücksmenü umgeschaltet werden.
- Beim Öffnen und Aktualisieren richtet die Karte den Ausschnitt möglichst nach
  sämtlichen gespeicherten Beständen aus. Grundstücksgrenzen bleiben sichtbar,
  die gewählte Bestandsfläche ist weiß hervorgehoben.
- Neue Bestandsgrenzen werden unverändert gezeichnet und anschließend gespeichert.
  Die Funktion **Fläche auswerten** bleibt eine zunächst ungespeicherte Auswertung:
  dauerhaft sichtbar wird sie erst über **Optional speichern** als Bestand.
- Die Sichtbarkeit bleibt auf den aktuellen Betrieb begrenzt; die Änderung
  führt keine Datenbankmigration durch und ändert keine Waldkennzahlen.

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


### 13.62 – zwei Standortindex-Referenzen bei Mischbeständen

Die lokalen Skogsstyrelsen-SIS-Raster für Kiefer (T) und Fichte (G) sind unabhängig
voneinander auswertbar. Lignum zeigt beide Referenzwerte samt tatsächlich
geschnittener Rasterabdeckung an, selbst wenn aus einer Mischwald-Baumartenkarte
keine eindeutige standortanzeigende Baumart abgeleitet werden kann. Ein nicht
belegtes einziges `site_index` bleibt unbekannt; es wird nicht durch den
höheren Wert oder durch eine willkürliche Holzvorratsmehrheit ersetzt.

Bei einem bereits gespeicherten Bestand mit vorhandener Grenze lädt die
Bestandsansicht fehlende SIS-Referenzen im Hintergrund aus dem regionalen
Datenpaket nach. Diese Ergänzung ist eine *Anzeige*, die keine vorhandenen
Manuelleingaben oder Supabase-Daten überschreibt. Beim bewussten Neuauswerten
und Übernehmen werden die SIS-Referenzen dauerhaft im Bestand gespeichert.

Soweit beide SIS-Referenzen vorhanden sind, zeigt die Durchforstung mögliche
Kiefer- und Fichte-Szenarien nur bedingt an. Die eindeutige Standortzuordnung
ist weiter vor Ort zu bestätigen. Eine verlässliche Oberhöhe ist in den
regionalen ZIP-Kacheln noch **nicht** enthalten; die derzeitige mittlere Höhe
ist keine Oberhöhe. Es erfolgt ausdrücklich keine automatische Ersetzung oder
fiktive Höhenberechnung. Skogsstyrelsen veröffentlicht separat P95-Karten,
die für eine künftige Ergänzung anhand tatsächlicher Originalzellen erst
aufbereitet werden müssten. P95 ist zudem nicht automatisch Hdom.

Das Bezugsjahr des Altersmodells ist aus der Altersraster-Quelle als
**2025** verfügbar. Ein standortspezifisches Laserscan-Aufnahmejahr ist in den
gegenwärtigen Kacheln nicht vorhanden und wird deshalb weiterhin als unbekannt
ausgewiesen. ZIP-Bereitstellungsdatum und Produktjahr sind keine Aufnahmejahre.

### P95-Laserhöhe (separater Höhenkennwert)

Die öffentliche Skogsstyrelsen-Datenquelle *P95, Omdrev 2* ist ein
Höhenperzentil aus Laserrückgaben (ursprünglich Dezimeter).
Lignum zeigt dessen flächengewichteten Wert **separat** von der Grundflächen-
gewichteten mittleren Höhe und einer **vor Ort gemessenen** Oberhöhe.
Ohne validierte Umrechnung darf P95 die manuell gemessene
Oberhöhe nicht automatisch ersetzen und begründet für sich allein
keinen verbindlichen INGVAR-Entnahmeprozentsatz.

Das neue regionale P95-Raster wird mit derselben echten Zell-Polygon-
Verschneidung ausgewertet wie die übrigen ZIP-Raster. Fehlt das
P95-Raster im lokalen Datenpaket, bleibt der Wert unbekannt.


### 13.65 – Oberhöhe/Hdom ohne falschen Laserscan-Messwert

Die schwedische Oberhöhe (övre höjd, Hdom) wird als mittlere Höhe der
100 stärksten Bäume je Hektar definiert. Für die praktikable Aufnahme
empfiehlt Skogskunskap je 10-m-Radius-Probekreis die zwei stärksten
unbeschädigten Bäume zu messen und daraus einen Mittelwert zu bilden.
Mehrere repräsentative Probekreise auf einer heterogenen Fläche liefern
eine bessere Grundlage.

Im bestehenden Formular **Bestand bearbeiten** können dazu je Probekreis
zwei gemessene Höhen auf einer Zeile mit Semikolon eingetragen werden.
Lignum validiert die Höhen (je 3–60 m), berechnet den Mittelwert und
speichert sowohl die beiden Originalhöhen pro Probekreis als auch die
resultierende Oberhöhe und die Provenienz. Vorhandene händische
Oberhöhen-Werte bleiben unberührt, sofern keine Probekreismessungen
eingetragen werden.

Die örtliche Skogsstyrelsen-P95-Laserkarte (2021/omdrev 2) enthält
**kein** gemessenes Hdom. Ohne Feldwert wird der P95-Wert nur als
qualitativer Kronenhöhenindikator und in INGVAR als bewusst weit
angelegter **±20-%-Sensitivitätsbereich** verwendet. Die ±20 % sind
eine *Modellannahme für die Szenarien*, keine empirisch kalibrierte
Vertrauensgrenze. Das Ergebnis ist ein vorläufiger **Bereich** der
möglichen Grundflächenentnahme, niemals eine verbindliche
Einzelprozentzahl. Eine zu geringe P95-Abdeckung (unter 70 %),
unplausibles Verhältnis zur mittleren Höhe oder fehlende Eignung
führt zum Rückgriff auf die vorhandene Mittelhöhen-Sensitivität bzw.
einer Meldung zur Geländevermessung.

Für kartierte Teilflächen wird der P95-Indikator nur verwendet,
wenn die P95-Rasterabdeckung dieser Teilfläche mindestens 70 % beträgt.
Die tatsächliche Baumarten- und Standortszuordnung bleibt auch hier
zu bestätigen.

Fachliche Definition und Geländepraxis:
https://www.skogskunskap.se/aga-skog/fakta-om-skogen/skogstermer/


### 13.66 – INGVAR-Standortvergleich ohne falsche Fehlermeldung

Sind in einem gemischten Bestand die öffentlich verfügbaren SIS-Karten
für Kiefer (T) und Fichte (G) vorhanden, aber die *standortanzeigende
Baumart noch nicht bestätigt*, darf Lignum nicht pauschal behaupten,
die SI-Rasterdaten fehlten. In der vorhandenen INGVAR-Anzeige erscheint
stattdessen ein **bedingter T/G-Vergleich**.

Jede Rasterreferenz wird auf mindestens 70 % Flächenabdeckung geprüft.
Ein unterstützter Index (T14–T30 oder G16–G40) wird mit Grundfläche
und Höhensensitivität vorläufig bewertet. Fehlt eine gemessene Hdom,
bleibt es bei einem **Bereich ohne feste Entnahmestärke**. Ein Index
außerhalb der tatsächlich in der verwendeten INGVAR-Tabelle belegten
Standortgruppen wird mit dem spezifischen Grenzbereich benannt und
**nicht extrapoliert**.

Realer Regressionstest `T17/G14`: 8,71 ha, Grundfläche 18,1 m²/ha,
P95 10,1 m, Alter 80 Jahre. T17 ergibt nur eine bedingte
Sensitivitätsbewertung von 0–30 % Grundflächenentnahme (oberer Wert ist
auch die App-Vorsichtskappe), **keine Empfehlung, 30 % zu entnehmen**.
G14 liegt unter der hinterlegten G16-Untergrenze. Die App legt
keine standortanzeigende Baumart automatisch fest, schreibt keinen
Einzelindex in den Bestand und ändert keine manuell eingetragenen
Erntevolumen-Szenarien.

Bei unbekanntem Standorttyp können Baumartenvolumenanteile die
Vor-Ort-Prüfung unterstützen, nicht aber eine bestätigte Standortwahl
ersetzen.


### 13.68 – Automatische Endnutzungs-/Verjüngungsernte-Reifeprüfung

In jeder gespeicherten Bestandsansicht und bei jeder freien Flächenauswertung
erscheint **automatisch ohne zusätzlichen Button** eine eigene, eindeutig
als *vorläufig* gekennzeichnete Reifeprüfung zur **Endnutzung / Föryngringsavverkning**.
Sie ist unabhängig vom gespeicherten manuellen Maßnahmenplan und unabhängig
vom Durchforstungsmodell.

Die Auswertung unterscheidet:
- **Als Maßnahme prüfen:** geschätztes Alter erreicht einen *bedingten*
  Orientierungswert und vorsichtige zusätzliche Lignum-Strukturkriterien
  (Grundfläche ≥16 m²/ha, mittlere Höhe ≥12 m, Durchmesser ≥18 cm,
  Vorrat ≥120 m³sk/ha). Diese Zusatzwerte sind **keine schwedischen
  gesetzlichen Kriterien** und garantieren nicht, dass die Ernte sinnvoll ist.
- **Reife rückt näher:** innerhalb von 15 geschätzten Jahren bis zur
  bedingten Referenz. Weder ein festes Erntedatum noch eine Erntefreigabe.
- **Altersorientierung erreicht, Struktur unklar:** weitere Prüfung nötig.
- **Noch nicht:** Altersorientierung nicht erreicht.
- **Ungeklärt:** Alter, Stockdaten oder Referenzen fehlen bzw. decken
  weniger als 70 % der Fläche ab; die App darf nicht fälschlich
  „keine Endnutzung nötig“ behaupten.
- **Nicht anwendbar:** Wasser-/Feuchtfläche, Schutzklassen NO/NS,
  ungleichaltrige Klasse E, Jungwuchs R oder Kulturfläche K.

Die Norrbotten-Referenz aus der schwedischen Tabelle richtet sich bei
Nadelholzbeständen nach bestätigtem Standorttyp und Baumart:
G/T12 = 100 Jahre; G/T16 = 90; G/T20 = 80; G/T24 = 70;
G/T28 = 65. Zwischenwerte werden für die Orientierung
**vorsichtig** nach der niedrigeren Bonitätsklasse abgerundet.
Ein vorläufiges SIS-T/G-Raster bildet **zwei bedingte Szenarien**,
nicht automatisch eine behördlich bestätigte Standorteinstufung.
Für einen mittels Baumartenvorratsraster zu mindestens 50 %
birken-dominierten Bestand wird die grundsätzlich abweichende
35-Jahre-Laubholzregel nur als **bedingte Vor-Ort-Prüfung** verwendet.
Fehlt eine passende Referenz komplett, verwendet die App
100 Jahre ausschließlich als konservativen **eigenen Suchwert**,
nicht als gesetzliches Mindestalter. Unzureichende oder außerhalb der
Altersregel liegende SIS-Referenzen führen dagegen ausdrücklich zu
keinem Kandidaten.

Die Bildschirmkarte markiert zusätzlich räumlich zusammenhängende,
hinreichend große und strukturähnliche Bereiche für eine
**Endnutzungsprüfung** (bisher „Ernte / Verjüngung prüfen“).
Die Räumlichkeit ist ein Prüfkandidat und **keine Fällfreigabe**.

**Hauptunterschied:**
Ein möglicherweise erreichtes gesetzliches Mindestalter bedeutet
noch lange nicht, dass eine Endnutzung *wirtschaftlich sinnvoll* ist.
Hierzu fehlen in Lignum aktuell aktuelle Wert-/Volumenzuwächse,
Holzqualität und Sortimente, Nettopreise, Holzernte-/Rückekosten,
Wiederbewaldungskosten, Naturschutzprüfung und der persönliche
Zielzins. Im Nordschweden können Bestände wirtschaftlich noch
deutlich über das Mindestalter hinaus wachsen. Das wird im
Reifeprüfungsfeld ausdrücklich benannt; Dauerwald- und
Einzelstammalternativen werden eingeschlossen.

Föryngringsavverkning ab 0,5 ha muss nach den allgemeinen Regeln
mindestens sechs Wochen im Voraus gemeldet werden. In fjällnära skog,
bei besonderen Waldtypen oder Naturschutzvorgaben gelten weitere
Genehmigungspflichten. Der Nutzer muss die Rechtslage im Einzelfall
prüfen; keinerlei automatischer Freigabestatus.

Offizielle Grundlagen:
- https://www.skogsstyrelsen.se/lag-och-tillsyn/skogsvardslagen/
- https://www.skogsstyrelsen.se/bruka-skog/avverkning/foryngringsavverkning/
- https://www.skogskunskap.se/skota-skog/slutavverka/slutavverkningens-grunder/nar-ska-jag-slutavverka/
