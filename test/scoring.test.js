import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODULES, MODULES_BY_ID, CRITERIA, CRITERIA_BY_ID } from '../shared/catalog.js';
import {
  scoreModule, scoreCase, pflegegradFor, deviations, crossCheck, validateValue, describeValue
} from '../shared/scoring.js';

// Baut Bewertungen für ein Modul (ohne 4.11, 4.12 und Modul 5), die genau `target` Einzelpunkte ergeben.
function ratingsForSum(moduleId, target) {
  const out = {};
  let rest = target;
  const maxPoints = c => Math.max(...c.options.map(o => o.points));
  const criteria = MODULES_BY_ID[moduleId].criteria
    .filter(c => c.type === 'scale' || c.type === 'm3')
    .sort((a, b) => maxPoints(b) - maxPoints(a));
  for (const c of criteria) {
    const best = c.options.filter(o => o.points <= rest).sort((a, b) => b.points - a.points)[0];
    out[c.id] = best.value;
    rest -= best.points;
  }
  assert.equal(rest, 0, `Summe ${target} in Modul ${moduleId} nicht darstellbar`);
  return out;
}

function raw(moduleId, ratings) {
  return scoreModule(moduleId, ratings).rawPoints;
}

function weighted(moduleId, target) {
  const r = scoreModule(moduleId, ratingsForSum(moduleId, target));
  assert.equal(r.rawPoints, target);
  return r.weightedPoints;
}

test('Katalog: 64 Kriterien in sechs Modulen', () => {
  assert.equal(CRITERIA.length, 64);
  assert.deepEqual(MODULES.map(m => m.criteria.length), [5, 11, 13, 13, 16, 6]);
  assert.equal(new Set(CRITERIA.map(c => c.id)).size, 64);
});

test('Höchstpunktzahlen laut Anlage 2: 15 / 33 / 65 / 54 / 15 / 18', () => {
  const max = {};
  for (const c of CRITERIA) {
    if (c.type === 'scale' || c.type === 'm3') {
      max[c.id] = c.options.reduce((a, o) => (o.points > c.options[a].points ? o.value : a), 0);
    }
  }
  max['4.11'] = { rating: 3, status: 'vollstaendig_inkontinent' };
  max['4.12'] = { rating: 3, status: 'vollstaendig_inkontinent' };
  for (let i = 1; i <= 11; i++) max[`5.${i}`] = { day: 100, week: 0, month: 0 };
  max['5.12'] = { day: true, week: 0, month: 0 };
  max['5.13'] = { week: 0, month: 0 };
  max['5.14'] = { week: 0, month: 0 };
  max['5.15'] = { week: 0, month: 0 };
  // Modul 5: 3 (5.1-5.7) + 3 (5.8-5.11) + 6 (5.12 täglich) + 3 (5.16)
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(m => raw(m, max)), [15, 33, 65, 54, 15, 18]);
});

const BOUNDARIES = [
  { module: 1, cases: [[0, 0], [1, 0], [2, 2.5], [3, 2.5], [4, 5], [5, 5], [6, 7.5], [9, 7.5], [10, 10], [15, 10]] },
  { module: 2, cases: [[0, 0], [1, 0], [2, 3.75], [5, 3.75], [6, 7.5], [10, 7.5], [11, 11.25], [16, 11.25], [17, 15], [33, 15]] },
  { module: 3, cases: [[0, 0], [1, 3.75], [2, 3.75], [3, 7.5], [4, 7.5], [5, 11.25], [6, 11.25], [7, 15], [65, 15]] },
  { module: 4, cases: [[0, 0], [2, 0], [3, 10], [7, 10], [8, 20], [18, 20], [19, 30], [36, 30], [37, 40]] },
  { module: 6, cases: [[0, 0], [1, 3.75], [3, 3.75], [4, 7.5], [6, 7.5], [7, 11.25], [11, 11.25], [12, 15], [18, 15]] }
];

