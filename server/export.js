import { MODULES, CRITERIA_BY_ID } from '../shared/catalog.js';
import { scoreCase, deviations, crossCheck, describeValue } from '../shared/scoring.js';

const fmt = n => String(n).replace('.', ',');
const gradeText = g => (g === 0 ? 'kein Pflegegrad' : `Pflegegrad ${g}`);

function dateText(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

function counted(score, moduleId) {
  return (moduleId !== 2 && moduleId !== 3) || score.counted23 === moduleId;
}

function weightedCell(score, moduleId) {
  const w = fmt(score.modules[moduleId].weightedPoints);
  return counted(score, moduleId) ? w : `~~${w}~~ (zählt nicht)`;
}

const idLabel = id => `${id} ${CRITERIA_BY_ID[id].name}`;

// Erzeugt den Markdown-Export aus dem gespeicherten Fall. Arbeitsnotizen werden bewusst nicht ausgegeben.
export function buildExport(caseData, { now = new Date() } = {}) {
  const md = scoreCase(caseData.ratings.md);
  const own = scoreCase(caseData.ratings.own);
  const devs = deviations(caseData.ratings.md, caseData.ratings.own);
  const justification = id => caseData.justifications[id] || { text: '', status: 'open' };

  const missing = devs.filter(d => justification(d.criterionId).text.trim() === '');
  const drafts = devs.filter(d => {
    const j = justification(d.criterionId);
    return j.text.trim() !== '' && j.status !== 'done';
  });
  const issues = crossCheck(md, caseData.meta.md_printed);

  const out = [];
  const title = caseData.meta.case_title ? `: ${caseData.meta.case_title}` : '';
  out.push(`# Begründungen zum Widerspruch${title}`, '');
  out.push(`Stand: ${dateText(now)}. Zusammenstellung der abweichenden Bewertungen gegenüber dem Gutachten des Medizinischen Dienstes (MD), nach Anlage 1 und 2 zu § 15 SGB XI.`, '');

  if (missing.length || drafts.length || issues.length || !own.complete || !md.complete) {
    out.push('## Hinweise zur Vollständigkeit', '');
    if (missing.length) {
      const count = missing.length === 1 ? '1 abweichendes Kriterium' : `${missing.length} abweichende Kriterien`;
      out.push(`**Es fehlen Begründungen für ${count}:**`, '');
      for (const d of missing) out.push(`- ${idLabel(d.criterionId)}`);
      out.push('');
    }
    if (drafts.length) {
      out.push(`**Begründung vorhanden, aber nicht als fertig markiert (${drafts.length}):**`, '');
      for (const d of drafts) out.push(`- ${idLabel(d.criterionId)}`);
      out.push('');
    }
    if (!md.complete || !own.complete) {
      const parts = [];
      if (!md.complete) parts.push(`MD-Bewertung ${md.answered} von ${md.total} Kriterien erfasst`);
      if (!own.complete) parts.push(`eigene Bewertung ${own.answered} von ${own.total} Kriterien erfasst`);
      out.push(`**Unvollständige Erfassung:** ${parts.join(', ')}. Nicht erfasste Kriterien zählen mit 0 Punkten.`, '');
    }
    if (issues.length) {
      out.push('**Die im Gutachten gedruckten Punkte weichen von der Berechnung aus den erfassten MD-Werten ab:**', '');
      for (const i of issues) {
        const what = i.kind === 'module' ? `Modul ${i.moduleId} (Einzelpunkte)` : i.kind === 'total' ? 'Gewichtete Gesamtpunkte' : 'Pflegegrad';
        out.push(`- ${what}: im Gutachten ${fmt(i.printed)}, berechnet ${fmt(i.computed)}`);
      }
      out.push('');
    }
  }

  out.push('## Zusammenfassung', '');
  out.push('| | MD-Gutachten | Eigene Bewertung |');
  out.push('|---|---|---|');
  out.push(`| Gewichtete Gesamtpunkte | ${fmt(md.totalWeighted)} | ${fmt(own.totalWeighted)} |`);
  out.push(`| Pflegegrad | ${gradeText(md.pflegegrad)} | ${gradeText(own.pflegegrad)} |`);
  out.push('');
  out.push('| Modul | Gewichtung | MD: Einzelpunkte | MD: gewichtet | Eigene: Einzelpunkte | Eigene: gewichtet | Abweichungen |');
  out.push('|---|---|---|---|---|---|---|');
  for (const m of MODULES) {
    const n = devs.filter(d => CRITERIA_BY_ID[d.criterionId].module === m.id).length;
    out.push(`| ${m.id} ${m.name} | ${m.weight} % | ${md.modules[m.id].rawPoints} | ${weightedCell(md, m.id)} | ${own.modules[m.id].rawPoints} | ${weightedCell(own, m.id)} | ${n} |`);
  }
  out.push('');
  out.push('Von Modul 2 und Modul 3 zählt nur der höhere gewichtete Wert (durchgestrichen = zählt nicht).', '');

  for (const m of MODULES) {
    out.push(`## Modul ${m.id}: ${m.name}`, '');
    const moduleDevs = devs.filter(d => CRITERIA_BY_ID[d.criterionId].module === m.id);
    if (moduleDevs.length === 0) {
      out.push('Keine abweichenden Bewertungen in diesem Modul.', '');
      continue;
    }
    for (const d of moduleDevs) {
      const c = CRITERIA_BY_ID[d.criterionId];
      const text = justification(d.criterionId).text.trim();
      out.push(`### ${idLabel(d.criterionId)}`, '');
      out.push(`- **MD-Bewertung:** ${describeValue(c, d.md)}`);
      out.push(`- **Eigene Bewertung:** ${describeValue(c, d.own)}`, '');
      out.push('**Begründung:**', '');
      out.push(text === '' ? '_Begründung fehlt noch._' : text, '');
    }
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}
