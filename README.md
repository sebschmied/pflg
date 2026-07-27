# Pflegegrad-Rechner

**Pflegegrad nach NBA berechnen — interaktives Lerntool für die Pflegeausbildung, basierend auf Anlage 1 zu § 15 SGB XI**

[![Code: MIT](https://img.shields.io/badge/Code-MIT-green.svg)](LICENSE) [![Inhalte: CC BY-SA 4.0](https://img.shields.io/badge/Inhalte-CC%20BY--SA%204.0-blue.svg)](LICENSE-CONTENT.md)
[![Live Demo](https://img.shields.io/badge/Live%20Demo-GitHub%20Pages-blue)](https://florianloyns.github.io/pflegegrad-rechner/)
![Keine Abhängigkeiten](https://img.shields.io/badge/Abh%C3%A4ngigkeiten-keine-brightgreen)
![PWA](https://img.shields.io/badge/PWA-offline--f%C3%A4hig-teal)

Eine browser-basierte App für Pflege-Auszubildende: Sechs NBA-Module bewerten, Pflegegrad live mitsehen. Keine Anmeldung, keine Datenübertragung, läuft offline auch nach „Zum Homescreen hinzufügen".

**[Jetzt rechnen](https://florianloyns.github.io/pflegegrad-rechner/)**

## Was die App rechnet

Sechs Module nach dem Neuen Begutachtungsassessment (NBA), Stand SGB XI Anlage 1:

- **Modul 1 Mobilität** — 5 Kriterien · 10 % Gewichtung
- **Modul 2 Kognitive und kommunikative Fähigkeiten** — 11 Kriterien · 15 % (Modul 2 oder 3, höherer Wert zählt)
- **Modul 3 Verhaltensweisen und psychische Problemlagen** — 13 Kriterien · 15 % (siehe oben)
- **Modul 4 Selbstversorgung** — 13 Kriterien · 40 % · mit Sondergewichtungen (Essen 3-fach, Trinken/Toilette 2-fach, Sondenernährung Sonderskala)
- **Modul 5 Bewältigung krankheits- und therapiebedingter Anforderungen** — 16 Kriterien · 20 % (vereinfachte Lehr-Form)
- **Modul 6 Gestaltung des Alltagslebens und sozialer Kontakte** — 6 Kriterien · 15 %

Aus den gewichteten Modul-Punkten ergibt sich der Pflegegrad: 12,5 → PG 1, 27 → PG 2, 47,5 → PG 3, 70 → PG 4, 90 → PG 5. Zusätzlich wird das **Pflegegeld nach § 37 SGB XI** (Stand 2025) je Pflegegrad ausgewiesen.

## Didaktischer Aufbau

Tabs schalten zwischen den sechs Modulen, die Module-2/3-Sonderregel ist im Ergebnis-Breakdown sichtbar (durchgestrichener nicht-zählender Modul). Jede Bewertungsstufe öffnet beim Antippen den offiziellen Begründungstext nach SGB XI. Live-Berechnung von Modul-Punkten, gewichteten Punkten und Pflegegrad — bis hin zum monatlichen Pflegegeld-Betrag bei häuslicher Pflege.

Bewertungen werden in `localStorage` zwischengespeichert; ein „touched"-Punkt auf jedem Tab zeigt, welche Module bereits bearbeitet sind.

## Klinischer Bezug

Der Pflegegrad ist Pflichtstoff der generalistischen Pflegeausbildung und im Klinikalltag omnipräsent. Modul 4 ist mit den offiziellen Sondergewichtungen ausgestattet (Essen, Trinken, Toilettengang, Sondenernährung). Modul 5 ist in vereinfachter Lehr-Form abgebildet — die offizielle MD-Begutachtung berücksichtigt zusätzlich die Häufigkeit pro Tag/Woche/Monat. Im Haftungshinweis transparent erklärt.

## Technik

- Einzelne HTML-Datei, Vanilla JavaScript, keine Frameworks, kein Build-Tool
- Kein externes CDN, keine Abhängigkeiten zur Laufzeit
- **PWA**: installierbar auf Desktop und Smartphone, offline-fähig via Service Worker
- Mobile-First-Layout mit `safe-area-inset` für iPhone-Notch und Home-Indicator
- Wortlaut der Kriterien aus Anlage 1 zu § 15 SGB XI (gemeinfreies amtliches Werk nach § 5 UrhG)
- DSGVO-konform: keine Tracker, keine externen Ressourcen, keine Datenübertragung

## Impressum

Verantwortlich: Florian Loyns. Pflichtangaben nach § 5 DDG: [Impressum](https://florianloyns.com/Impressum/)

## Lizenz

[MIT](LICENSE) für den Quelltext · [CC BY-SA 4.0](LICENSE-CONTENT.md) für die didaktischen Inhalte (Fälle, Fragen, Texte, Grafiken).

Nutzen, anpassen und weitergeben ist ausdrücklich erwünscht — auch im kommerziellen Kontext. Bei den Inhalten gilt: Namensnennung und Weitergabe bearbeiteter Fassungen unter denselben Bedingungen.