for (const { module, cases } of BOUNDARIES) {
  test(`Modul ${module}: Bandgrenzen nach Anlage 2`, () => {
    for (const [sum, expected] of cases) {
      assert.equal(weighted(module, sum), expected, `Modul ${module}, Summe ${sum}`);
    }
  });
}

test('Modul 3: Einzelpunkte 0/1/3/5', () => {
  const c = CRITERIA_BY_ID['3.1'];
  assert.deepEqual(c.options.map(o => o.points), [0, 1, 3, 5]);
  assert.equal(raw(3, { '3.1': 3, '3.2': 2, '3.3': 1 }), 9);
});

test('Modul 4: Gewichtung 4.8 (0/3/6/9), 4.9 und 4.10 (0/2/4/6)', () => {
  assert.deepEqual([0, 1, 2, 3].map(v => raw(4, { '4.8': v })), [0, 3, 6, 9]);
  assert.deepEqual([0, 1, 2, 3].map(v => raw(4, { '4.9': v })), [0, 2, 4, 6]);
  assert.deepEqual([0, 1, 2, 3].map(v => raw(4, { '4.10': v })), [0, 2, 4, 6]);
});

test('Modul 4: 4.13 teilweise = 6 Punkte, vollständig = 3 Punkte', () => {
  assert.deepEqual([0, 1, 2].map(v => raw(4, { '4.13': v })), [0, 6, 3]);
});

test('Modul 4: 4.11/4.12 zählen nur bei überwiegend/vollständig inkontinent oder künstlicher Ableitung', () => {
  const pts = (id, status, rating) => raw(4, { [id]: { status, rating } });
  for (const id of ['4.11', '4.12']) {
    assert.equal(pts(id, 'kontinent', 3), 0);
    assert.equal(pts(id, 'ueberwiegend_kontinent', 3), 0);
    assert.equal(pts(id, 'ueberwiegend_inkontinent', 2), 2);
    assert.equal(pts(id, 'vollstaendig_inkontinent', 3), 3);
    assert.equal(pts(id, 'kuenstlich', 1), 1);
  }
});

// ---- Modul 5 ----------------------------------------------------------

const m5 = ratings => scoreModule(5, ratings).detail;
const freq = (day = 0, week = 0, month = 0) => ({ day, week, month });

test('Modul 5, Gruppe a (5.1-5.7): Maßnahmen pro Tag 0/1/2/3 Punkte', () => {
  const a = n => m5({ '5.1': freq(n) }).a.points;
  assert.deepEqual([0, 1, 3, 4, 8, 9].map(a), [0, 1, 1, 2, 2, 3]);
});

test('Modul 5, Gruppe a: Umrechnung Woche (/7) und Monat (/30)', () => {
  assert.equal(m5({ '5.1': freq(0, 6) }).a.points, 0);
  assert.equal(m5({ '5.1': freq(0, 7) }).a.points, 1);
  assert.equal(m5({ '5.1': freq(0, 0, 29) }).a.points, 0);
  assert.equal(m5({ '5.1': freq(0, 0, 30) }).a.points, 1);
  assert.equal(m5({ '5.1': freq(0, 56) }).a.points, 2);
  assert.equal(m5({ '5.1': freq(0, 63) }).a.points, 3);
});

test('Modul 5, Gruppe a: Beispiel aus Anlage 1 (3x Medikation + 1x Blutzucker = 4 pro Tag)', () => {
  const d = m5({ '5.1': freq(3), '5.6': freq(1) });
  assert.equal(d.a.perDay, 4);
  assert.equal(d.a.points, 2);
});

test('Modul 5, Gruppe b (5.8-5.11): seltener als wöchentlich / wöchentlich / 1-<3 täglich / ab 3 täglich', () => {
  const b = (d, w, m) => m5({ '5.8': freq(d, w, m) }).b.points;
  assert.equal(b(0, 0, 4), 0);
  assert.equal(b(0, 0, 5), 1);
  assert.equal(b(0, 1, 0), 1);
  assert.equal(b(0, 6, 0), 1);
  assert.equal(b(0, 7, 0), 2);
  assert.equal(b(1, 0, 0), 2);
  assert.equal(b(2, 0, 0), 2);
  assert.equal(b(0, 20, 0), 2);
  assert.equal(b(0, 21, 0), 3);
  assert.equal(b(3, 0, 0), 3);
});

