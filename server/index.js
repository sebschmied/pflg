import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openStore, JUSTIFICATION_STATUSES } from './db.js';
import { CRITERIA_BY_ID, META_KEYS, MODULES } from '../shared/catalog.js';
import { validateValue } from '../shared/scoring.js';
import { buildExport } from './export.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const MAX_JUSTIFICATION = 100_000;
const MAX_NOTE = 20_000;
const MAX_TITLE = 200;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const bad = message => new HttpError(400, message);

function criterionOrThrow(id) {
  const criterion = CRITERIA_BY_ID[id];
  if (!criterion) throw new HttpError(404, `Unbekanntes Kriterium: ${id}`);
  return criterion;
}

function bodyOf(req) {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    throw bad('Erwartet wird ein JSON-Objekt');
  }
  return req.body;
}

const numberOrNull = (n, label, { min = 0, max = 1000, integer = false } = {}) => {
  if (n === null || n === undefined || n === '') return null;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) {
    throw bad(`${label}: ungültige Zahl`);
  }
  return n;
};

// Gedruckte MD-Werte zur Gegenprobe: { raw: { 1..6 }, total, pflegegrad }
function sanitizeMdPrinted(value) {
  if (typeof value !== 'object' || Array.isArray(value)) throw bad('md_printed: Objekt erwartet');
  const raw = {};
  for (const m of MODULES) {
    const n = numberOrNull(value.raw?.[m.id], `Modul ${m.id}`, { max: m.maxRaw });
    if (n !== null) raw[m.id] = n;
  }
  const out = { raw };
  const total = numberOrNull(value.total, 'Gesamtpunkte', { max: 100 });
  const pflegegrad = numberOrNull(value.pflegegrad, 'Pflegegrad', { max: 5, integer: true });
  if (total !== null) out.total = total;
  if (pflegegrad !== null) out.pflegegrad = pflegegrad;
  return out;
}

function sanitizeMeta(key, value) {
  if (value === null || value === undefined) return null;
  if (key === 'md_printed') return sanitizeMdPrinted(value);
  if (key === 'case_title') {
    if (typeof value !== 'string' || value.length > MAX_TITLE) throw bad('case_title: Text bis 200 Zeichen erwartet');
    return value;
  }
  throw bad('Unbekannter Meta-Schlüssel');
}

// Erlaubte Host-Namen: lokal, ALLOWED_HOSTS und die von Railway gesetzten Domains
function allowedHosts(env = process.env) {
  const extra = (env.ALLOWED_HOSTS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const railway = [env.RAILWAY_PUBLIC_DOMAIN, env.RAILWAY_PRIVATE_DOMAIN].filter(Boolean).map(s => s.toLowerCase());
  return new Set(['localhost', '127.0.0.1', '[::1]', ...extra, ...railway]);
}

// Basic-Auth-Zugang aus BASIC_AUTH_USER / BASIC_AUTH_PASS (beide oder keiner)
export function authFromEnv(env = process.env) {
  const user = env.BASIC_AUTH_USER || '';
  const pass = env.BASIC_AUTH_PASS || '';
  if (!user && !pass) return null;
  if (!user || !pass) throw new Error('BASIC_AUTH_USER und BASIC_AUTH_PASS müssen beide gesetzt sein');
  return { user, pass };
}

const digest = value => crypto.createHash('sha256').update(String(value)).digest();
const sameSecret = (a, b) => crypto.timingSafeEqual(digest(a), digest(b));

function basicAuth({ user, pass }) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const [scheme, encoded = ''] = header.split(' ');
    if (scheme && scheme.toLowerCase() === 'basic') {
      const decoded = Buffer.from(encoded, 'base64').toString('utf8');
      const at = decoded.indexOf(':');
      if (at > -1) {
        // beide Vergleiche immer ausführen, damit die Laufzeit nichts verrät
        const userOk = sameSecret(decoded.slice(0, at), user);
        const passOk = sameSecret(decoded.slice(at + 1), pass);
        if (userOk && passOk) return next();
      }
    }
    res.set('WWW-Authenticate', 'Basic realm="Pflegegrad-Widerspruch", charset="UTF-8"');
    res.status(401).type('text/plain; charset=utf-8').send('Anmeldung erforderlich');
  };
}

