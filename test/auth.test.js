import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore } from '../server/db.js';
import { createApp, authFromEnv } from '../server/index.js';

const basic = (user, pass) => 'Basic ' + Buffer.from(`${user}:${pass}`, 'utf8').toString('base64');

async function withServer(options, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pflegegrad-auth-'));
  const store = openStore(dir);
  const server = createApp(store, options).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    await new Promise(resolve => server.close(resolve));
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const hosts = extra => new Set(['localhost', '127.0.0.1', '[::1]', ...extra]);

test('authFromEnv: ohne Variablen keine Anmeldung, einzeln gesetzt ist ein Fehler', () => {
  assert.equal(authFromEnv({}), null);
  assert.deepEqual(authFromEnv({ BASIC_AUTH_USER: 'a', BASIC_AUTH_PASS: 'b' }), { user: 'a', pass: 'b' });
  assert.throws(() => authFromEnv({ BASIC_AUTH_USER: 'a' }), /beide gesetzt/);
  assert.throws(() => authFromEnv({ BASIC_AUTH_PASS: 'b' }), /beide gesetzt/);
});

test('Basic Auth: ohne oder mit falschen Zugangsdaten 401, mit richtigen 200', async () => {
  await withServer({ auth: { user: 'schwester', pass: 'Gehe1m: ü ß' }, hosts: hosts([]) }, async base => {
    let res = await fetch(base + '/api/case');
    assert.equal(res.status, 401);
    assert.match(res.headers.get('www-authenticate'), /^Basic realm=/);

    res = await fetch(base + '/api/case', { headers: { Authorization: basic('schwester', 'falsch') } });
    assert.equal(res.status, 401);
    res = await fetch(base + '/api/case', { headers: { Authorization: basic('andere', 'Gehe1m: ü ß') } });
    assert.equal(res.status, 401);
    res = await fetch(base + '/api/case', { headers: { Authorization: 'Basic !!!' } });
    assert.equal(res.status, 401);

    res = await fetch(base + '/api/case', { headers: { Authorization: basic('schwester', 'Gehe1m: ü ß') } });
    assert.equal(res.status, 200);
  });
});

test('Basic Auth schützt auch Oberfläche, Export und Schreibzugriffe', async () => {
  await withServer({ auth: { user: 'u', pass: 'p' }, hosts: hosts([]) }, async base => {
    for (const url of ['/', '/shared/catalog.js', '/api/export.md']) {
      assert.equal((await fetch(base + url)).status, 401, url);
    }
    const put = await fetch(base + '/api/ratings/md/1.1', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: 1 })
    });
    assert.equal(put.status, 401);
    const ok = await fetch(base + '/api/export.md', { headers: { Authorization: basic('u', 'p') } });
    assert.equal(ok.status, 200);
  });
});

test('Health-Check bleibt ohne Anmeldung und mit fremdem Host erreichbar und liefert keine Daten', async () => {
  await withServer({ auth: { user: 'u', pass: 'p' }, hosts: hosts([]) }, async base => {
    const res = await fetch(base + '/api/health', { headers: { Host: 'healthcheck.railway.app' } });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  });
});

test('Host-Prüfung: fremde Host-Namen 403, freigegebene Railway-Domain erlaubt', async () => {
  await withServer({ auth: null, hosts: hosts(['pflegegrad.up.railway.app']) }, async base => {
    // fetch erlaubt keinen Host-Header; daher mit node:http
    const { request } = await import('node:http');
    const get = host => new Promise((resolve, reject) => {
      const url = new URL(base + '/api/case');
      const req = request({ hostname: url.hostname, port: url.port, path: url.pathname, headers: { Host: host } },
        res => { res.resume(); resolve(res.statusCode); });
      req.on('error', reject);
      req.end();
    });
    assert.equal(await get('pflegegrad.up.railway.app'), 200);
    assert.equal(await get('PFLEGEGRAD.up.railway.app:443'), 200);
    assert.equal(await get('boese.example.com'), 403);
  });
});

test('Sicherheits-Header: nicht indexieren, kein Referrer', async () => {
  await withServer({ auth: null, hosts: hosts([]) }, async base => {
    const res = await fetch(base + '/api/case');
    assert.match(res.headers.get('x-robots-tag'), /noindex/);
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  });
});