test('Modul 5, Gruppen a und b werden getrennt gesummiert', () => {
  const d = m5({ '5.1': freq(1), '5.8': freq(1) });
  assert.equal(d.a.points, 1);
  assert.equal(d.b.points, 2);
});

test('Modul 5, 5.12-5.15: Summe 0 / 4,3 / 8,6 / 12,9 / 60', () => {
  const c = ratings => m5(ratings).c;
  assert.equal(c({ '5.13': { week: 0, month: 4 } }).points, 0);
  assert.equal(c({ '5.13': { week: 0, month: 5 } }).points, 1);
  assert.equal(c({ '5.13': { week: 1, month: 0 } }).points, 1);
  assert.equal(c({ '5.13': { week: 2, month: 0 } }).sum, 8.6);
  assert.equal(c({ '5.13': { week: 2, month: 0 } }).points, 2);
  assert.equal(c({ '5.13': { week: 3, month: 0 } }).sum, 12.9);
  assert.equal(c({ '5.13': { week: 3, month: 0 } }).points, 3);
  assert.equal(c({ '5.13': { week: 13, month: 0 } }).points, 3);
  assert.equal(c({ '5.13': { week: 14, month: 0 } }).points, 6);
});

test('Modul 5, 5.12 täglich = 60 Punkte = 6 Einzelpunkte', () => {
  assert.equal(m5({ '5.12': { day: true, week: 0, month: 0 } }).c.points, 6);
  assert.equal(m5({ '5.12': { day: false, week: 1, month: 0 } }).c.sum, 8.6);
});

test('Modul 5, 5.15 zählt doppelt; Kriterien 5.12-5.15 werden addiert', () => {
  assert.equal(m5({ '5.15': { week: 1, month: 0 } }).c.sum, 8.6);
  assert.equal(m5({ '5.15': { week: 7, month: 0 } }).c.points, 6);
  const d = m5({ '5.13': { week: 1, month: 0 }, '5.14': { week: 1, month: 0 }, '5.15': { week: 1, month: 0 } });
  assert.equal(d.c.sum, 17.2);
  assert.equal(d.c.points, 3);
});

test('Modul 5, 5.16 mit 0-3 Einzelpunkten', () => {
  assert.deepEqual([0, 1, 2, 3].map(v => m5({ '5.16': v }).d.points), [0, 1, 2, 3]);
});

test('Modul 5: Bandgrenzen 0 / 1 / 2-3 / 4-5 / 6-15', () => {
  const bySum = {
    0: {},
    1: { '5.16': 1 },
    2: { '5.16': 2 },
    3: { '5.16': 3 },
    4: { '5.16': 3, '5.1': freq(1) },
    5: { '5.16': 3, '5.1': freq(4) },
    6: { '5.16': 3, '5.1': freq(9) }
  };
  const expected = { 0: 0, 1: 5, 2: 10, 3: 10, 4: 15, 5: 15, 6: 20 };
  for (const [sum, ratings] of Object.entries(bySum)) {
    const r = scoreModule(5, ratings);
    assert.equal(r.rawPoints, Number(sum));
    assert.equal(r.weightedPoints, expected[sum], `Summe ${sum}`);
  }
  // Maximum 15: 3 + 3 + 6 + 3
  const max = scoreModule(5, {
    '5.1': freq(9), '5.8': freq(3), '5.12': { day: true, week: 0, month: 0 }, '5.16': 3
  });
  assert.equal(max.rawPoints, 15);
  assert.equal(max.weightedPoints, 20);
});

test('Modul 5: unbewertet ist 0 Punkte und nicht vollständig', () => {
  const r = scoreModule(5, {});
  assert.equal(r.rawPoints, 0);
  assert.equal(r.answered, 0);
  assert.equal(r.complete, false);
});

// ---- Gesamtergebnis ---------------------------------------------------

