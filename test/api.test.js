import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { openStore } from '../server/db.js';
import { createApp } from '../server/index.js';

let dir;
let store;
let server;
let base;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pflegegrad-api-'));
  store = openStore(dir);
  server = createApp(store).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function call(method, url, body) {
  const res = await fetch(base + url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const getCase = async () => (await call('GET', '/api/case')).body;

test('leere Datenbank: Schema wird beim Start angelegt, Fall ist leer', async () => {
  assert.ok(fs.existsSync(path.join(dir, 'case.db')));
  assert.deepEqual(await getCase(), {
    ratings: { md: {}, own: {} }, justifications: {}, notes: [], meta: {}
  });
});

test('Ratings: speichern, überschreiben, löschen (md und own getrennt)', async () => {
  let r = await call('PUT', '/api/ratings/md/1.1', { value: 1 });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { value: 1 });
  await call('PUT', '/api/ratings/own/1.1', { value: 3 });
  await call('PUT', '/api/ratings/md/1.1', { value: 2 });
  let c = await getCase();
  assert.equal(c.ratings.md['1.1'], 2);
  assert.equal(c.ratings.own['1.1'], 3);
  r = await call('PUT', '/api/ratings/md/1.1', { value: null });
  assert.equal(r.status, 200);
  c = await getCase();
  assert.equal('1.1' in c.ratings.md, false);
  assert.equal(c.ratings.own['1.1'], 3);
});

test('Ratings: zusammengesetzte Werte (Modul 4.11, Modul 5) werden normalisiert gespeichert', async () => {
  let r = await call('PUT', '/api/ratings/md/4.11', { value: { status: 'kontinent', rating: 3 } });
  assert.deepEqual(r.body.value, { rating: 0, status: 'kontinent' });
  r = await call('PUT', '/api/ratings/own/4.11', { value: { status: 'vollstaendig_inkontinent', rating: 3 } });
  assert.equal(r.status, 200);
  r = await call('PUT', '/api/ratings/own/5.1', { value: { day: 3 } });
  assert.deepEqual(r.body.value, { day: 3, week: 0, month: 0 });
  r = await call('PUT', '/api/ratings/md/5.12', { value: { day: true, week: 0, month: 0 } });
  assert.deepEqual(r.body.value, { day: true, week: 0, month: 0 });
  const c = await getCase();
  assert.deepEqual(c.ratings.own['5.1'], { day: 3, week: 0, month: 0 });
});

test('Ratings: ungültige Eingaben werden abgelehnt', async () => {
  const cases = [
    ['PUT', '/api/ratings/md/1.1', { value: 4 }, 400],
    ['PUT', '/api/ratings/md/1.1', { value: 'x' }, 400],
    ['PUT', '/api/ratings/md/1.1', {}, 400],
    ['PUT', '/api/ratings/md/4.13', { value: 3 }, 400],
    ['PUT', '/api/ratings/md/4.11', { value: { status: 'kuenstlich', rating: 9 } }, 400],
    ['PUT', '/api/ratings/own/5.1', { value: { day: -2 } }, 400],
    ['PUT', '/api/ratings/own/9.9', { value: 1 }, 404],
    ['PUT', '/api/ratings/fremd/1.1', { value: 1 }, 404],
    ['PUT', '/api/ratings/md/7.1', { value: 1 }, 404]
  ];
  for (const [method, url, body, status] of cases) {
    const r = await call(method, url, body);
    assert.equal(r.status, status, `${url} ${JSON.stringify(body)}`);
    assert.ok(r.body.error);
  }
});

test('Ungültiges JSON ergibt 400 statt Absturz', async () => {
  const res = await fetch(`${base}/api/ratings/md/1.1`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{kaputt'
  });
  assert.equal(res.status, 400);
});

test('Begründungen: Text und Status, Teil-Updates, Umlaute und lange Texte bleiben erhalten', async () => {
  const long = 'Die Pflegebedürftige kann sich nicht selbständig drehen: Größe, Äußerung, Übergänge — ß.\n\n'.repeat(500);
  let r = await call('PUT', '/api/justifications/1.1', { text: long });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'open');
  r = await call('PUT', '/api/justifications/1.1', { status: 'in_progress' });
  assert.equal(r.body.status, 'in_progress');
  assert.equal(r.body.text, long);
  r = await call('PUT', '/api/justifications/1.1', { status: 'done', text: 'Kurz: überwiegend unselbständig.' });
  const c = await getCase();
  assert.equal(c.justifications['1.1'].text, 'Kurz: überwiegend unselbständig.');
  assert.equal(c.justifications['1.1'].status, 'done');
  assert.ok(c.justifications['1.1'].updatedAt);
  await call('PUT', '/api/justifications/1.2', { text: long });
  assert.equal((await getCase()).justifications['1.2'].text, long);
});

