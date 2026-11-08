import { MODULES, MODULES_BY_ID, CRITERIA_BY_ID, SEVERITY_LABELS } from '/shared/catalog.js';
import {
  scoreCase, deviations, crossCheck, normalizeValue, valuesEqual, describeValue, gradeRange, objectionRobustness
} from '/shared/scoring.js';
import { h, fmt, gradeText } from './dom.js';
import { api, createSaver } from './api.js';
import { createControl } from './controls.js';

const SHORT_NAMES = {
  1: 'Mobilität',
  2: 'Kognition & Kommunikation',
  3: 'Verhalten & Psyche',
  4: 'Selbstversorgung',
  5: 'Krankheitsbewältigung',
  6: 'Alltagsgestaltung'
};

const state = { ratings: { md: {}, own: {} }, justifications: {}, notes: [], meta: {} };
let calc = null;
let view = null;
let tabLinks = {};

const $ = id => document.getElementById(id);

// ---- Speichern ---------------------------------------------------------

function setStatus(kind, detail) {
  const el = $('save-status');
  el.dataset.state = kind;
  el.textContent = kind === 'saved' ? 'Alles gespeichert'
    : kind === 'saving' ? 'Speichert …'
    : `Speichern fehlgeschlagen: ${detail}`;
  $('retry-btn').hidden = kind !== 'error';
}

const saver = createSaver(setStatus);

function setRating(source, id, value, { silent = false } = {}) {
  if (value === null) delete state.ratings[source][id];
  else state.ratings[source][id] = value;
  saver.schedule(`rating:${source}:${id}`, opts => api('PUT', `/api/ratings/${source}/${id}`, { value }, opts));
  if (!silent) refresh();
}

function setMeta(key, value) {
  if (value === null) delete state.meta[key];
  else state.meta[key] = value;
  saver.schedule(`meta:${key}`, opts => api('PUT', `/api/meta/${key}`, { value }, opts));
}

const STATUS_LABELS = { open: 'offen', in_progress: 'in Bearbeitung', done: 'fertig' };
const noteDrafts = new Map();
const filters = { status: 'all', module: 'all' };

const justificationOf = id => state.justifications[id] || { text: '', status: 'open' };

function setJustification(id, patch) {
  state.justifications[id] = { ...justificationOf(id), ...patch };
  const field = Object.keys(patch)[0];
  saver.schedule(`justification:${id}:${field}`, opts => api('PUT', `/api/justifications/${id}`, patch, opts));
  refresh();
}

const timeText = iso => new Date(iso).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });

// Notizen-Log (kriterienbezogen oder allgemein). Notizen werden nicht exportiert.
function createNotesWidget(criterionId) {
  const key = criterionId ?? 'general';
  const list = h('ul', { class: 'note-list' });
  const input = h('textarea', {
    rows: '2', maxlength: '20000', 'aria-label': 'Neue Notiz',
    placeholder: criterionId
      ? 'Notiz zu diesem Kriterium, z. B. Frage an die Pflegekraft (wird nicht exportiert) …'
      : 'Allgemeine Notiz (wird nicht exportiert) …'
  });
  input.value = noteDrafts.get(key) || '';
  input.addEventListener('input', () => noteDrafts.set(key, input.value));
  input.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') add();
  });
  const error = h('p', { class: 'note-error', hidden: true });
  const addBtn = h('button', { type: 'button', class: 'btn small', onclick: () => add() }, 'Notiz hinzufügen');

  async function add() {
    const text = input.value.trim();
    if (!text) return;
    addBtn.disabled = true;
    error.hidden = true;
    try {
      const note = await api('POST', '/api/notes', { criterionId, text });
      state.notes.push(note);
      input.value = '';
      noteDrafts.delete(key);
      refresh();
    } catch (err) {
      error.textContent = `Notiz nicht gespeichert: ${err.message}`;
      error.hidden = false;
    } finally {
      addBtn.disabled = false;
    }
  }

  async function remove(note) {
    if (!confirm('Diese Notiz löschen?')) return;
    try {
      await api('DELETE', `/api/notes/${note.id}`);
      state.notes = state.notes.filter(n => n.id !== note.id);
      refresh();
    } catch (err) {
      error.textContent = `Notiz nicht gelöscht: ${err.message}`;
      error.hidden = false;
    }
  }

  const body = h('div', { class: 'notes-body' },
    list, input,
    h('div', { class: 'notes-actions' }, addBtn, h('span', { class: 'muted small', text: 'Strg+Enter zum Speichern' })),
    error
  );
  const summary = h('summary');
  const el = criterionId
    ? h('details', { class: 'notes', open: state.notes.some(n => n.criterionId === criterionId) }, summary, body)
    : h('div', { class: 'notes general' }, body);

  function update() {
    const notes = state.notes.filter(n => (n.criterionId ?? null) === criterionId);
    summary.textContent = `Notizen (${notes.length})`;
    list.replaceChildren(...notes.map(n => h('li', { class: 'note' },
      h('div', { class: 'note-meta' },
        h('span', { text: timeText(n.createdAt) }),
        h('button', { type: 'button', class: 'link', onclick: () => remove(n) }, 'löschen')),
      h('div', { class: 'note-text', text: n.text })
    )));
  }
  return { el, update };
}

// ---- Berechnung --------------------------------------------------------

// Die Tragfähigkeitsprüfung rechnet viele Varianten durch. Ergebnis merken, solange sich keine Bewertung ändert
// (Begründungen und Notizen lösen ebenfalls recompute() aus).
let robustCache = { key: '', value: null };
function robustness() {
  const key = JSON.stringify([state.ratings.md, state.ratings.own]);
  if (robustCache.key !== key) robustCache = { key, value: objectionRobustness(state.ratings.md, state.ratings.own) };
  return robustCache.value;
}

