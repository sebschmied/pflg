// API-Zugriff und Autosave: Änderungen werden entprellt gespeichert, pro Schlüssel nacheinander,
// Fehler bleiben sichtbar und werden automatisch wiederholt.

export async function api(method, url, body, opts = {}) {
  const payload = body !== undefined ? JSON.stringify(body) : undefined;
  const res = await fetch(url, {
    method,
    headers: payload !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: payload,
    keepalive: Boolean(opts.keepalive) && (payload || '').length < 60000
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* keine JSON-Antwort */ }
  if (!res.ok) {
    const err = new Error(data?.error || `Fehler ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

const RETRY_MS = 5000;

// onStatus('saved' | 'saving' | 'error', Meldung)
export function createSaver(onStatus, delay = 500) {
  const pending = new Map();   // key -> { timer, fn }
  const chains = new Map();    // key -> Promise (Reihenfolge pro Schlüssel)
  const failures = new Map();  // key -> { fn, message, permanent }
  let inflight = 0;
  let retryTimer = null;

  function report() {
    if (failures.size > 0) {
      onStatus('error', [...failures.values()][0].message);
    } else if (inflight > 0 || pending.size > 0) {
      onStatus('saving');
    } else {
      onStatus('saved');
    }
  }

  function run(key, fn, opts) {
    inflight++;
    report();
    const prev = chains.get(key) || Promise.resolve();
    const p = prev
      .then(() => fn(opts))
      .then(() => { failures.delete(key); })
      .catch(err => {
        const permanent = err.status >= 400 && err.status < 500;
        failures.set(key, { fn, message: err.message || 'Speichern fehlgeschlagen', permanent });
        if (!permanent) scheduleRetry();
      })
      .finally(() => { inflight--; report(); });
    chains.set(key, p);
    return p;
  }

  function scheduleRetry() {
    if (retryTimer) return;
    retryTimer = setTimeout(() => { retryTimer = null; retry(); }, RETRY_MS);
  }

  function retry() {
    for (const [key, f] of [...failures]) {
      failures.delete(key);
      run(key, f.fn);
    }
  }

  function schedule(key, fn) {
    const old = pending.get(key);
    if (old) clearTimeout(old.timer);
    failures.delete(key);
    const timer = setTimeout(() => { pending.delete(key); run(key, fn); }, delay);
    pending.set(key, { timer, fn });
    report();
  }

  // Beim Verlassen der Seite: alles Ausstehende sofort senden
  function flush() {
    for (const [key, { timer, fn }] of [...pending]) {
      clearTimeout(timer);
      pending.delete(key);
      run(key, fn, { keepalive: true });
    }
  }

  return {
    schedule,
    flush,
    retry,
    hasFailures: () => failures.size > 0
  };
}