test('Pflegegrad-Schwellen 12,5 / 27 / 47,5 / 70 / 90', () => {
  const cases = [
    [0, 0], [12.4, 0], [12.5, 1], [26.99, 1], [27, 2], [47.49, 2],
    [47.5, 3], [69.99, 3], [70, 4], [89.99, 4], [90, 5], [100, 5]
  ];
  for (const [points, grade] of cases) assert.equal(pflegegradFor(points), grade, `${points} Punkte`);
});

test('Modul 2 oder 3: der höhere gewichtete Wert zählt', () => {
  const m2high = scoreCase({ ...ratingsForSum(2, 20), ...ratingsForSum(3, 3) });
  assert.equal(m2high.counted23, 2);
  assert.equal(m2high.totalWeighted, 15);
  const m3high = scoreCase({ ...ratingsForSum(2, 3), ...ratingsForSum(3, 7) });
  assert.equal(m3high.counted23, 3);
  assert.equal(m3high.totalWeighted, 15);
  const tie = scoreCase({ ...ratingsForSum(2, 2), ...ratingsForSum(3, 1) });
  assert.equal(tie.modules[2].weightedPoints, 3.75);
  assert.equal(tie.modules[3].weightedPoints, 3.75);
  assert.equal(tie.counted23, 2);
  assert.equal(tie.totalWeighted, 3.75);
});

test('Durchgerechneter Fall: 7,5 + 11,25 + 30 + 10 + 11,25 = 70 Punkte = Pflegegrad 4', () => {
  const ratings = {
    ...ratingsForSum(1, 6), ...ratingsForSum(2, 11), ...ratingsForSum(4, 19),
    '5.16': 2, ...ratingsForSum(6, 7)
  };
  const r = scoreCase(ratings);
  assert.equal(r.modules[1].weightedPoints, 7.5);
  assert.equal(r.modules[2].weightedPoints, 11.25);
  assert.equal(r.modules[4].weightedPoints, 30);
  assert.equal(r.modules[5].weightedPoints, 10);
  assert.equal(r.modules[6].weightedPoints, 11.25);
  assert.equal(r.totalWeighted, 70);
  assert.equal(r.pflegegrad, 4);
  assert.equal(r.nextPflegegrad, 5);
  assert.equal(r.pointsToNext, 20);
});

test('Ein Punkt weniger im Modul 4 senkt den Fall unter die Schwelle', () => {
  const ratings = {
    ...ratingsForSum(1, 6), ...ratingsForSum(2, 11), ...ratingsForSum(4, 18),
    '5.16': 2, ...ratingsForSum(6, 7)
  };
  const r = scoreCase(ratings);
  assert.equal(r.totalWeighted, 60);
  assert.equal(r.pflegegrad, 3);
  assert.equal(r.pointsToNext, 10);
});

test('Leerer Fall: Pflegegrad 0, nichts bewertet, kein Absturz', () => {
  const r = scoreCase({});
  assert.equal(r.totalWeighted, 0);
  assert.equal(r.pflegegrad, 0);
  assert.equal(r.nextPflegegrad, 1);
  assert.equal(r.pointsToNext, 12.5);
  assert.equal(r.answered, 0);
  assert.equal(r.complete, false);
});

test('Ungültige Werte werden wie unbewertet behandelt', () => {
  const r = scoreModule(1, { '1.1': 9, '1.2': 'x', '1.3': null, '1.4': 3 });
  assert.equal(r.answered, 1);
  assert.equal(r.rawPoints, 3);
});

// ---- Abweichungen, Validierung, Gegenprobe ----------------------------

test('deviations: nur beidseitig bewertete, unterschiedliche Kriterien', () => {
  const md = { '1.1': 0, '1.2': 1, '1.3': 2, '4.8': 1, '5.1': freq(2), '4.11': { status: 'kontinent', rating: 0 } };
  const own = { '1.1': 0, '1.2': 3, '4.8': 2, '5.1': freq(3), '4.11': { status: 'kontinent', rating: 2 } };
  const d = deviations(md, own);
  assert.deepEqual(d.map(x => x.criterionId), ['1.2', '4.8', '5.1']);
  assert.equal(d[0].md, 1);
  assert.equal(d[0].own, 3);
});