test('Begründungen: ungültige Eingaben werden abgelehnt', async () => {
  assert.equal((await call('PUT', '/api/justifications/1.1', { status: 'fertig' })).status, 400);
  assert.equal((await call('PUT', '/api/justifications/1.1', {})).status, 400);
  assert.equal((await call('PUT', '/api/justifications/1.1', { text: 42 })).status, 400);
  assert.equal((await call('PUT', '/api/justifications/8.8', { text: 'x' })).status, 404);
});

test('Notizen: anlegen (kriterienbezogen und allgemein), auflisten, löschen', async () => {
  const a = await call('POST', '/api/notes', { criterionId: '4.8', text: 'Pflegekraft fragen: Essen mit Hilfe?' });
  assert.equal(a.status, 201);
  assert.equal(a.body.criterionId, '4.8');
  assert.ok(a.body.createdAt);
  const b = await call('POST', '/api/notes', { text: 'Allgemein: Termin beim Hausarzt' });
  assert.equal(b.body.criterionId, null);
  let c = await getCase();
  assert.deepEqual(c.notes.map(n => n.id), [a.body.id, b.body.id]);
  assert.equal((await call('DELETE', `/api/notes/${a.body.id}`)).status, 204);
  assert.equal((await call('DELETE', `/api/notes/${a.body.id}`)).status, 404);
  c = await getCase();
  assert.deepEqual(c.notes.map(n => n.id), [b.body.id]);
});

test('Notizen: ungültige Eingaben werden abgelehnt', async () => {
  assert.equal((await call('POST', '/api/notes', { text: '   ' })).status, 400);
  assert.equal((await call('POST', '/api/notes', { criterionId: '1.1' })).status, 400);
  assert.equal((await call('POST', '/api/notes', { criterionId: '0.0', text: 'x' })).status, 404);
  assert.equal((await call('DELETE', '/api/notes/abc')).status, 404);
});

test('Meta: gedruckte MD-Summen und Titel speichern, prüfen, löschen', async () => {
  let r = await call('PUT', '/api/meta/md_printed', {
    value: { raw: { 1: 6, 4: 19, 5: null }, total: 47.5, pflegegrad: 3 }
  });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.value, { raw: { 1: 6, 4: 19 }, total: 47.5, pflegegrad: 3 });
  await call('PUT', '/api/meta/case_title', { value: 'Widerspruch Mutter' });
  let c = await getCase();
  assert.deepEqual(c.meta.md_printed.raw, { 1: 6, 4: 19 });
  assert.equal(c.meta.case_title, 'Widerspruch Mutter');
  assert.equal((await call('PUT', '/api/meta/md_printed', { value: { raw: { 1: 99 } } })).status, 400);
  assert.equal((await call('PUT', '/api/meta/md_printed', { value: { pflegegrad: 7 } })).status, 400);
  assert.equal((await call('PUT', '/api/meta/unbekannt', { value: 1 })).status, 404);
  await call('PUT', '/api/meta/case_title', { value: null });
  c = await getCase();
  assert.equal('case_title' in c.meta, false);
});

test('Host-Prüfung: fremde Host-Namen werden abgelehnt (DNS-Rebinding)', async () => {
  const port = server.address().port;
  const status = await new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/api/case', headers: { Host: 'boese.example' } },
      res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject);
    req.end();
  });
  assert.equal(status, 403);
});

test('Statische Dateien: Oberfläche und geteilte Module werden ausgeliefert', async () => {
  const res = await fetch(`${base}/shared/scoring.js`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /javascript/);
  assert.equal(res.headers.get('cache-control'), 'no-cache');
  assert.equal((await fetch(`${base}/api/gibtsnicht`)).status, 404);
});

test('Persistenz: Daten überleben Schließen und erneutes Öffnen der Datenbank', async () => {
  await call('PUT', '/api/ratings/own/6.1', { value: 2 });
  const before = await getCase();
  const reopened = openStore(dir);
  assert.deepEqual(reopened.getCase(), before);
  reopened.close();
});
