// Offizielle Bewertung nach Anlage 1 und 2 zu § 15 SGB XI.
// Einziger Rechenweg: Browser (Live-Ergebnis) und Server (Export) importieren diese Datei.
// Gespeichert werden Roh-Eingaben (Ausprägungen, Häufigkeiten), nie Punkte.

import {
  MODULES, MODULES_BY_ID, CRITERIA, CRITERIA_BY_ID, CONTINENCE_STATES, PFLEGEGRAD_THRESHOLDS
} from './catalog.js';

const MAX_COUNT = 1000;
const round6 = n => Math.round(n * 1e6) / 1e6;

function isCount(n) {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= MAX_COUNT;
}

function countOrZero(n) {
  if (n === undefined || n === null || n === '') return 0;
  return n;
}

// Prüft und vereinheitlicht einen Wert. { ok: true, value } oder { ok: false, error }.
export function validateValue(criterion, value) {
  if (!criterion) return { ok: false, error: 'Unbekanntes Kriterium' };
  switch (criterion.type) {
    case 'scale':
    case 'm3': {
      if (!Number.isInteger(value) || value < 0 || value >= criterion.options.length) {
        return { ok: false, error: `Erwartet wird eine Ausprägung 0 bis ${criterion.options.length - 1}` };
      }
      return { ok: true, value };
    }
    case 'incont': {
      if (!value || typeof value !== 'object') return { ok: false, error: 'Erwartet wird { rating, status }' };
      const state = CONTINENCE_STATES.find(s => s.value === value.status);
      if (!state) return { ok: false, error: 'Unbekannte Kontinenzfeststellung' };
      if (!state.counts) return { ok: true, value: { rating: 0, status: state.value } };
      if (!Number.isInteger(value.rating) || value.rating < 0 || value.rating > 3) {
        return { ok: false, error: 'Erwartet wird eine Ausprägung 0 bis 3' };
      }
      return { ok: true, value: { rating: value.rating, status: state.value } };
    }
    case 'freq': {
      if (!value || typeof value !== 'object') return { ok: false, error: 'Erwartet wird { day, week, month }' };
      const v = { day: countOrZero(value.day), week: countOrZero(value.week), month: countOrZero(value.month) };
      if (!isCount(v.day) || !isCount(v.week) || !isCount(v.month)) {
        return { ok: false, error: `Häufigkeiten müssen Zahlen von 0 bis ${MAX_COUNT} sein` };
      }
      return { ok: true, value: v };
    }
    case 'visits': {
      if (!value || typeof value !== 'object') return { ok: false, error: 'Erwartet wird { week, month }' };
      const v = {};
      if (criterion.hasDaily) {
        if (value.day !== undefined && value.day !== null && typeof value.day !== 'boolean') {
          return { ok: false, error: '„täglich“ muss true oder false sein' };
        }
        v.day = value.day === true;
      }
      v.week = countOrZero(value.week);
      v.month = countOrZero(value.month);
      if (!isCount(v.week) || !isCount(v.month)) {
        return { ok: false, error: `Häufigkeiten müssen Zahlen von 0 bis ${MAX_COUNT} sein` };
      }
      return { ok: true, value: v };
    }
    default:
      return { ok: false, error: 'Unbekannter Kriterientyp' };
  }
}

export function normalizeValue(criterion, value) {
  if (value === undefined || value === null) return null;
  const r = validateValue(criterion, value);
  return r.ok ? r.value : null;
}

export function valuesEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function bandIndex(module, sum) {
  const i = module.bands.findIndex(upper => sum <= upper);
  return i === -1 ? module.bands.length : i;
}

// ---- Einzelpunkte -----------------------------------------------------

function simplePoints(criterion, value) {
  if (criterion.type === 'incont') {
    const state = CONTINENCE_STATES.find(s => s.value === value.status);
    return state.counts ? criterion.options[value.rating].points : 0;
  }
  return criterion.options[value].points;
}

