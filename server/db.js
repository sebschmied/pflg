import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export const JUSTIFICATION_STATUSES = ['open', 'in_progress', 'done'];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS ratings (
  criterion_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('md', 'own')),
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (criterion_id, source)
);
CREATE TABLE IF NOT EXISTS justifications (
  criterion_id TEXT PRIMARY KEY,
  text TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'done')),
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  criterion_id TEXT,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

const now = () => new Date().toISOString();

// Öffnet (oder erzeugt) die SQLite-Datei im Datenverzeichnis und kapselt alle Abfragen.
export function openStore(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new Database(path.join(dataDir, 'case.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.exec(SCHEMA);

  const q = {
    allRatings: db.prepare('SELECT criterion_id, source, value FROM ratings'),
    upsertRating: db.prepare(`
      INSERT INTO ratings (criterion_id, source, value, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (criterion_id, source) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`),
    deleteRating: db.prepare('DELETE FROM ratings WHERE criterion_id = ? AND source = ?'),
    allJustifications: db.prepare('SELECT criterion_id, text, status, updated_at FROM justifications'),
    oneJustification: db.prepare('SELECT criterion_id, text, status, updated_at FROM justifications WHERE criterion_id = ?'),
    upsertJustification: db.prepare(`
      INSERT INTO justifications (criterion_id, text, status, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (criterion_id) DO UPDATE SET text = excluded.text, status = excluded.status, updated_at = excluded.updated_at`),
    allNotes: db.prepare('SELECT id, criterion_id, text, created_at FROM notes ORDER BY id'),
    insertNote: db.prepare('INSERT INTO notes (criterion_id, text, created_at) VALUES (?, ?, ?)'),
    deleteNote: db.prepare('DELETE FROM notes WHERE id = ?'),
    allMeta: db.prepare('SELECT key, value FROM meta'),
    upsertMeta: db.prepare(`
      INSERT INTO meta (key, value) VALUES (?, ?)
      ON CONFLICT (key) DO UPDATE SET value = excluded.value`),
    deleteMeta: db.prepare('DELETE FROM meta WHERE key = ?')
  };

  return {
    getCase() {
      const ratings = { md: {}, own: {} };
      for (const r of q.allRatings.all()) ratings[r.source][r.criterion_id] = JSON.parse(r.value);
      const justifications = {};
      for (const j of q.allJustifications.all()) {
        justifications[j.criterion_id] = { text: j.text, status: j.status, updatedAt: j.updated_at };
      }
      const notes = q.allNotes.all().map(n => ({
        id: n.id, criterionId: n.criterion_id, text: n.text, createdAt: n.created_at
      }));
      const meta = {};
      for (const m of q.allMeta.all()) meta[m.key] = JSON.parse(m.value);
      return { ratings, justifications, notes, meta };
    },

    setRating(source, criterionId, value) {
      q.upsertRating.run(criterionId, source, JSON.stringify(value), now());
    },

    clearRating(source, criterionId) {
      q.deleteRating.run(criterionId, source);
    },

    // Teil-Aktualisierung: fehlende Felder behalten ihren bisherigen Wert
    setJustification(criterionId, { text, status }) {
      const current = q.oneJustification.get(criterionId);
      const next = {
        text: text !== undefined ? text : current?.text ?? '',
        status: status !== undefined ? status : current?.status ?? 'open'
      };
      const updatedAt = now();
      q.upsertJustification.run(criterionId, next.text, next.status, updatedAt);
      return { ...next, updatedAt };
    },

    addNote(criterionId, text) {
      const createdAt = now();
      const info = q.insertNote.run(criterionId, text, createdAt);
      return { id: Number(info.lastInsertRowid), criterionId, text, createdAt };
    },

    deleteNote(id) {
      return q.deleteNote.run(id).changes > 0;
    },

    setMeta(key, value) {
      if (value === null) q.deleteMeta.run(key);
      else q.upsertMeta.run(key, JSON.stringify(value));
    },

    close() {
      db.close();
    }
  };
}
