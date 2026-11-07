import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildExport } from '../server/export.js';
import { openStore } from '../server/db.js';
import { createApp } from '../server/index.js';

const NOW = new Date(2026, 10, 7);

function makeCase(overrides = {}) {
  return {
    ratings: { md: {}, own: {} },
    justifications: {},
    notes: [],
    meta: {},
    ...overrides
  };
}

const LONG = 'Frau M. kann sich nachts nicht ohne Hilfe drehen — Größe, Gewicht, Äußerungen.\n\nZweiter Absatz: Übergänge zum Rollstuhl nur mit zwei Personen (ß).';

const worked = () => makeCase({
  ratings: {
    md: { '1.1': 0, '1.2': 1, '4.8': 1, '5.1': { day: 0, week: 0, month: 0 } },
    own: { '1.1': 0, '1.2': 3, '4.8': 2, '5.1': { day: 3, week: 0, month: 0 } }
  },
  justifications: {
    '1.1': { text: 'Darf nicht erscheinen, Bewertung ist identisch.', status: 'done' },
    '1.2': { text: LONG, status: 'done' },
    '4.8': { text: 'Entwurf zum Essen', status: 'in_progress' }
  },
  notes: [{ id: 1, criterionId: '1.2', text: 'GEHEIME-NOTIZ Pflegekraft anrufen', createdAt: '2026-11-01T10:00:00Z' }],
  meta: { case_title: 'Frau M.' }
});