// Modul 5, Kriterien 5.1 bis 5.7 (Gruppe a) und 5.8 bis 5.11 (Gruppe b).
// Rechnung in Einheiten von 1/210 pro Tag (210 = 7 * 30), damit Grenzen exakt bleiben.
function perDayScaled(values) {
  let s = 0;
  for (const v of values) s += v.day * 210 + v.week * 30 + v.month * 7;
  return round6(s);
}

function pointsGroupA(scaled) {
  if (scaled < 210) return 0;       // seltener als einmal täglich
  if (scaled <= 630) return 1;      // mindestens einmal bis maximal dreimal täglich
  if (scaled <= 1680) return 2;     // mehr als dreimal bis maximal achtmal täglich
  return 3;                         // mehr als achtmal täglich
}

function pointsGroupB(scaled) {
  if (scaled < 30) return 0;        // seltener als einmal wöchentlich
  if (scaled < 210) return 1;       // ein- bis mehrmals wöchentlich
  if (scaled < 630) return 2;       // ein- bis unter dreimal täglich
  return 3;                         // mindestens dreimal täglich
}

// Kriterien 5.12 bis 5.15: Punkte mal 10 (ganzzahlig: 4,3 -> 43, 8,6 -> 86, 60 -> 600)
function visitsTenths(criterion, v) {
  const w = criterion.weights;
  let t = v.week * Math.round(w.week * 10) + v.month * Math.round(w.month * 10);
  if (criterion.hasDaily && v.day) t += Math.round(w.day * 10);
  return t;
}

function pointsGroupC(tenths) {
  if (tenths < 43) return 0;
  if (tenths < 86) return 1;
  if (tenths < 129) return 2;
  if (tenths < 600) return 3;
  return 6;
}

// ---- Modulwertung -----------------------------------------------------

// ratings: { '1.1': 2, '4.11': {rating, status}, '5.1': {day, week, month}, ... }
export function scoreModule(moduleId, ratings = {}) {
  const module = MODULES_BY_ID[moduleId];
  if (!module) throw new Error(`Unbekanntes Modul ${moduleId}`);

  const values = {};
  let answered = 0;
  for (const c of module.criteria) {
    const v = normalizeValue(c, ratings[c.id]);
    if (v !== null) {
      values[c.id] = v;
      answered++;
    }
  }

  let rawPoints = 0;
  let detail = null;

  if (moduleId === 5) {
    const pick = group => module.criteria.filter(c => c.group === group && values[c.id] !== undefined);
    const scaledA = perDayScaled(pick('a').map(c => values[c.id]));
    const scaledB = perDayScaled(pick('b').map(c => values[c.id]));
    const tenthsC = pick('c').reduce((sum, c) => sum + visitsTenths(c, values[c.id]), 0);
    const c516 = module.criteria.find(c => c.id === '5.16');
    const pointsA = pointsGroupA(scaledA);
    const pointsB = pointsGroupB(scaledB);
    const pointsC = pointsGroupC(round6(tenthsC));
    const points516 = values['5.16'] !== undefined ? simplePoints(c516, values['5.16']) : 0;
    rawPoints = pointsA + pointsB + pointsC + points516;
    detail = {
      a: { perDay: round6(scaledA / 210), points: pointsA },
      b: { perDay: round6(scaledB / 210), points: pointsB },
      c: { sum: round6(tenthsC / 10), points: pointsC },
      d: { points: points516 }
    };
  } else {
    for (const c of module.criteria) {
      if (values[c.id] !== undefined) rawPoints += simplePoints(c, values[c.id]);
    }
  }

  const severity = bandIndex(module, rawPoints);
  return {
    moduleId,
    rawPoints,
    severity,
    weightedPoints: module.weighted[severity],
    answered,
    total: module.criteria.length,
    complete: answered === module.criteria.length,
    detail
  };
}

export function pflegegradFor(totalWeighted) {
  let grade = 0;
  for (const t of PFLEGEGRAD_THRESHOLDS) if (totalWeighted >= t.from) grade = t.grade;
  return grade;
}