export function createApp(store, { auth = authFromEnv(), hosts = allowedHosts() } = {}) {
  const app = express();
  app.disable('x-powered-by');

  // Health-Check für die Plattform: vor Host-Prüfung und Anmeldung, liefert keine Daten.
  // (Railway ruft ihn mit dem Host-Namen healthcheck.railway.app auf.)
  app.get('/api/health', (req, res) => res.json({ ok: true }));

  app.use((req, res, next) => {
    res.set({
      'X-Robots-Tag': 'noindex, nofollow',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer'
    });
    next();
  });

  // Schutz vor DNS-Rebinding: nur erlaubte Host-Namen zulassen (Gesundheitsdaten)
  app.use((req, res, next) => {
    const host = (req.headers.host || '').replace(/:\d+$/, '').toLowerCase();
    if (!hosts.has(host)) return res.status(403).json({ error: 'Host nicht erlaubt' });
    next();
  });

  if (auth) app.use(basicAuth(auth));

  app.use(express.json({ limit: '1mb' }));

  app.get('/api/case', (req, res) => res.json(store.getCase()));

  app.put('/api/ratings/:source/:criterionId', (req, res) => {
    const { source, criterionId } = req.params;
    if (source !== 'md' && source !== 'own') throw new HttpError(404, 'Quelle muss md oder own sein');
    const criterion = criterionOrThrow(criterionId);
    const body = bodyOf(req);
    if (!('value' in body)) throw bad('Feld value fehlt');
    if (body.value === null) {
      store.clearRating(source, criterionId);
      return res.json({ value: null });
    }
    const result = validateValue(criterion, body.value);
    if (!result.ok) throw bad(`${criterionId}: ${result.error}`);
    store.setRating(source, criterionId, result.value);
    res.json({ value: result.value });
  });

  app.put('/api/justifications/:criterionId', (req, res) => {
    criterionOrThrow(req.params.criterionId);
    const { text, status } = bodyOf(req);
    if (text === undefined && status === undefined) throw bad('text oder status erwartet');
    if (text !== undefined && (typeof text !== 'string' || text.length > MAX_JUSTIFICATION)) {
      throw bad('text: Zeichenkette bis 100000 Zeichen erwartet');
    }
    if (status !== undefined && !JUSTIFICATION_STATUSES.includes(status)) {
      throw bad(`status muss einer von ${JUSTIFICATION_STATUSES.join(', ')} sein`);
    }
    res.json(store.setJustification(req.params.criterionId, { text, status }));
  });

  app.post('/api/notes', (req, res) => {
    const { criterionId = null, text } = bodyOf(req);
    if (criterionId !== null) criterionOrThrow(criterionId);
    if (typeof text !== 'string' || !text.trim() || text.length > MAX_NOTE) {
      throw bad('text: nicht leere Zeichenkette bis 20000 Zeichen erwartet');
    }
    res.status(201).json(store.addNote(criterionId, text.trim()));
  });

  app.delete('/api/notes/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || !store.deleteNote(id)) throw new HttpError(404, 'Notiz nicht gefunden');
    res.status(204).end();
  });

  app.put('/api/meta/:key', (req, res) => {
    const { key } = req.params;
    if (!META_KEYS.includes(key)) throw new HttpError(404, 'Unbekannter Meta-Schlüssel');
    const body = bodyOf(req);
    if (!('value' in body)) throw bad('Feld value fehlt');
    const value = sanitizeMeta(key, body.value);
    store.setMeta(key, value);
    res.json({ value });
  });

  app.get('/api/export.md', (req, res) => {
    res.set({
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': 'attachment; filename="widerspruch-begruendungen.md"',
      'Cache-Control': 'no-store'
    });
    res.send(buildExport(store.getCase()));
  });

  // Statische Dateien: kein Caching, damit nach einem Update nie veralteter Code läuft
  const staticOptions = { setHeaders: res => res.setHeader('Cache-Control', 'no-cache') };
  app.use('/shared', express.static(path.join(ROOT, 'shared'), staticOptions));
  app.use(express.static(path.join(ROOT, 'public'), staticOptions));

  app.use('/api', (req, res) => res.status(404).json({ error: 'Nicht gefunden' }));

  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Interner Fehler' : err.message });
  });

  return app;
}

function main() {
  const dataDir = process.env.DATA_DIR || path.join(ROOT, 'data');
  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT) || 3000;
  const onRailway = Boolean(process.env.RAILWAY_ENVIRONMENT_ID || process.env.RAILWAY_PROJECT_ID);
  const auth = authFromEnv();
  if (onRailway && !auth) {
    console.error('Abbruch: Auf Railway ist die Anwendung öffentlich erreichbar. Setzen Sie BASIC_AUTH_USER und BASIC_AUTH_PASS.');
    process.exit(1);
  }
  if (onRailway && !process.env.RAILWAY_VOLUME_MOUNT_PATH) {
    console.warn('WARNUNG: Kein Volume an diesem Dienst. Die Daten gehen beim nächsten Deployment verloren. Volume mit Mount-Pfad /data anlegen.');
  }
  const store = openStore(dataDir);
  const app = createApp(store, { auth });
  const server = app.listen(port, host, () => {
    console.log(`Pflegegrad-Widerspruch läuft auf http://${host}:${port} (Daten: ${dataDir})`);
  });
  const shutdown = () => {
    server.close(() => {
      store.close();
      process.exit(0);
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