test('Export: Titel, Datum und Zusammenfassung mit MD und eigener Bewertung', () => {
  const md = buildExport(worked(), { now: NOW });
  assert.match(md, /^# Begründungen zum Widerspruch: Frau M\.\n/);
  assert.match(md, /Stand: 07\.11\.2026/);
  assert.match(md, /## Zusammenfassung/);
  assert.match(md, /\| Gewichtete Gesamtpunkte \| 10 \| 17,5 \|/);
  assert.match(md, /\| Pflegegrad \| kein Pflegegrad \| Pflegegrad 1 \|/);
  assert.match(md, /\| 1 Mobilität \| 10 % \| 1 \| 0 \| 3 \| 2,5 \| 1 \|/);
  assert.match(md, /\| 4 Selbstversorgung \| 40 % \| 3 \| 10 \| 6 \| 10 \| 1 \|/);
});

test('Export: ein Abschnitt je Modul, Module ohne Abweichung werden benannt', () => {
  const md = buildExport(worked(), { now: NOW });
  for (const n of [1, 2, 3, 4, 5, 6]) assert.match(md, new RegExp(`^## Modul ${n}: `, 'm'));
  const m2 = md.split('## Modul 2: ')[1].split('## Modul 3: ')[0];
  assert.match(m2, /Keine abweichenden Bewertungen/);
});

test('Export: abweichendes Kriterium mit MD-Wert, eigenem Wert und Begründung (Umlaute, Absätze)', () => {
  const md = buildExport(worked(), { now: NOW });
  const section = md.split('### 1.2 Halten einer stabilen Sitzposition')[1].split('###')[0];
  assert.match(section, /\*\*MD-Bewertung:\*\* überwiegend selbständig \(1 Punkt\)/);
  assert.match(section, /\*\*Eigene Bewertung:\*\* unselbständig \(3 Punkte\)/);
  assert.ok(section.includes(LONG));
  assert.match(md, /### 5\.1 Medikation[\s\S]*\*\*MD-Bewertung:\*\* entfällt oder selbständig[\s\S]*\*\*Eigene Bewertung:\*\* 3 pro Tag/);
});

test('Export: identische Bewertungen erscheinen nicht, auch wenn Text gespeichert ist', () => {
  const md = buildExport(worked(), { now: NOW });
  assert.ok(!md.includes('### 1.1'));
  assert.ok(!md.includes('Darf nicht erscheinen'));
});

test('Export: Arbeitsnotizen werden nie ausgegeben', () => {
  const md = buildExport(worked(), { now: NOW });
  assert.ok(!md.includes('GEHEIME-NOTIZ'));
  assert.ok(!md.includes('Pflegekraft anrufen'));
});

test('Export: fehlende Begründungen stehen als Hinweisliste vor der Zusammenfassung', () => {
  const data = worked();
  delete data.justifications['1.2'];
  data.justifications['4.8'] = { text: '   ', status: 'done' };
  const md = buildExport(data, { now: NOW });
  const flagsAt = md.indexOf('## Hinweise zur Vollständigkeit');
  const summaryAt = md.indexOf('## Zusammenfassung');
  assert.ok(flagsAt > -1 && flagsAt < summaryAt);
  const flags = md.slice(flagsAt, summaryAt);
  assert.match(flags, /Es fehlen Begründungen für 3 abweichende Kriterien/);
  assert.match(flags, /- 1\.2 Halten einer stabilen Sitzposition/);
  assert.match(flags, /- 4\.8 Essen/);
  assert.match(flags, /- 5\.1 Medikation/);
  assert.match(md, /_Begründung fehlt noch\._/);
});

test('Export: Einzahl bei genau einer fehlenden Begründung', () => {
  const md = buildExport(worked(), { now: NOW });
  assert.match(md, /Es fehlen Begründungen für 1 abweichendes Kriterium:/);
});

test('Export: Begründung ohne Status „fertig“ wird als Entwurf gemeldet, aber ausgegeben', () => {
  const md = buildExport(worked(), { now: NOW });
  assert.match(md, /Begründung vorhanden, aber nicht als fertig markiert \(1\)/);
  assert.match(md, /- 4\.8 Essen/);
  assert.match(md, /Entwurf zum Essen/);
});

test('Export: vollständig begründeter und vollständig erfasster Fall hat keine Hinweisliste', () => {
  const md = buildExport(makeCase({
    ratings: { md: { '1.1': 0 }, own: { '1.1': 2 } },
    justifications: { '1.1': { text: 'Begründung', status: 'done' } }
  }), { now: NOW });
  // Unvollständig erfasst ist der Fall trotzdem, das wird gemeldet
  assert.match(md, /Unvollständige Erfassung/);
  assert.ok(!md.includes('Es fehlen Begründungen'));
});

test('Export: Abweichung zwischen gedruckten und berechneten MD-Punkten wird gemeldet', () => {
  const data = worked();
  data.meta.md_printed = { raw: { 1: 5 }, total: 12.5, pflegegrad: 1 };
  const md = buildExport(data, { now: NOW });
  assert.match(md, /Modul 1 \(Einzelpunkte\): im Gutachten 5, berechnet 1/);
  assert.match(md, /Gewichtete Gesamtpunkte: im Gutachten 12,5, berechnet 10/);
});

test('Export: nicht zählendes Modul 2 oder 3 ist durchgestrichen', () => {
  const data = makeCase({
    ratings: {
      md: { '2.1': 3, '2.2': 3, '2.3': 3, '2.4': 3, '2.5': 3, '2.6': 0 },
      own: { '3.1': 3, '3.2': 3 }
    }
  });
  const md = buildExport(data, { now: NOW });
  assert.match(md, /\| 3 Verhaltensweisen und psychische Problemlagen \| 15 % \| 0 \| ~~0~~ \(zählt nicht\) \| 10 \| 15 \| 0 \|/);
  assert.match(md, /\| 2 Kognitive und kommunikative Fähigkeiten \| 15 % \| 15 \| 11,25 \| 0 \| ~~0~~ \(zählt nicht\) \| 0 \|/);
});

test('Export: leerer Fall erzeugt gültiges Dokument ohne Absturz', () => {
  const md = buildExport(makeCase(), { now: NOW });
  assert.match(md, /^# Begründungen zum Widerspruch\n/);
  assert.match(md, /\| Pflegegrad \| kein Pflegegrad \| kein Pflegegrad \|/);
  assert.ok(md.endsWith('\n'));
});

test('GET /api/export.md liefert UTF-8-Markdown als Download', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pflegegrad-export-'));
  const store = openStore(dir);
  const server = createApp(store).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const put = (url, body) => fetch(base + url, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    await put('/api/ratings/md/1.2', { value: 1 });
    await put('/api/ratings/own/1.2', { value: 3 });
    await put('/api/justifications/1.2', { text: LONG, status: 'done' });
    await fetch(base + '/api/notes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ criterionId: '1.2', text: 'GEHEIME-NOTIZ' })
    });
    const res = await fetch(base + '/api/export.md');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/markdown; charset=utf-8/);
    assert.match(res.headers.get('content-disposition'), /attachment; filename="widerspruch-begruendungen\.md"/);
    const text = await res.text();
    assert.ok(text.includes(LONG));
    assert.ok(!text.includes('GEHEIME-NOTIZ'));
  } finally {
    await new Promise(resolve => server.close(resolve));
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