function recompute() {
  calc = {
    md: scoreCase(state.ratings.md),
    own: scoreCase(state.ratings.own),
    devs: deviations(state.ratings.md, state.ratings.own),
    robust: robustness()
  };
  calc.devIds = new Set(calc.devs.map(d => d.criterionId));
  calc.devByModule = Object.fromEntries(MODULES.map(m => [m.id, 0]));
  for (const d of calc.devs) calc.devByModule[CRITERIA_BY_ID[d.criterionId].module]++;
}

function refresh() {
  recompute();
  updateTabs();
  if (view) view.update();
}

function isCounted(score, moduleId) {
  return (moduleId !== 2 && moduleId !== 3) || score.counted23 === moduleId;
}

// Modul 2/3 verliert gegen das andere: Eingaben dort ändern den Pflegegrad nicht.
// Ohne Punkte im anderen Modul gibt es nichts zu verlieren (null).
function voidInfo(score, moduleId) {
  if (moduleId !== 2 && moduleId !== 3) return null;
  if (isCounted(score, moduleId)) return null;
  const other = moduleId === 2 ? 3 : 2;
  const otherW = score.modules[other].weightedPoints;
  if (otherW <= 0) return null;
  return { other, otherW, ownW: score.modules[moduleId].weightedPoints, strict: moduleId === 3 };
}

const countedWeighted = (score, m) => (isCounted(score, m.id) ? score.modules[m.id].weightedPoints : 0);
const signed = n => (n > 0 ? `+${fmt(n)}` : fmt(n));

// ---- Reiter ------------------------------------------------------------

function buildTabs() {
  const nav = $('tabs');
  nav.replaceChildren();
  tabLinks = {};
  const add = (key, href, label) => {
    const count = h('span', { class: 'count', hidden: true });
    const name = h('span', { text: label });
    const a = h('a', { class: 'tab', href }, name, count);
    tabLinks[key] = { a, count, name };
    nav.append(a);
  };
  add('overview', '#/overview', 'Übersicht');
  for (const m of MODULES) add(`m${m.id}`, `#/m/${m.id}`, `${m.id} ${SHORT_NAMES[m.id]}`);
}

