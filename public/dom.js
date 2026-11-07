// Kleiner DOM-Helfer: h('div', { class: 'x', onclick }, kinder...)
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'value') el.value = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const kid of kids.flat()) {
    if (kid !== null && kid !== undefined && kid !== false) el.append(kid);
  }
  return el;
}

const nf = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });
export const fmt = n => nf.format(n);

export const gradeText = g => (g === 0 ? 'kein Pflegegrad' : `Pflegegrad ${g}`);
