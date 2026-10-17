# Lignum Harvester – APT reverse engineering

Basis: John-Deere/TimberMatic `default.APT` und die auf der Maschine praktisch erfolgreich eingesetzte `NORRA_SKOG.APT`.

## Sicher bestätigte Struktur

APT ist eine ISO-8859-1-Textdatei mit CRLF und nummerierten Feldern im Muster `~<gruppe> <unterfeld>`.

- `2.1`: Identität/Name der APT (`default` bzw. `NORRA_SKOG`)
- `120.1`: Baumartnamen. Norra: Tall, Gran, Björk, Asp.
- `121.1`: Bezeichnungen der Qualitäts-/Sortimentszeilen. Norra enthält Timmer, Klentimmer, Barrmassaved, Bränsleved und Lövmassaved.
- `125.1`, `126.1`, `127.1`: Gruppierung/Zuordnung der Produktgruppen. Die Norra-Datei unterscheidet sich hier passend zu ihren vier Produktgruppen bei Tall/Gran und zwei bei Björk/Asp.
- `131.1`: numerische Durchmesser-Grenz-/Klassenstruktur. Norra enthält u.a. 100…139/140 für Klentimmer sowie 50/100/700 und 50/900 für weitere Sortimente.
- `132.1`: Längenstruktur in cm. Enthält u.a. 340, 370, 400, 430, 460, 490, 520, 550 sowie bei Masse-/Brennholz 290, 340, 390, 440, 490, 540, 571.
- `162.2`: große Wert-/Prioritätsmatrix; Norra unterscheidet sich deutlich von default. Bedeutung einzelner Zellen noch nicht ausreichend verifiziert.
- `200.1`: Beschreibung. Norra: `NORRA SKOG - AUSHALTUNG`.

## Noch nicht als sicher behandeln

Die exakte Segmentierung von `131.1`, `132.1` und besonders `162.2` auf jede einzelne Baumart/Qualität ist aus nur zwei Dateien noch nicht eindeutig beweisbar. Deshalb darf Lignum noch keine frei erfundene Produktions-APT aus diesen Feldern schreiben.

## Implementationsregel

`apt-generator.js` kann APT-Dateien verlustarm einlesen, inspizieren und wieder serialisieren. Unbekannte Felder bleiben unangetastet. Das ist absichtlich so: Erst nach kontrollierten SilviA-Differenztests werden verifizierte Felder für die freie Generierung freigeschaltet.

Produktionsdateien wie `NORRA_SKOG.APT` oder `default.APT` niemals überschreiben. Tests immer unter neuem Namen, z.B. `LIGNUM_TEST.APT`.