function currentRoute() {
  const match = location.hash.match(/^#\/m\/([1-6])(?:\/(\d\.\d+))?$/);
  return match ? { name: 'module', id: Number(match[1]), criterion: match[2] || null } : { name: 'overview' };
}

function updateTabs() {
  const route = currentRoute();
  const activeKey = route.name === 'module' ? `m${route.id}` : 'overview';
  for (const [key, { a, count, name }] of Object.entries(tabLinks)) {
    a.classList.toggle('active', key === activeKey);
    const moduleId = key === 'overview' ? 0 : Number(key.slice(1));
    const dead = voidInfo(calc.own, moduleId);
    name.classList.toggle('struck', Boolean(dead));
    if (dead) a.title = `Modul ${moduleId} zählt bei Ihrer Bewertung nicht (Modul ${dead.other} ist höher)`;
    else a.removeAttribute('title');
    if (key === 'overview') {
      count.hidden = calc.devs.length === 0;
      count.textContent = String(calc.devs.length);
      count.title = 'Abweichungen insgesamt';
    } else {
      const n = calc.devByModule[Number(key.slice(1))];
      count.hidden = n === 0;
      count.textContent = String(n);
      count.title = 'Abweichungen in diesem Modul';
    }
  }
}

function show() {
  const route = currentRoute();
  view = route.name === 'module' ? renderModule(MODULES_BY_ID[route.id]) : renderOverview();
  $('view').replaceChildren(...view.nodes);
  recompute();
  updateTabs();
  view.update();
  const target = route.criterion ? document.getElementById(`crit-${route.criterion}`) : null;
  if (target) {
    target.scrollIntoView({ block: 'start' });
    target.classList.add('flash');
    setTimeout(() => target.classList.remove('flash'), 1800);
  } else {
    window.scrollTo(0, 0);
  }
}

// ---- Übersicht ---------------------------------------------------------

function verdict() {
  const { md, own } = calc;
  let kind = 'info';
  let text;
  if (md.answered === 0) {
    text = 'Tragen Sie zuerst die Bewertungen aus dem MD-Gutachten ein (Reiter 1 bis 6). Danach folgt Ihre eigene Bewertung.';
  } else if (own.answered === 0) {
    text = 'MD-Werte sind erfasst. Tragen Sie nun Ihre eigene Bewertung ein. Mit „MD-Wert übernehmen“ können Sie übereinstimmende Kriterien schnell füllen.';
  } else if (own.pflegegrad > md.pflegegrad) {
    kind = 'good';
    text = `Mit Ihrer Bewertung ergibt sich ${gradeText(own.pflegegrad)} statt ${gradeText(md.pflegegrad)}. Ein Widerspruch kann den Pflegegrad ändern.`;
  } else if (own.totalWeighted > md.totalWeighted) {
    kind = 'warn';
    const next = own.nextPflegegrad
      ? ` Bis ${gradeText(own.nextPflegegrad)} fehlen noch ${fmt(own.pointsToNext)} gewichtete Punkte.`
      : '';
    text = `Ihre Bewertung ergibt ${fmt(own.totalWeighted - md.totalWeighted)} gewichtete Punkte mehr, aber denselben Pflegegrad (${gradeText(own.pflegegrad)}).${next}`;
  } else if (own.totalWeighted < md.totalWeighted) {
    kind = 'bad';
    text = `Ihre Bewertung liegt mit ${fmt(own.totalWeighted)} Punkten unter der des MD (${fmt(md.totalWeighted)}). Prüfen Sie Ihre Eingaben.`;
  } else {
    text = 'Ihre Bewertung führt zum gleichen Ergebnis wie die des MD. Ein Widerspruch würde den Pflegegrad nicht ändern.';
  }
  if (md.answered > 0 && own.answered > 0 && !own.complete) {
    text += ' Hinweis: Nicht bewertete Kriterien zählen mit 0 Punkten, das Ergebnis ist vorläufig.';
  }
  return { kind, text };
}

function resultCard(kind, title, s) {
  const next = s.nextPflegegrad
    ? `Noch ${fmt(s.pointsToNext)} Punkte bis ${gradeText(s.nextPflegegrad)}`
    : 'Höchster Pflegegrad erreicht';
  return h('section', { class: `card result-card ${kind}` },
    h('div', { class: 'label', text: title }),
    h('div', { class: 'grade', text: gradeText(s.pflegegrad) }),
    h('div', { class: 'points', text: `${fmt(s.totalWeighted)} gewichtete Punkte` }),
    h('div', { class: 'next', text: next }),
    s.complete ? null : h('div', { class: 'partial', text: `Vorläufig: ${s.answered} von ${s.total} Kriterien bewertet` })
  );
}

function deltaCard() {
  const { md, own, devs } = calc;
  const dg = own.pflegegrad - md.pflegegrad;
  const dp = own.totalWeighted - md.totalWeighted;
  const cls = dg > 0 || (dg === 0 && dp > 0) ? 'delta-up' : dp < 0 ? 'delta-down' : '';
  const gradeLine = dg === 0 ? 'Gleicher Pflegegrad' : `${dg > 0 ? '+' : ''}${dg} Pflegegrad${Math.abs(dg) > 1 ? 'e' : ''}`;
  return h('section', { class: 'card result-card diff' },
    h('div', { class: 'label', text: 'Unterschied' }),
    h('div', { class: `grade ${cls}`, text: gradeLine }),
    h('div', { class: 'points', text: `${signed(dp)} gewichtete Punkte` }),
    h('div', { class: 'next', text: `${devs.length} Kriterien mit Abweichung` })
  );
}

// Lage der Gesamtpunkte innerhalb der Pflegegrad-Bereiche und Belastbarkeit eines Widerspruchs
function rangeCard() {
  const { md, own, robust } = calc;
  const pct = n => Math.max(0, Math.min(100, n));
  const hasBoth = md.answered > 0 && own.answered > 0;

  const segments = [0, 1, 2, 3, 4, 5].map(g => {
    const r = gradeRange(g);
    return h('div', {
      class: `seg g${g}${own.pflegegrad === g ? ' own-here' : ''}${md.pflegegrad === g ? ' md-here' : ''}`,
      style: `left:${r.lower}%;width:${r.upper - r.lower}%`,
      title: g === 0 ? `bis unter ${fmt(r.upper)} Punkte` : `${fmt(r.lower)} bis unter ${fmt(r.upper)} Punkte${g === 5 ? ' (bis 100)' : ''}`
    }, h('span', { text: g === 0 ? 'kein PG' : `PG ${g}` }));
  });
  const ticks = [12.5, 27, 47.5, 70, 90].map(v =>
    h('div', { class: 'tick', style: `left:${v}%` }, h('span', { text: fmt(v) })));

  const marker = (cls, label, score, above) => h('div', {
    class: `marker ${cls} ${above ? 'above' : 'below'}`, style: `left:${pct(score)}%`,
    title: `${label}: ${fmt(score)} gewichtete Punkte`
  }, h('span', { class: 'marker-label', text: `${label} ${fmt(score)}` }), h('span', { class: 'marker-pin' }));

  const markers = [];
  if (md.answered > 0) markers.push(marker('md', 'MD', md.totalWeighted, true));
  if (own.answered > 0) markers.push(marker('own', 'Eigene', own.totalWeighted, false));
  const worst = robust.singles[0];
  if (worst && robust.level !== 'none' && worst.total !== own.totalWeighted) {
    markers.push(h('div', {
      class: 'marker ghost', style: `left:${pct(worst.total)}%`,
      title: `Eigene Punkte, falls der MD bei ${worst.criterionId} recht behält: ${fmt(worst.total)}`
    }, h('span', { class: 'marker-pin' })));
  }

  const bar = h('div', { class: 'range-bar' },
    h('div', { class: 'range-track' }, segments, ticks, markers));

  const facts = [];
  if (md.answered > 0) {
    const mdRange = gradeRange(md.pflegegrad);
    facts.push(md.nextPflegegrad
      ? `MD: ${fmt(md.totalWeighted)} Punkte, ${fmt(md.pointsToNext)} unter der Grenze zu ${gradeText(md.nextPflegegrad)} (ab ${fmt(mdRange.upper)}).`
      : `MD: ${fmt(md.totalWeighted)} Punkte, höchster Pflegegrad.`);
  }
  if (own.answered > 0) {
    const ownRange = gradeRange(own.pflegegrad);
    const above = own.pflegegrad > 0 ? ` ${fmt(own.totalWeighted - ownRange.lower)} Punkte über der Untergrenze von ${gradeText(own.pflegegrad)} (ab ${fmt(ownRange.lower)}).` : '';
    facts.push(`Eigene Bewertung: ${fmt(own.totalWeighted)} Punkte.${above}`);
  }

  let kind = 'info';
  let title = '';
  const details = [];
  if (!hasBoth) {
    title = 'Sobald MD-Werte und eigene Werte erfasst sind, sehen Sie hier, wie belastbar ein Widerspruch ist.';
  } else if (robust.level === 'none') {
    kind = own.totalWeighted > md.totalWeighted ? 'warn' : 'info';
    title = 'Mit Ihrer Bewertung ergibt sich kein höherer Pflegegrad.';
    if (own.nextPflegegrad) details.push(`Bis ${gradeText(own.nextPflegegrad)} fehlen Ihnen noch ${fmt(own.pointsToNext)} gewichtete Punkte.`);
  } else {
    const names = robust.singles.slice(0, 3).map(s => h('li', null,
      h('a', { href: `#/m/${CRITERIA_BY_ID[s.criterionId].module}/${s.criterionId}`, text: `${s.criterionId} ${CRITERIA_BY_ID[s.criterionId].name}` }),
      ` – ${s.losesGain ? 'ohne dieses Kriterium entfällt der höhere Pflegegrad' : s.lost > 0 ? `ohne dieses Kriterium ${fmt(s.lost)} Punkte weniger, der höhere Pflegegrad bleibt` : 'allein ohne Einfluss auf den Pflegegrad (wirkt nur zusammen mit anderen)'}`));
    if (robust.level === 'fragile') {
      kind = 'bad';
      title = 'Knapp: Der Erfolg hängt an einem einzelnen Kriterium.';
      details.push('Behält der MD bei nur einem dieser Kriterien recht, bleibt es beim bisherigen Pflegegrad. Diese Begründungen müssen besonders überzeugen:');
    } else if (robust.level === 'tight') {
      kind = 'warn';
      title = 'Mittel: Schon zwei Kriterien genügen, damit der Widerspruch scheitern kann.';
      details.push('Einzeln reicht keine Abweichung aus. Am meisten Gewicht haben:');
    } else {
      kind = 'good';
      title = 'Deutlich: Der MD müsste bei mindestens drei Abweichungen recht behalten.';
      details.push('Die Abweichungen stützen sich gegenseitig. Zuerst zu prüfen:');
    }
    details.push(h('ul', null, names));
    details.push(h('p', { class: 'muted small', text: 'Geprüft wird, ob der höhere Pflegegrad bestehen bleibt, wenn der MD bei einzelnen Abweichungen (alle Einzelfälle und alle Zweierkombinationen) recht behält. Die rote gestrichelte Linie in der Skala zeigt Ihre Punkte, falls der MD beim gewichtigsten Kriterium recht behält (nur sichtbar, wenn das etwas ändert). Das ist eine Rechenhilfe, keine Prognose der Entscheidung.' }));
  }

  return h('section', { class: 'card range-card' },
    h('h2', { text: 'Wo liegen wir im Pflegegrad-Bereich?' }),
    h('p', { class: 'muted small', text: 'Gewichtete Gesamtpunkte von 0 bis 100. Je weiter ein Wert von der nächsten Grenze entfernt ist, desto sicherer ist das Ergebnis.' }),
    bar,
    h('ul', { class: 'range-facts' }, facts.map(f => h('li', { text: f }))),
    h('div', { class: `banner ${kind}` }, h('strong', { class: 'range-title', text: title }), details)
  );
}

function moduleTable() {
  const cell = (content, cls) => h('td', { class: cls }, content);
  const sideCells = (s, m) => {
    const ms = s.modules[m.id];
    const w = fmt(ms.weightedPoints);
    return [
      cell(`${ms.rawPoints} / ${m.maxRaw}`),
      cell(isCounted(s, m.id) ? w : [h('s', { text: w }), h('span', { class: 'no-count', text: 'zählt nicht' })])
    ];
  };
  const rows = MODULES.map(m => h('tr', null,
    h('td', { class: 'name' }, h('a', { href: `#/m/${m.id}`, text: `${m.id} ${SHORT_NAMES[m.id]}` })),
    cell(`${m.weight} %`),
    ...sideCells(calc.md, m),
    ...sideCells(calc.own, m),
    cell(signed(countedWeighted(calc.own, m) - countedWeighted(calc.md, m))),
    cell(calc.devByModule[m.id] > 0 ? h('span', { class: 'pill', text: String(calc.devByModule[m.id]) }) : '–')
  ));
  rows.push(h('tr', { class: 'total' },
    cell('Summe gewichtete Punkte'), cell(''), cell(''), cell(fmt(calc.md.totalWeighted)),
    cell(''), cell(fmt(calc.own.totalWeighted)),
    cell(signed(calc.own.totalWeighted - calc.md.totalWeighted)), cell(String(calc.devs.length))
  ));
  return h('table', null,
    h('thead', null,
      h('tr', null,
        h('th', { rowspan: '2', text: 'Modul' }), h('th', { rowspan: '2', text: 'Gewicht' }),
        h('th', { colspan: '2', text: 'MD-Gutachten' }), h('th', { colspan: '2', text: 'Eigene Bewertung' }),
        h('th', { rowspan: '2', text: 'Unterschied' }), h('th', { rowspan: '2', text: 'Abweichungen' })
      ),
      h('tr', null, h('th', { text: 'Einzelpunkte' }), h('th', { text: 'gewichtet' }), h('th', { text: 'Einzelpunkte' }), h('th', { text: 'gewichtet' }))
    ),
    h('tbody', null, rows)
  );
}

function createWorklist() {
  const statusSel = h('select', { 'aria-label': 'Nach Status filtern' },
    [['all', 'Alle Status'], ['missing', 'Begründung fehlt'], ['open', 'offen'], ['in_progress', 'in Bearbeitung'], ['done', 'fertig']]
      .map(([v, t]) => h('option', { value: v, text: t })));
  const moduleSel = h('select', { 'aria-label': 'Nach Modul filtern' },
    h('option', { value: 'all', text: 'Alle Module' }),
    MODULES.map(m => h('option', { value: String(m.id), text: `Modul ${m.id}: ${SHORT_NAMES[m.id]}` })));
  statusSel.value = filters.status;
  moduleSel.value = filters.module;
  statusSel.addEventListener('change', () => { filters.status = statusSel.value; update(); });
  moduleSel.addEventListener('change', () => { filters.module = moduleSel.value; update(); });

  const summary = h('p', { class: 'worklist-summary' });
  const list = h('ul', { class: 'worklist' });
  const el = h('section', { class: 'card' },
    h('h2', { text: 'Abweichungen und Begründungen' }),
    summary,
    h('div', { class: 'filters' }, statusSel, moduleSel),
    list
  );

  function update() {
    const items = calc.devs.map(d => {
      const j = justificationOf(d.criterionId);
      return { d, c: CRITERIA_BY_ID[d.criterionId], j, missing: j.text.trim() === '' };
    });
    const missing = items.filter(i => i.missing).length;
    const notDone = items.filter(i => i.j.status !== 'done').length;
    summary.className = `worklist-summary${missing > 0 ? ' warn-text' : ''}`;
    summary.textContent = items.length === 0
      ? 'Noch keine Abweichungen. Sobald sich MD- und eigene Bewertung unterscheiden, erscheinen sie hier.'
      : `${items.length} Abweichungen · ${missing} ohne Begründung · ${notDone} noch nicht fertig`;

    const shown = items.filter(i =>
      (filters.module === 'all' || String(i.c.module) === filters.module) &&
      (filters.status === 'all' || (filters.status === 'missing' ? i.missing : i.j.status === filters.status)));
    const rows = shown.map(i => h('li', { class: 'work-item' },
      h('div', { class: 'work-main' },
        h('a', { class: 'work-link', href: `#/m/${i.c.module}/${i.c.id}`, text: `${i.c.id} ${i.c.name}` }),
        h('div', { class: 'work-values muted small', text: `MD: ${describeValue(i.c, i.d.md)} → eigene: ${describeValue(i.c, i.d.own)}` })),
      h('div', { class: 'work-badges' },
        i.missing ? h('span', { class: 'badge missing', text: 'Begründung fehlt' }) : null,
        h('span', { class: `badge status ${i.j.status}`, text: STATUS_LABELS[i.j.status] }))
    ));
    if (rows.length === 0 && items.length > 0) rows.push(h('li', { class: 'muted small', text: 'Keine Einträge für diesen Filter.' }));
    list.replaceChildren(...rows);
  }
  return { el, update };
}

function renderOverview() {
  const verdictBox = h('div', { class: 'banner info' });
  const crossBanner = h('div', { class: 'banner warn', hidden: true });
  const cards = h('div', { class: 'result-cards' });
  const rangeWrap = h('div', { class: 'range-wrap' });
  const tableWrap = h('div', { class: 'table-wrap' });
  const tableCard = h('section', { class: 'card' },
    h('h2', { text: 'Module im Vergleich' }),
    h('p', { class: 'muted small', text: 'Für den Pflegegrad zählt von Modul 2 und Modul 3 nur der höhere gewichtete Wert; der andere ist durchgestrichen.' }),
    tableWrap
  );

  const worklist = createWorklist();
  const generalNotes = createNotesWidget(null);
  const notesCard = h('section', { class: 'card' },
    h('h2', { text: 'Allgemeine Notizen' }),
    h('p', { class: 'muted small', text: 'Für alles, was zu keinem einzelnen Kriterium gehört, z. B. Gesprächstermine. Notizen werden nicht exportiert.' }),
    generalNotes.el
  );

  // Gegenprobe: im Gutachten gedruckte Werte
  const inputs = {};
  const statuses = {};
  const printedField = (key, label, max, step) => {
    const input = h('input', { type: 'number', min: '0', max: String(max), step, id: `printed-${key}`, 'aria-label': label });
    input.addEventListener('input', savePrinted);
    const status = h('div', { class: 'printed-status' });
    inputs[key] = input;
    statuses[key] = status;
    return h('div', { class: 'printed-field' }, h('label', { for: `printed-${key}`, text: label }), input, status);
  };
  const grid = h('div', { class: 'printed-grid' },
    MODULES.map(m => printedField(`m${m.id}`, `Modul ${m.id}: Summe der Einzelpunkte`, m.maxRaw, 'any')),
    printedField('total', 'Gewichtete Gesamtpunkte', 100, 'any'),
    printedField('pflegegrad', 'Pflegegrad (0 = keiner)', 5, '1')
  );
  const printedCard = h('section', { class: 'card' },
    h('h2', { text: 'Gegenprobe zum MD-Gutachten' }),
    h('p', { class: 'muted small', text: 'Tragen Sie die im Gutachten gedruckten Punkte ein. Die Anwendung vergleicht sie mit der Berechnung aus Ihren MD-Eingaben und warnt bei Abweichungen. So finden Sie Übertragungsfehler.' }),
    grid
  );

  const printed = state.meta.md_printed || {};
  for (const m of MODULES) inputs[`m${m.id}`].value = printed.raw?.[m.id] ?? '';
  inputs.total.value = printed.total ?? '';
  inputs.pflegegrad.value = printed.pflegegrad ?? '';

  function savePrinted() {
    const raw = {};
    for (const m of MODULES) {
      const v = inputs[`m${m.id}`].value;
      if (v !== '') raw[m.id] = Math.min(m.maxRaw, Math.max(0, Number(v)));
    }
    const value = { raw };
    if (inputs.total.value !== '') value.total = Math.min(100, Math.max(0, Number(inputs.total.value)));
    if (inputs.pflegegrad.value !== '') value.pflegegrad = Math.min(5, Math.max(0, Math.round(Number(inputs.pflegegrad.value))));
    const empty = Object.keys(raw).length === 0 && value.total === undefined && value.pflegegrad === undefined;
    setMeta('md_printed', empty ? null : value);
    refresh();
  }

  function setPrintedStatus(key, printedValue, computed) {
    const el = statuses[key];
    const has = typeof printedValue === 'number';
    if (!has) {
      el.className = 'printed-status';
      el.textContent = `Berechnet aus Ihren MD-Eingaben: ${fmt(computed)}`;
    } else if (printedValue === computed) {
      el.className = 'printed-status ok';
      el.textContent = '✓ stimmt mit der Berechnung überein';
    } else {
      el.className = 'printed-status bad';
      el.textContent = `⚠ Berechnet: ${fmt(computed)}`;
    }
  }

  function update() {
    const v = verdict();
    verdictBox.className = `banner ${v.kind}`;
    verdictBox.textContent = v.text;

    cards.replaceChildren(
      resultCard('md', 'MD-Gutachten', calc.md),
      resultCard('own', 'Eigene Bewertung', calc.own),
      deltaCard()
    );
    rangeWrap.replaceChildren(rangeCard());
    tableWrap.replaceChildren(moduleTable());
    worklist.update();
    generalNotes.update();

    const pr = state.meta.md_printed;
    const issues = crossCheck(calc.md, pr);
    crossBanner.hidden = issues.length === 0;
    if (issues.length) {
      const lines = issues.map(i => {
        const what = i.kind === 'module' ? `Modul ${i.moduleId}` : i.kind === 'total' ? 'Gewichtete Gesamtpunkte' : 'Pflegegrad';
        return h('li', { text: `${what}: im Gutachten ${fmt(i.printed)}, berechnet ${fmt(i.computed)}` });
      });
      crossBanner.replaceChildren(
        h('strong', { text: 'Die gedruckten Punkte des Gutachtens passen nicht zu Ihren MD-Eingaben.' }),
        h('ul', null, lines),
        h('p', { class: 'small', text: calc.md.complete
          ? 'Prüfen Sie, ob ein MD-Wert falsch übertragen wurde.'
          : 'Die MD-Eingabe ist noch unvollständig, Abweichungen sind dann zu erwarten.' })
      );
    }
    for (const m of MODULES) setPrintedStatus(`m${m.id}`, pr?.raw?.[m.id], calc.md.modules[m.id].rawPoints);
    setPrintedStatus('total', pr?.total, calc.md.totalWeighted);
    setPrintedStatus('pflegegrad', pr?.pflegegrad, calc.md.pflegegrad);
  }

  return { nodes: [verdictBox, crossBanner, cards, rangeWrap, tableCard, worklist.el, notesCard, printedCard], update };
}

// ---- Modulseite --------------------------------------------------------

const M5_GROUPS = {
  '5.1': {
    key: 'a',
    title: 'Kriterien 5.1 bis 5.7: Häufigkeit der Maßnahmen',
    text: 'Erfasst wird, wie oft pro Tag, Woche oder Monat Maßnahmen nötig sind, die nicht selbständig durchgeführt werden können (auf Dauer, voraussichtlich mindestens sechs Monate). Die Maßnahmen aller sieben Kriterien werden summiert und in Maßnahmen pro Tag umgerechnet (Woche ÷ 7, Monat ÷ 30). Einzelpunkte: 0 = seltener als einmal täglich, 1 = ein- bis dreimal täglich, 2 = mehr als drei- bis achtmal täglich, 3 = mehr als achtmal täglich.'
  },
  '5.8': {
    key: 'b',
    title: 'Kriterien 5.8 bis 5.11: Häufigkeit der Maßnahmen',
    text: 'Auch hier werden die Maßnahmen aller vier Kriterien summiert und in Maßnahmen pro Tag umgerechnet. Einzelpunkte: 0 = seltener als einmal wöchentlich, 1 = ein- bis mehrmals wöchentlich, 2 = ein- bis unter dreimal täglich, 3 = mindestens dreimal täglich.'
  },
  '5.12': {
    key: 'c',
    title: 'Kriterien 5.12 bis 5.15: zeit- und technikintensive Maßnahmen, Arztbesuche, Einrichtungsbesuche',
    text: 'Pro Kriterium zählen die regelmäßigen wöchentlichen und monatlichen Maßnahmen bzw. Besuche mit dem jeweils genannten Punktefaktor. Die Punkte der vier Kriterien werden addiert. Einzelpunkte: unter 4,3 = 0, ab 4,3 = 1, ab 8,6 = 2, ab 12,9 = 3, ab 60 = 6.'
  }
};

function renderModule(m) {
  const rows = [];
  const groupLines = {};

  const mdBox = h('section', { class: 'sum-box' }, h('h3', { text: 'MD-Gutachten' }));
  const mdBody = h('div');
  mdBox.append(mdBody);
  const ownBox = h('section', { class: 'sum-box' }, h('h3', { text: 'Eigene Bewertung' }));
  const ownBody = h('div');
  ownBox.append(ownBody);

  const prefillInfo = h('span', { class: 'muted small' });
  const devLine = h('p', { class: 'small' });
  const voidBanner = h('div', { class: 'void-banner', hidden: true });
  const prefillBtn = h('button', {
    type: 'button', class: 'btn small',
    title: 'Füllt nur eigene Felder, die noch leer sind, mit dem Wert des MD',
    onclick: () => {
      let n = 0;
      for (const row of rows) {
        const id = row.criterion.id;
        if (state.ratings.md[id] != null && state.ratings.own[id] == null) {
          const v = structuredClone(state.ratings.md[id]);
          row.own.set(v);
          setRating('own', id, v, { silent: true });
          n++;
        }
      }
      prefillInfo.textContent = n ? `${n} Kriterien übernommen. Passen Sie jetzt die abweichenden an.` : 'Nichts zu übernehmen.';
      refresh();
    }
  }, 'Leere eigene Felder mit MD-Werten vorbelegen');

  const head = h('section', { class: 'card module-head' },
    h('h2', { text: `Modul ${m.id}: ${m.name}` }),
    h('p', { text: m.desc }),
    h('p', { class: 'muted small', text: `Gewichtung ${m.weight} % am Gesamtergebnis${m.id === 2 || m.id === 3 ? '. Von Modul 2 und 3 zählt nur der höhere gewichtete Wert.' : '.'}` }),
    voidBanner,
    devLine,
    h('div', { class: 'module-summary' }, mdBox, ownBox),
    h('div', { class: 'module-actions' }, prefillBtn, prefillInfo)
  );

  const nodes = [head];

  for (const c of m.criteria) {
    const group = m.id === 5 ? M5_GROUPS[c.id] : null;
    if (group) {
      const line = h('p', { class: 'small' });
      groupLines[group.key] = line;
      nodes.push(h('div', { class: 'group-head' }, h('section', { class: 'card' },
        h('h3', { text: group.title }), h('p', { class: 'muted small', text: group.text }), line)));
    }
    const row = buildRow(c);
    rows.push(row);
    nodes.push(row.el);
  }

  function buildRow(c) {
    const md = createControl(c, v => setRating('md', c.id, v), `${c.id} ${c.name}: MD-Gutachten`);
    const own = createControl(c, v => setRating('own', c.id, v), `${c.id} ${c.name}: eigene Bewertung`);
    md.set(state.ratings.md[c.id] ?? null);
    own.set(state.ratings.own[c.id] ?? null);

    const devBadge = h('span', { class: 'badge dev', text: 'Abweichung', hidden: true });
    const sameBadge = h('span', { class: 'badge same', text: 'übereinstimmend', hidden: true });
    const copyBtn = h('button', {
      type: 'button', class: 'link', hidden: true,
      onclick: () => {
        const v = structuredClone(state.ratings.md[c.id]);
        own.set(v);
        setRating('own', c.id, v);
      }
    }, 'MD-Wert übernehmen');
    const extra = h('div', { class: 'crit-extra' });
    const cur = justificationOf(c.id);
    const textarea = h('textarea', {
      rows: '4', maxlength: '100000', 'aria-label': `${c.id} ${c.name}: Begründung`,
      placeholder: 'Begründen Sie die abweichende Bewertung: konkrete Beobachtungen, Häufigkeit, Art und Umfang der nötigen Hilfe, Beispiele aus dem Alltag …'
    });
    textarea.value = cur.text;
    const statusSel = h('select', { 'aria-label': `${c.id}: Status der Begründung` },
      Object.entries(STATUS_LABELS).map(([v, t]) => h('option', { value: v, text: t })));
    statusSel.value = cur.status;
    const fit = () => {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.max(96, textarea.scrollHeight + 2)}px`;
    };
    textarea.addEventListener('input', () => { fit(); setJustification(c.id, { text: textarea.value }); });
    statusSel.addEventListener('change', () => setJustification(c.id, { status: statusSel.value }));
    const missingTag = h('span', { class: 'badge missing', text: 'Begründung fehlt', hidden: true });
    const justNote = h('p', { class: 'hint' });
    const justBlock = h('div', { class: 'just', hidden: true },
      h('div', { class: 'just-head' },
        h('label', { class: 'just-title', text: 'Begründung' }), missingTag,
        h('label', { class: 'status-label' }, 'Status ', statusSel)),
      textarea, justNote);
    const notes = createNotesWidget(c.id);
    extra.append(justBlock, notes.el);

    const mdVoidTag = h('span', { class: 'void-tag', text: 'zählt nicht', hidden: true });
    const ownVoidTag = h('span', { class: 'void-tag', text: 'zählt nicht', hidden: true });
    const el = h('article', { class: 'crit', id: `crit-${c.id}`, 'data-state': 'open' },
      h('div', { class: 'crit-head' },
        h('span', { class: 'crit-id', text: c.id }), h('h3', { text: c.name }), devBadge, sameBadge),
      c.type === 'freq' ? null : h('p', { class: 'crit-text', text: c.text }),
      h('div', { class: 'crit-cols' },
        h('section', { class: 'col md' }, h('h4', null, 'MD-Gutachten ', mdVoidTag), md.el),
        h('section', { class: 'col own' }, h('h4', null, 'Eigene Bewertung ', ownVoidTag), own.el, copyBtn)
      ),
      extra
    );

    function update() {
      const mdV = normalizeValue(c, state.ratings.md[c.id]);
      const ownV = normalizeValue(c, state.ratings.own[c.id]);
      let st = 'open';
      if (mdV !== null && ownV !== null) st = valuesEqual(mdV, ownV) ? 'same' : 'deviation';
      el.dataset.state = st;
      const mdVoid = Boolean(voidInfo(calc.md, m.id));
      const ownVoid = Boolean(voidInfo(calc.own, m.id));
      el.classList.toggle('void-md', mdVoid);
      el.classList.toggle('void-own', ownVoid);
      mdVoidTag.hidden = !mdVoid;
      ownVoidTag.hidden = !ownVoid;
      devBadge.hidden = st !== 'deviation';
      sameBadge.hidden = st !== 'same';
      copyBtn.hidden = mdV === null || st === 'same';
      const text = justificationOf(c.id).text.trim();
      justBlock.hidden = !(st === 'deviation' || text !== '');
      missingTag.hidden = !(st === 'deviation' && text === '');
      justNote.textContent = st === 'deviation'
        ? 'Pflicht: Jede Abweichung muss begründet werden. Die Begründung wird exportiert.'
        : 'Die Bewertungen stimmen derzeit überein: Diese Begründung bleibt gespeichert, wird aber nicht exportiert.';
      if (!justBlock.hidden) fit();
      notes.update();
    }
    return { criterion: c, el, md, own, extra, update };
  }

  function fillSummary(body, s, printedRaw) {
    const ms = s.modules[m.id];
    const lines = [
      h('div', { class: 'big', text: `${ms.rawPoints} von ${m.maxRaw} Einzelpunkten` }),
      h('div', { text: `Schweregrad ${SEVERITY_LABELS[ms.severity]} (Bereich ${m.bandLabels[ms.severity]}) → ${fmt(ms.weightedPoints)} von ${m.weight} gewichteten Punkten` }),
      h('div', { class: 'muted small', text: `${ms.answered} von ${ms.total} Kriterien bewertet` })
    ];
    if (m.id === 2 || m.id === 3) {
      const otherW = s.modules[m.id === 2 ? 3 : 2].weightedPoints;
      const notCounted = otherW > ms.weightedPoints
        ? 'Dieses Modul zählt nicht (das andere Modul ist höher).'
        : 'Dieses Modul zählt nicht (bei Gleichstand zählt Modul 2).';
      lines.push(h('div', { class: 'small', text: isCounted(s, m.id) ? 'Dieses Modul zählt für den Pflegegrad.' : notCounted }));
    }
    if (typeof printedRaw === 'number' && printedRaw !== ms.rawPoints) {
      lines.push(h('div', { class: 'warn-text', text: `⚠ Im Gutachten gedruckt: ${fmt(printedRaw)} Einzelpunkte` }));
    }
    body.replaceChildren(...lines);
  }

  function updateVoidBanner() {
    const sides = [['Eigene Bewertung', calc.own], ['MD-Gutachten', calc.md]]
      .map(([label, score]) => [label, voidInfo(score, m.id)])
      .filter(([, info]) => info);
    voidBanner.hidden = sides.length === 0;
    if (sides.length === 0) return;
    const items = sides.map(([label, info]) => h('li', null,
      h('strong', { text: `${label}: ` }),
      `Modul ${info.other} liefert ${fmt(info.otherW)} gewichtete Punkte, Modul ${m.id} nur ${fmt(info.ownW)}. ` +
      `Eingaben hier ändern den Pflegegrad nicht, solange Modul ${m.id} nicht ${info.strict ? 'mehr als' : 'mindestens'} ${fmt(info.otherW)} gewichtete Punkte erreicht.`));
    voidBanner.replaceChildren(
      h('div', { class: 'void-title', text: `⚠ Modul ${m.id} zählt aktuell nicht für den Pflegegrad` }),
      h('ul', null, items),
      h('div', { class: 'small', text: 'Von Modul 2 und 3 zählt nur der höhere gewichtete Wert. Begründungen können Sie trotzdem erfassen, sie verändern das Ergebnis aber (noch) nicht.' })
    );
  }

  function update() {
    fillSummary(mdBody, calc.md, state.meta.md_printed?.raw?.[m.id]);
    fillSummary(ownBody, calc.own);
    const modDevs = calc.devs.filter(d => CRITERIA_BY_ID[d.criterionId].module === m.id);
    const missingJust = modDevs.filter(d => justificationOf(d.criterionId).text.trim() === '').length;
    devLine.textContent = modDevs.length === 0
      ? 'Keine Abweichungen in diesem Modul.'
      : `${modDevs.length} Abweichungen in diesem Modul, davon ${missingJust} ohne Begründung.`;
    devLine.className = missingJust > 0 ? 'small warn-text' : 'small';
    updateVoidBanner();
    if (m.id === 5) {
      const a = calc.md.modules[5].detail;
      const b = calc.own.modules[5].detail;
      const per = (d, k) => `Ø ${fmt(d[k].perDay)}/Tag → ${d[k].points} Pkt.`;
      groupLines.a.textContent = `MD: ${per(a, 'a')} · Eigene: ${per(b, 'a')}`;
      groupLines.b.textContent = `MD: ${per(a, 'b')} · Eigene: ${per(b, 'b')}`;
      groupLines.c.textContent = `MD: Summe ${fmt(a.c.sum)} → ${a.c.points} Pkt. · Eigene: Summe ${fmt(b.c.sum)} → ${b.c.points} Pkt.`;
    }
    for (const row of rows) row.update();
  }

  return { nodes, update };
}

// ---- Start -------------------------------------------------------------

function setupTheme() {
  $('theme-btn').addEventListener('click', () => {
    const html = document.documentElement;
    const isDark = html.classList.contains('dark') ||
      (!html.classList.contains('light') && window.matchMedia('(prefers-color-scheme: dark)').matches);
    html.classList.remove('dark', 'light');
    html.classList.add(isDark ? 'light' : 'dark');
    try { localStorage.setItem('theme', isDark ? 'light' : 'dark'); } catch { /* ignorieren */ }
  });
}

async function init() {
  setupTheme();
  $('retry-btn').addEventListener('click', () => saver.retry());
  $('case-title').addEventListener('input', e => {
    const v = e.target.value.trim();
    setMeta('case_title', v === '' ? null : v);
  });
  window.addEventListener('pagehide', () => saver.flush());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saver.flush();
  });
  window.addEventListener('beforeunload', e => {
    saver.flush();
    if (saver.hasFailures()) e.preventDefault();
  });

  try {
    const data = await api('GET', '/api/case');
    Object.assign(state, data);
  } catch (err) {
    $('view').replaceChildren(h('div', { class: 'banner bad', text: `Der Fall konnte nicht geladen werden: ${err.message}` }));
    return;
  }
  $('case-title').value = state.meta.case_title || '';
  buildTabs();
  window.addEventListener('hashchange', show);
  show();
}

init();