test('deviations: gleiche Punkte, aber andere Häufigkeit zählt als Abweichung', () => {
  const d = deviations({ '5.1': freq(2) }, { '5.1': freq(3) });
  assert.equal(d.length, 1);
  assert.equal(scoreModule(5, { '5.1': freq(2) }).rawPoints, scoreModule(5, { '5.1': freq(3) }).rawPoints);
});

test('validateValue: Ablehnung ungültiger Eingaben', () => {
  const scale = CRITERIA_BY_ID['1.1'];
  const sonde = CRITERIA_BY_ID['4.13'];
  assert.equal(validateValue(scale, 3).ok, true);
  for (const bad of [4, -1, 1.5, '1', null, undefined, {}]) assert.equal(validateValue(scale, bad).ok, false);
  assert.equal(validateValue(sonde, 2).ok, true);
  assert.equal(validateValue(sonde, 3).ok, false);
  const inc = CRITERIA_BY_ID['4.11'];
  assert.equal(validateValue(inc, { status: 'unbekannt', rating: 1 }).ok, false);
  assert.equal(validateValue(inc, { status: 'kuenstlich', rating: 7 }).ok, false);
  assert.deepEqual(validateValue(inc, { status: 'kontinent', rating: 3 }).value, { rating: 0, status: 'kontinent' });
  const f = CRITERIA_BY_ID['5.1'];
  assert.equal(validateValue(f, { day: -1 }).ok, false);
  assert.equal(validateValue(f, { day: NaN }).ok, false);
  assert.equal(validateValue(f, { day: '2' }).ok, false);
  assert.deepEqual(validateValue(f, { day: 2 }).value, { day: 2, week: 0, month: 0 });
  const v12 = CRITERIA_BY_ID['5.12'];
  assert.equal(validateValue(v12, { day: 'ja' }).ok, false);
  assert.deepEqual(validateValue(CRITERIA_BY_ID['5.13'], { week: 1 }).value, { week: 1, month: 0 });
});

test('crossCheck: meldet Abweichungen zu den gedruckten Punkten', () => {
  const md = scoreCase({ ...ratingsForSum(1, 6), ...ratingsForSum(4, 19) });
  assert.deepEqual(crossCheck(md, null), []);
  assert.deepEqual(crossCheck(md, { raw: { 1: 6, 4: 19 }, total: 37.5, pflegegrad: 2 }), []);
  const issues = crossCheck(md, { raw: { 1: 7, 4: 19 }, total: 40, pflegegrad: 3 });
  assert.deepEqual(issues.map(i => i.kind), ['module', 'total', 'pflegegrad']);
  assert.equal(issues[0].moduleId, 1);
  assert.equal(issues[0].computed, 6);
});

test('describeValue: deutsche Klartexte', () => {
  assert.equal(describeValue(CRITERIA_BY_ID['1.1'], 2), 'überwiegend unselbständig (2 Punkte)');
  assert.equal(describeValue(CRITERIA_BY_ID['4.8'], 3), 'unselbständig (9 Punkte)');
  assert.equal(describeValue(CRITERIA_BY_ID['1.1'], undefined), 'nicht bewertet');
  assert.equal(describeValue(CRITERIA_BY_ID['5.1'], { day: 3, week: 0, month: 2 }), '3 pro Tag, 2 pro Monat');
  assert.equal(describeValue(CRITERIA_BY_ID['5.1'], { day: 0, week: 0, month: 0 }), 'entfällt oder selbständig');
  assert.equal(describeValue(CRITERIA_BY_ID['5.12'], { day: true, week: 0, month: 0 }), 'täglich');
  assert.equal(
    describeValue(CRITERIA_BY_ID['4.11'], { status: 'vollstaendig_inkontinent', rating: 3 }),
    'vollständig inkontinent, unselbständig (3 Punkte)'
  );
});
