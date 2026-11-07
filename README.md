# Pflegegrad-Widerspruch

**Lokale Arbeitsmappe für einen Widerspruch gegen ein Pflegegutachten des Medizinischen Dienstes (MD)**

Sie tragen die Bewertung des MD je Kriterium neben Ihrer eigenen ein, sehen beide Pflegegrade live, begründen jede Abweichung und exportieren alle Begründungen als Markdown. Den Widerspruchsbrief schreiben Sie selbst; die Begründungen sind der Baustein dafür.

Die Anwendung basiert auf dem Open-Source-Projekt [pflegegrad-rechner](https://github.com/florianloyns/pflegegrad-rechner) und ersetzt dessen vereinfachte Lernrechnung durch die amtliche Berechnung.

## Funktionen

- **Zwei Bewertungen je Kriterium:** 64 Kriterien der Module 1 bis 6 (NBA), jeweils MD-Wert und eigener Wert. Modul 3 (Häufigkeiten) und Modul 5 (Maßnahmen pro Tag, Woche, Monat, Besuche) haben eigene Eingabearten.
- **Live-Ergebnis:** Modulpunkte, gewichtete Punkte und Pflegegrad für MD und eigene Bewertung nebeneinander, dazu die Punkte bis zum nächsten Pflegegrad. Von Modul 2 und 3 zählt der höhere Wert, das andere ist durchgestrichen.
- **Gegenprobe:** Sie tragen die im Gutachten gedruckten Punkte ein. Weichen sie von der Berechnung aus Ihren MD-Eingaben ab, erscheint eine Warnung. So finden Sie Übertragungsfehler.
- **Begründungen mit Status:** Bei jeder Abweichung ist eine Begründung Pflicht (Status: offen, in Bearbeitung, fertig). Die Arbeitsliste auf der Übersicht zeigt, was noch fehlt, filterbar nach Status und Modul.
- **Notizen:** je Kriterium und allgemein, mit Zeitstempel, zum Beispiel für Fragen an Pflegekräfte. Notizen werden nicht exportiert.
- **Autosave:** Jede Änderung wird automatisch gespeichert, oben rechts zeigt „Alles gespeichert“ den Stand. Sie können nach Tagen oder Wochen weiterarbeiten.
- **Export:** Der Knopf „Markdown-Export“ (oder `GET /api/export.md`) liefert eine deutsche Markdown-Datei mit Zusammenfassung, einem Abschnitt je Modul und allen abweichenden Kriterien samt MD-Wert, eigenem Wert und Begründung. Fehlende Begründungen stehen oben als Hinweisliste.

## Starten (Docker)

```bash
docker compose up -d --build
```

Danach im Browser öffnen: <http://localhost:3000>

```bash
docker compose stop      # anhalten
docker compose start     # wieder starten
docker compose down      # Container entfernen (Daten bleiben erhalten)
```

Der Port ist nur auf `127.0.0.1` veröffentlicht, die Anwendung ist also nur von diesem Rechner aus erreichbar. Es gibt keine externen Anfragen (kein CDN, keine Tracker). Lokal ist kein Passwort gesetzt; für den Betrieb im Netz siehe „Gemeinsam nutzen auf Railway“.

Auf Linux muss der Ordner `data/` für den Container-Benutzer (UID 1000) beschreibbar sein. Legen Sie ihn vor dem ersten Start selbst an: `mkdir -p data`.

## Starten ohne Docker

Voraussetzung: Node.js 22 oder neuer.

```bash
npm install
npm start          # http://127.0.0.1:3000, Daten in ./data
npm test           # Unit- und API-Tests
```

Umgebungsvariablen: `DATA_DIR` (Datenordner), `PORT`, `HOST` (Standard `127.0.0.1`), `ALLOWED_HOSTS` (zusätzliche Host-Namen, kommagetrennt), `BASIC_AUTH_USER` und `BASIC_AUTH_PASS` (Zugangsschutz, siehe unten).

## Gemeinsam nutzen auf Railway

Damit mehrere Personen am selben Fall arbeiten können, läuft die Anwendung als ein Dienst auf [Railway](https://railway.com) mit Passwortschutz (HTTP Basic Auth). Es gibt keine Benutzerverwaltung: Alle teilen sich einen Zugang und dieselbe SQLite-Datenbank. Sie schicken die Adresse samt Benutzername und Passwort weiter, mehr ist nicht nötig.

Die Datei `railway.json` bringt die Einstellungen mit (Bau über das `Dockerfile`, genau eine Instanz, Health-Check `/api/health`).

### Einrichten

1. Das Repository auf GitHub bereitstellen (privat empfohlen). Der Ordner `data/` ist über `.gitignore` ausgeschlossen, die Falldaten werden also nicht hochgeladen.
2. In Railway: **New Project → Deploy from GitHub repo** und das Repository wählen. Railway erkennt das `Dockerfile` und `railway.json`.
3. Im Dienst unter **Variables** setzen:

   | Variable | Wert |
   |---|---|
   | `BASIC_AUTH_USER` | frei wählbarer Benutzername |
   | `BASIC_AUTH_PASS` | langes Passwort, mindestens 16 Zeichen |
   | `RAILWAY_RUN_UID` | `0` (nötig, damit der Container auf das Volume schreiben darf) |

   `PORT` setzt Railway selbst. Die öffentliche Domain wird automatisch als erlaubter Host übernommen. Nur bei einer eigenen Domain setzen Sie zusätzlich `ALLOWED_HOSTS=meine-domain.de`.
4. **Volume** anlegen (Rechtsklick auf den Dienst oder `Ctrl+K` → *Volume*) und mit dem Mount-Pfad `/data` verbinden. Ohne Volume gehen die Daten bei jedem neuen Deployment verloren; die Anwendung warnt dann im Log.
5. Unter **Settings → Networking** eine öffentliche Domain erzeugen (**Generate Domain**). Diese Adresse plus Zugangsdaten geben Sie weiter.
6. Einstellung prüfen: Unter **Settings** muss die Anzahl der Replikas 1 sein (steht bereits in `railway.json`). SQLite verträgt keine zwei Instanzen.

Die Anwendung startet auf Railway nicht, solange `BASIC_AUTH_USER` und `BASIC_AUTH_PASS` fehlen. So kann sie nie versehentlich ungeschützt im Netz stehen. Das Passwort wird nur über HTTPS übertragen; Railway stellt das für die erzeugte Domain bereit.

### Bestehende Daten vom eigenen Rechner übernehmen

1. Lokal anhalten und eine einzelne, konsistente Datei erzeugen (mit installiertem `sqlite3`):

   ```bash
   docker compose stop
   sqlite3 data/case.db "VACUUM INTO 'case-upload.db'"
   ```
2. Die Datei auf das Volume des Railway-Dienstes laden und dort als `/data/case.db` ablegen. Railway beschreibt dafür `railway ssh` mit `scp`/`sftp` sowie `railway volume files`, siehe die [Railway-Dokumentation zu Volumes](https://docs.railway.com/reference/volumes).
3. Danach den Dienst neu starten (Redeploy) und im Browser prüfen, ob alle Einträge da sind.

Der lokale Stand und der Railway-Stand sind danach getrennte Kopien. Arbeiten Sie ab dann nur noch an einer von beiden.

### Zusammenarbeit zu zweit

- Jede Eingabe wird einzeln gespeichert, der zuletzt gespeicherte Stand gewinnt. Bei verschiedenen Kriterien stört das nicht. Bearbeiten Sie nicht gleichzeitig dieselbe Begründung, sonst überschreibt die spätere Speicherung die frühere.
- Die Seite lädt die Daten beim Öffnen. Änderungen der anderen Person erscheinen erst nach dem Neuladen der Seite (F5).
- Notizen und Begründungen sind für beide sichtbar.

### Sicherung auf Railway

Die Daten liegen nur auf dem Railway-Volume. Laden Sie deshalb regelmäßig den Markdown-Export herunter und sichern Sie bei größeren Arbeitsschritten auch die Datenbank (Variante mit `VACUUM INTO` per `railway ssh`, dann die Datei herunterladen). Prüfen Sie in Railway, ob für das Volume automatische Backups angeboten werden, und aktivieren Sie sie gegebenenfalls.

### Datenschutz

Es handelt sich um Gesundheitsdaten einer dritten Person. Railway ist ein US-Unternehmen, auch bei Wahl einer EU-Region. Wägen Sie das ab und geben Sie Zugangsdaten nur an Personen weiter, die den Fall kennen dürfen.

## Daten und Sicherung

Alle Eingaben liegen in einer SQLite-Datei: `data/case.db`. Der Ordner `data/` ist ein Docker-Volume vom Host, die Daten überstehen Neustarts und Neubauten des Containers.

**Sicherung:** Halten Sie die Anwendung an und kopieren Sie danach den Ordner `data/`.

```bash
docker compose stop
cp -R data data-backup-$(date +%F)
docker compose start
```

Beim sauberen Anhalten schreibt SQLite alle Änderungen in `case.db`. Kopieren Sie nicht bei laufendem Betrieb nur diese eine Datei, sonst können die jüngsten Änderungen in den Begleitdateien `case.db-wal` und `case.db-shm` fehlen. Zum Wiederherstellen legen Sie die gesicherte Datei in `data/` ab, solange die Anwendung angehalten ist.

Zusätzlich lohnt sich ab und zu der Markdown-Export als lesbare Kopie der Begründungen.

## Wie die Berechnung geprüft wird

- `shared/catalog.js` enthält Kriterien, Ausprägungen und Einzelpunkte nach **Anlage 1 zu § 15 SGB XI**, `shared/scoring.js` die Bewertungssystematik nach **Anlage 2** (Bänder, Gewichtung 10 / 15 / 40 / 20 / 15 %, Pflegegrad-Schwellen 12,5 / 27 / 47,5 / 70 / 90). Der Browser (Live-Ergebnis) und der Server (Export) verwenden dieselbe Datei, es gibt nur einen Rechenweg.
- Gespeichert werden nur Roh-Eingaben (Ausprägungen, Häufigkeiten), nie Punkte. Ein Rechenfehler lässt sich dadurch ohne Datenmigration beheben.
- `npm test` prüft unter anderem jede Bandgrenze aller Module, die Sonderregeln (Modul 3 mit 0/1/3/5 Punkten, Gewichtung von 4.8 bis 4.10, Sonderskala 4.13, Kontinenzregel 4.11/4.12), die Häufigkeitsumrechnung in Modul 5 (Woche ÷ 7, Monat ÷ 30, Besuchsfaktoren 4,3 und 8,6), die Modul-2/3-Regel und die Pflegegrad-Schwellen.
- **Gegenprobe am echten Gutachten:** Tragen Sie auf der Übersicht die gedruckten Modulpunkte, die gewichteten Gesamtpunkte und den Pflegegrad des Gutachtens ein. Stimmen sie mit der Berechnung aus den eingegebenen MD-Werten überein, ist die Übertragung vollständig und korrekt.

### Nicht abgebildet

- Module 7 und 8 (keine Punkte, ändern den Pflegegrad nicht).
- Sonderregeln für Kinder bis 18 Monate (Kriterien 4.K und 5.K).
- Die Einstufung in Pflegegrad 5 bei besonderer Bedarfskonstellation (§ 15 Abs. 4 SGB XI).
- Die Bewertungsregeln der Begutachtungs-Richtlinie, also wie ein Kriterium fachlich einzustufen ist. Das bleibt Ihre Aufgabe und die des Gutachters.

## Projektstruktur

```
shared/catalog.js    Kriterien und Einzelpunkte (Anlage 1)
shared/scoring.js    Bewertung und Pflegegrad (Anlage 2)
server/index.js      Express-Server, API, statische Dateien
server/db.js         SQLite-Schema und Abfragen
server/export.js     Markdown-Export
public/              Oberfläche (HTML, CSS, Vanilla-JS ohne Build-Schritt)
test/                Tests mit node:test
Dockerfile, docker-compose.yml, railway.json
```

## API

| Methode | Pfad | Zweck |
|---|---|---|
| GET | `/api/case` | gesamter Fall (Bewertungen, Begründungen, Notizen, Meta) |
| PUT | `/api/ratings/:source/:criterionId` | MD- oder eigene Bewertung (`source` = `md` oder `own`) |
| PUT | `/api/justifications/:criterionId` | Begründung und Status |
| POST / DELETE | `/api/notes`, `/api/notes/:id` | Notizen |
| PUT | `/api/meta/:key` | gedruckte MD-Punkte (`md_printed`), Fallbezeichnung (`case_title`) |
| GET | `/api/export.md` | Markdown-Export der Begründungen |

## Hinweis

Dieses Werkzeug ist ein Hilfsmittel und keine Rechtsberatung. Die Berechnung folgt den gesetzlichen Tabellen, ersetzt aber weder die Begutachtung noch eine Beratung, zum Beispiel durch einen Pflegestützpunkt, eine Sozialberatung oder einen Fachanwalt. Die Begründungen gehen an eine Behörde: Prüfen Sie Inhalt und Fristen (in der Regel ein Monat nach Zugang des Bescheids) selbst.

## Lizenz

[MIT](LICENSE) für den Quelltext · [CC BY-SA 4.0](LICENSE-CONTENT.md) für die Inhalte des ursprünglichen Projekts (Texte, Grafiken). Der Wortlaut der Kriterien stammt aus Anlage 1 zu § 15 SGB XI (amtliches Werk, gemeinfrei nach § 5 UrhG).