export function scoreCase(ratings = {}) {
  const modules = {};
  for (const m of MODULES) modules[m.id] = scoreModule(m.id, ratings);

  // Modul 2 oder 3: der höhere gewichtete Wert zählt (bei Gleichstand Modul 2)
  const counted23 = modules[3].weightedPoints > modules[2].weightedPoints ? 3 : 2;
  const weighted23 = modules[counted23].weightedPoints;
  const totalWeighted =
    modules[1].weightedPoints + weighted23 + modules[4].weightedPoints +
    modules[5].weightedPoints + modules[6].weightedPoints;

  const pflegegrad = pflegegradFor(totalWeighted);
  const next = PFLEGEGRAD_THRESHOLDS.find(t => t.grade === pflegegrad + 1) || null;
  const answered = MODULES.reduce((n, m) => n + modules[m.id].answered, 0);

  return {
    modules,
    counted23,
    totalWeighted,
    pflegegrad,
    nextPflegegrad: next ? next.grade : null,
    pointsToNext: next ? next.from - totalWeighted : null,
    answered,
    total: CRITERIA.length,
    complete: answered === CRITERIA.length
  };
}

// ---- Abweichungen -----------------------------------------------------

// Nur Kriterien, die beidseitig bewertet sind und sich unterscheiden.
export function deviations(mdRatings = {}, ownRatings = {}) {
  const out = [];
  for (const c of CRITERIA) {
    const md = normalizeValue(c, mdRatings[c.id]);
    const own = normalizeValue(c, ownRatings[c.id]);
    if (md !== null && own !== null && !valuesEqual(md, own)) {
      out.push({ criterionId: c.id, md, own });
    }
  }
  return out;
}

// ---- Gegenprobe zu den im MD-Gutachten gedruckten Punkten -------------

function isNumber(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

// printed: { raw: { 1: n, ..., 6: n }, total: n, pflegegrad: n }  (alle Felder optional)
export function crossCheck(mdScore, printed) {
  const issues = [];
  if (!printed) return issues;
  for (const m of MODULES) {
    const p = printed.raw?.[m.id];
    if (isNumber(p) && p !== mdScore.modules[m.id].rawPoints) {
      issues.push({ kind: 'module', moduleId: m.id, printed: p, computed: mdScore.modules[m.id].rawPoints });
    }
  }
  if (isNumber(printed.total) && printed.total !== mdScore.totalWeighted) {
    issues.push({ kind: 'total', printed: printed.total, computed: mdScore.totalWeighted });
  }
  if (isNumber(printed.pflegegrad) && printed.pflegegrad !== mdScore.pflegegrad) {
    issues.push({ kind: 'pflegegrad', printed: printed.pflegegrad, computed: mdScore.pflegegrad });
  }
  return issues;
}

// ---- Darstellung eines Werts (UI und Export) --------------------------

const fmt = n => String(n).replace('.', ',');
const pointsText = n => `${fmt(n)} ${n === 1 ? 'Punkt' : 'Punkte'}`;

export function describeValue(criterion, value) {
  const v = normalizeValue(criterion, value);
  if (v === null) return 'nicht bewertet';
  switch (criterion.type) {
    case 'scale':
    case 'm3':
      return `${criterion.options[v].label} (${pointsText(criterion.options[v].points)})`;
    case 'incont': {
      const state = CONTINENCE_STATES.find(s => s.value === v.status);
      if (!state.counts) return `${state.label} (zählt nicht, 0 Punkte)`;
      return `${state.label}, ${criterion.options[v.rating].label} (${pointsText(criterion.options[v.rating].points)})`;
    }
    case 'freq': {
      const parts = [];
      if (v.day) parts.push(`${fmt(v.day)} pro Tag`);
      if (v.week) parts.push(`${fmt(v.week)} pro Woche`);
      if (v.month) parts.push(`${fmt(v.month)} pro Monat`);
      return parts.length ? parts.join(', ') : 'entfällt oder selbständig';
    }
    case 'visits': {
      const parts = [];
      if (v.day) parts.push('täglich');
      if (v.week) parts.push(`${fmt(v.week)} pro Woche`);
      if (v.month) parts.push(`${fmt(v.month)} pro Monat`);
      return parts.length ? parts.join(', ') : 'entfällt oder selbständig';
    }
    default:
      return '';
  }
}

export { CRITERIA_BY_ID };
