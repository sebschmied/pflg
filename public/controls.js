import { CONTINENCE_STATES } from '/shared/catalog.js';
import { h } from './dom.js';

// Jedes Control liefert { el, set(value) } und ruft onChange(value | null) bei Eingaben auf.

function scaleControl(criterion, onChange, label) {
  const hint = h('p', { class: 'hint' });
  const select = h('select', { 'aria-label': label },
    h('option', { value: '', text: '— nicht bewertet —' }),
    criterion.options.map(o => h('option', { value: String(o.value), text: `${o.label} (${o.points} Pkt.)` }))
  );
  const set = v => {
    select.value = v === null || v === undefined ? '' : String(v);
    hint.textContent = select.value === '' ? '' : criterion.options[Number(select.value)].desc;
  };
  select.addEventListener('change', () => {
    const v = select.value === '' ? null : Number(select.value);
    set(v);
    onChange(v);
  });
  return { el: h('div', { class: 'ctl' }, select, hint), set };
}

function incontControl(criterion, onChange, label) {
  const status = h('select', { 'aria-label': `${label}: Kontinenzfeststellung` },
    h('option', { value: '', text: '— Kontinenz nicht festgestellt —' }),
    CONTINENCE_STATES.map(s => h('option', { value: s.value, text: s.label }))
  );
  const rating = h('select', { 'aria-label': `${label}: Selbständigkeit` },
    h('option', { value: '', text: '— Ausprägung wählen —' }),
    criterion.options.map(o => h('option', { value: String(o.value), text: `${o.label} (${o.points} Pkt.)` }))
  );
  const hint = h('p', { class: 'hint' });
  const counts = () => CONTINENCE_STATES.find(s => s.value === status.value)?.counts === true;

  const sync = () => {
    rating.hidden = !counts();
    if (status.value === '') hint.textContent = '';
    else if (!counts()) hint.textContent = 'Zählt nicht in die Punktesumme (0 Punkte).';
    else hint.textContent = rating.value === '' ? '' : criterion.options[Number(rating.value)].desc;
  };
  const emit = () => {
    sync();
    if (status.value === '') return onChange(null);
    if (!counts()) return onChange({ status: status.value, rating: 0 });
    if (rating.value === '') return onChange(null);
    onChange({ status: status.value, rating: Number(rating.value) });
  };
  status.addEventListener('change', emit);
  rating.addEventListener('change', emit);

  const set = v => {
    status.value = v ? v.status : '';
    rating.value = v && counts() ? String(v.rating) : '';
    sync();
  };
  return { el: h('div', { class: 'ctl' }, status, rating, hint), set };
}

function numberInput(label, onInput) {
  const input = h('input', { type: 'number', min: '0', max: '1000', step: 'any', inputmode: 'decimal', 'aria-label': label });
  input.addEventListener('input', onInput);
  return input;
}

const readCount = input => {
  if (input.value === '') return 0;
  const n = Number(input.value);
  return Number.isFinite(n) ? Math.min(1000, Math.max(0, n)) : 0;
};

function countsControl(criterion, onChange, label) {
  const hasDay = criterion.type === 'freq';
  const hasDailyFlag = criterion.type === 'visits' && criterion.hasDaily;
  const day = hasDay ? numberInput(`${label}: pro Tag`, () => emit()) : null;
  const daily = hasDailyFlag ? h('input', { type: 'checkbox', 'aria-label': `${label}: täglich` }) : null;
  const week = numberInput(`${label}: pro Woche`, () => emit());
  const month = numberInput(`${label}: pro Monat`, () => emit());
  const inputs = [day, week, month].filter(Boolean);

  const emit = () => {
    const empty = inputs.every(i => i.value === '') && !(daily && daily.checked);
    if (empty) return onChange(null);
    const v = { week: readCount(week), month: readCount(month) };
    if (day) v.day = readCount(day);
    if (daily) v.day = daily.checked;
    onChange(v);
  };
  if (daily) daily.addEventListener('change', emit);

  const none = h('button', {
    type: 'button', class: 'btn small',
    onclick: () => { set(criterion.type === 'freq' ? { day: 0, week: 0, month: 0 } : { day: false, week: 0, month: 0 }); emit(); }
  }, 'entfällt / selbständig');

  const set = v => {
    const show = n => (v === null || v === undefined ? '' : String(n ?? 0));
    if (day) day.value = show(v?.day);
    week.value = show(v?.week);
    month.value = show(v?.month);
    if (daily) daily.checked = Boolean(v?.day);
  };

  const field = (text, input) => h('label', { class: 'count-field' }, h('span', { text }), input);
  const row = h('div', { class: 'counts' },
    day ? field('pro Tag', day) : null,
    daily ? h('label', { class: 'count-field check' }, daily, h('span', { text: 'täglich (60 Punkte)' })) : null,
    field('pro Woche', week),
    field('pro Monat', month),
    none
  );
  return { el: h('div', { class: 'ctl' }, row), set };
}

export function createControl(criterion, onChange, label) {
  switch (criterion.type) {
    case 'incont': return incontControl(criterion, onChange, label);
    case 'freq':
    case 'visits': return countsControl(criterion, onChange, label);
    default: return scaleControl(criterion, onChange, label);
  }
}
