// Kriterienkatalog nach Anlage 1 zu § 15 SGB XI (Einzelpunkte der Module 1 bis 6)
// und Bewertungssystematik nach Anlage 2 (Bänder und Gewichtung).
// Reine Daten, keine Abhängigkeiten: wird vom Browser und vom Server gleichermaßen importiert.

const SCALE_SELBSTAENDIG = [
  { label: 'selbständig',
    desc: 'Die Person kann die Aktivität ohne Hilfe durch andere durchführen. Erschwernis durch Hilfsmittel zählt nicht als Hilfebedarf, solange die Person selbständig damit umgehen kann.' },
  { label: 'überwiegend selbständig',
    desc: 'Die Person kann den größten Teil der Aktivität selbständig durchführen. Es ist Aufforderung, geringe Unterstützung oder Anwesenheit aus Sicherheitsgründen erforderlich.' },
  { label: 'überwiegend unselbständig',
    desc: 'Die Person kann nur einen geringen Teil der Aktivität selbständig durchführen. Die Pflegeperson muss den größten Teil übernehmen.' },
  { label: 'unselbständig',
    desc: 'Die Person kann die Aktivität nicht oder nur in sehr geringem Maße selbständig durchführen. Sie muss vollständig oder nahezu vollständig übernommen werden.' }
];

const SCALE_FAEHIGKEIT = [
  { label: 'Fähigkeit vorhanden/unbeeinträchtigt',
    desc: 'Die Fähigkeit ist (nahezu) vollständig vorhanden.' },
  { label: 'Fähigkeit größtenteils vorhanden',
    desc: 'Die Fähigkeit ist überwiegend vorhanden, es bestehen aber Beeinträchtigungen.' },
  { label: 'Fähigkeit in geringem Maße vorhanden',
    desc: 'Die Fähigkeit ist nur noch in geringem Maße vorhanden.' },
  { label: 'Fähigkeit nicht vorhanden',
    desc: 'Die Fähigkeit ist nicht oder nicht mehr erkennbar vorhanden.' }
];

const SCALE_HAEUFIGKEIT = [
  { label: 'nie oder sehr selten',
    desc: 'Das Verhalten tritt nie oder sehr selten auf.' },
  { label: 'selten',
    desc: 'Ein- bis dreimal innerhalb von zwei Wochen.' },
  { label: 'häufig',
    desc: 'Zweimal bis mehrmals wöchentlich, aber nicht täglich.' },
  { label: 'täglich',
    desc: 'Das Verhalten tritt täglich auf.' }
];

const SCALE_SONDE = [
  { label: 'entfällt',
    desc: 'Eine regelmäßige und tägliche parenterale Ernährung oder Sondenernährung ist auf Dauer (voraussichtlich mindestens sechs Monate) nicht erforderlich oder wird selbständig ohne Hilfe durchgeführt.' },
  { label: 'teilweise',
    desc: 'Parenterale Ernährung oder Sondenernährung erfolgt mit Hilfe täglich und zusätzlich zur oralen Aufnahme von Nahrung oder Flüssigkeit, zur Vermeidung von Mangelernährung.' },
  { label: 'vollständig',
    desc: 'Die Aufnahme von Nahrung oder Flüssigkeit erfolgt ausschließlich oder nahezu ausschließlich parenteral oder über eine Sonde.' }
];

const SCALE_5_16 = [
  { label: 'entfällt oder selbständig', desc: SCALE_SELBSTAENDIG[0].desc },
  SCALE_SELBSTAENDIG[1],
  SCALE_SELBSTAENDIG[2],
  SCALE_SELBSTAENDIG[3]
];

// Kontinenzfeststellung zu 4.11 / 4.12: Die Einzelpunkte zählen nur bei den letzten drei Feststellungen.
export const CONTINENCE_STATES = [
  { value: 'kontinent', label: 'kontinent', counts: false },
  { value: 'ueberwiegend_kontinent', label: 'überwiegend kontinent', counts: false },
  { value: 'ueberwiegend_inkontinent', label: 'überwiegend inkontinent', counts: true },
  { value: 'vollstaendig_inkontinent', label: 'vollständig inkontinent', counts: true },
  { value: 'kuenstlich', label: 'künstliche Ableitung von Stuhl oder Harn', counts: true }
];

function withPoints(scale, points) {
  return scale.map((o, i) => ({ value: i, label: o.label, desc: o.desc, points: points[i] }));
}

const P_0123 = [0, 1, 2, 3];

function scaleCriterion(id, name, text, scale, points = P_0123, extra = {}) {
  return { id, name, text, type: 'scale', options: withPoints(scale, points), ...extra };
}

// Typen:
//   scale    Wert = Index der Ausprägung 0..3 (bei 4.13: 0..2), Punkte aus options[].points
//   m3       wie scale, Punkte 0/1/3/5 (Häufigkeit)
//   incont   Wert = { rating: 0..3, status: <CONTINENCE_STATES.value> } (4.11, 4.12)
//   freq     Wert = { day, week, month } Anzahl Maßnahmen (5.1 bis 5.11), Gruppe a (5.1-5.7) oder b (5.8-5.11)
//   visits   Wert = { day?, week, month } (5.12 bis 5.15), Punkte nach Wochen-/Monatsfaktor, Summe in Gruppe c
export const MODULES = [
  {
    id: 1, name: 'Mobilität', weight: 10, maxRaw: 15,
    desc: 'Selbständigkeit bei Bewegungs- und Lageveränderungen — vom Drehen im Bett bis zum Treppensteigen.',
    bands: [1, 3, 5, 9], weighted: [0, 2.5, 5, 7.5, 10],
    bandLabels: ['0 – 1', '2 – 3', '4 – 5', '6 – 9', '10 – 15'],
    criteria: [
      scaleCriterion('1.1', 'Positionswechsel im Bett',
        'Einnehmen verschiedener Positionen im Bett, Drehen um die Längsachse, Aufrichten aus dem Liegen oder Hinlegen aus dem Sitzen.', SCALE_SELBSTAENDIG),
      scaleCriterion('1.2', 'Halten einer stabilen Sitzposition',
        'Aufrechtes Sitzen auf einem Stuhl oder Sitz mit Rückenlehne, gegebenenfalls auch auf der Bettkante.', SCALE_SELBSTAENDIG),
      scaleCriterion('1.3', 'Umsetzen',
        'Wechsel von einer erhöhten Sitzfläche, etwa vom Bett zum Stuhl, vom Stuhl zum Toilettenstuhl oder vom Stuhl zum Rollstuhl.', SCALE_SELBSTAENDIG),
      scaleCriterion('1.4', 'Fortbewegen innerhalb des Wohnbereichs',
        'Sich zwischen den Zimmern einer Wohnung oder zwischen mehreren Räumen einer Pflegeeinrichtung auf derselben Ebene fortbewegen.', SCALE_SELBSTAENDIG),
      scaleCriterion('1.5', 'Treppensteigen',
        'Überwinden von Treppen zwischen zwei Etagen in aufrechter Position.', SCALE_SELBSTAENDIG)
    ]
  },
  {
    id: 2, name: 'Kognitive und kommunikative Fähigkeiten', weight: 15, maxRaw: 33,
    desc: 'Erkennen, Orientieren, Verstehen, Entscheiden und sprachliche Mitteilungsfähigkeit — die geistigen Grundfunktionen für den Alltag.',
    bands: [1, 5, 10, 16], weighted: [0, 3.75, 7.5, 11.25, 15],
    bandLabels: ['0 – 1', '2 – 5', '6 – 10', '11 – 16', '17 – 33'],
    criteria: [
      scaleCriterion('2.1', 'Erkennen von Personen aus dem näheren Umfeld',
        'Wiedererkennen vertrauter Personen wie Familie, Pflegepersonal oder Mitbewohner der Einrichtung.', SCALE_FAEHIGKEIT),
      scaleCriterion('2.2', 'Örtliche Orientierung',
        'Orientierung in der eigenen Wohnung, im Haus oder in vertrauter Umgebung — sich Räume und Wege merken.', SCALE_FAEHIGKEIT),
      scaleCriterion('2.3', 'Zeitliche Orientierung',
        'Orientierung in Bezug auf Tageszeit, Wochentag, Jahreszeit oder Jahr.', SCALE_FAEHIGKEIT),
      scaleCriterion('2.4', 'Erinnern an wesentliche Ereignisse oder Beobachtungen',
        'Kürzlich erlebte Ereignisse, Begegnungen oder Mitteilungen erinnern und in den Tagesablauf einordnen können.', SCALE_FAEHIGKEIT),
      scaleCriterion('2.5', 'Steuern von mehrschrittigen Alltagshandlungen',
        'Eine Tätigkeit aus mehreren Schritten in sinnvoller Reihenfolge planen und ausführen, etwa Kaffee zubereiten oder sich anziehen.', SCALE_FAEHIGKEIT),
      scaleCriterion('2.6', 'Treffen von Entscheidungen im Alltag',
        'Selbständig zwischen Alternativen entscheiden, etwa was angezogen oder gegessen wird.', SCALE_FAEHIGKEIT),
      scaleCriterion('2.7', 'Verstehen von Sachverhalten und Informationen',
        'Inhalte einer Mitteilung, einer Erklärung oder eines Gesprächs auffassen und nachvollziehen.', SCALE_FAEHIGKEIT),
      scaleCriterion('2.8', 'Erkennen von Risiken und Gefahren',
        'Gefahrenquellen im Alltag wahrnehmen, etwa eine heiße Herdplatte, glatten Boden oder Sturzgefahr.', SCALE_FAEHIGKEIT),
      scaleCriterion('2.9', 'Mitteilen von elementaren Bedürfnissen',
        'Grundbedürfnisse wie Hunger, Durst, Schmerz, Toilettengang in Worten oder Gesten verständlich ausdrücken.', SCALE_FAEHIGKEIT),
      scaleCriterion('2.10', 'Verstehen von Aufforderungen',
        'Bitten oder Aufforderungen aus dem Alltag richtig verstehen und umsetzen.', SCALE_FAEHIGKEIT),
      scaleCriterion('2.11', 'Beteiligen an einem Gespräch',
        'Aktiv an einem Gespräch teilnehmen, eigene Beiträge liefern, dem Gegenüber folgen.', SCALE_FAEHIGKEIT)
    ]
  },
  {
    id: 3, name: 'Verhaltensweisen und psychische Problemlagen', weight: 15, maxRaw: 65,
    desc: 'Auffälligkeiten im Verhalten und seelische Belastungen — bewertet nach der Häufigkeit des Auftretens.',
    bands: [0, 2, 4, 6], weighted: [0, 3.75, 7.5, 11.25, 15],
    bandLabels: ['0', '1 – 2', '3 – 4', '5 – 6', '7 – 65'],
    criteria: [
      ['3.1', 'Motorisch geprägte Verhaltensauffälligkeiten',
        'Ziel- oder ruheloses Umhergehen, Hin- und Herlaufen, körperliche Unruhe.'],
      ['3.2', 'Nächtliche Unruhe',
        'Schlafstörungen mit nächtlichem Aufstehen, Umhergehen oder Aktivitäten, die andere stören.'],
      ['3.3', 'Selbstschädigendes und autoaggressives Verhalten',
        'Sich selbst Schaden zufügen, etwa durch Kratzen, Schlagen oder Verweigern lebenswichtiger Maßnahmen.'],
      ['3.4', 'Beschädigen von Gegenständen',
        'Mutwilliges oder durch Erkrankung bedingtes Zerstören von Sachen, Mobiliar oder Material.'],
      ['3.5', 'Physisch aggressives Verhalten gegenüber anderen Personen',
        'Schlagen, Treten, Stoßen, Beißen oder anderes körperlich aggressives Verhalten gegenüber Personen.'],
      ['3.6', 'Verbale Aggression',
        'Beschimpfen, Bedrohen, lautes Anschreien oder andere verbal aggressive Äußerungen.'],
      ['3.7', 'Andere pflegerelevante vokale Auffälligkeiten',
        'Lautes Rufen, Schreien, Jammern, Stöhnen oder andere unangemessene Lautäußerungen.'],
      ['3.8', 'Abwehr pflegerischer und anderer unterstützender Maßnahmen',
        'Pflege- oder Therapiemaßnahmen werden abgelehnt, behindert oder aktiv abgewehrt.'],
      ['3.9', 'Wahnvorstellungen',
        'Wahnhafte Überzeugungen oder Verkennungen der Realität, die nicht durch Argumente korrigiert werden können.'],
      ['3.10', 'Ängste',
        'Anhaltende oder situativ auftretende Ängste, die das alltägliche Verhalten erkennbar beeinflussen.'],
      ['3.11', 'Antriebslosigkeit bei depressiver Stimmungslage',
        'Niedergeschlagenheit, Antriebslosigkeit oder Hoffnungslosigkeit, die zur Vernachlässigung des Alltags führen.'],
      ['3.12', 'Sozial inadäquate Verhaltensweisen',
        'Verhalten, das gegen soziale Konventionen verstößt — etwa Distanzlosigkeit oder unangemessene Bekleidung in der Öffentlichkeit.'],
      ['3.13', 'Sonstige pflegerelevante inadäquate Handlungen',
        'Andere Handlungen, die im jeweiligen Kontext unpassend sind — etwa Verstecken oder Sammeln von Dingen.']
    ].map(([id, name, text]) =>
      scaleCriterion(id, name, text, SCALE_HAEUFIGKEIT, [0, 1, 3, 5], { type: 'm3' }))
  },
  {
    id: 4, name: 'Selbstversorgung', weight: 40, maxRaw: 54,
    desc: 'Selbständigkeit bei der Körperpflege, beim An- und Auskleiden, bei der Ernährung und beim Toilettengang — der gewichtigste Bereich der Begutachtung.',
    bands: [2, 7, 18, 36], weighted: [0, 10, 20, 30, 40],
    bandLabels: ['0 – 2', '3 – 7', '8 – 18', '19 – 36', '37 – 54'],
    criteria: [
      scaleCriterion('4.1', 'Waschen des vorderen Oberkörpers',
        'Waschen, Abtrocknen und Pflegen des Bereichs Brust, Bauch, Arme und Hände.', SCALE_SELBSTAENDIG),
      scaleCriterion('4.2', 'Körperpflege im Bereich des Kopfes (Kämmen, Zahnpflege/Prothesenreinigung, Rasieren)',
        'Kämmen, Zahnpflege, Reinigung von Zahnprothesen, Rasieren — die Pflege im Kopfbereich.', SCALE_SELBSTAENDIG),
      scaleCriterion('4.3', 'Waschen des Intimbereichs',
        'Waschen und Pflegen des Genital- und Analbereichs, einschließlich Abtrocknen.', SCALE_SELBSTAENDIG),
      scaleCriterion('4.4', 'Duschen und Baden einschließlich Waschen der Haare',
        'Sich duschen oder baden, einschließlich Waschen der Haare und Abtrocknen des gesamten Körpers.', SCALE_SELBSTAENDIG),
      scaleCriterion('4.5', 'An- und Auskleiden des Oberkörpers',
        'Anziehen und Ablegen von Oberteilen wie Hemden, T-Shirts, Pullovern oder Jacken.', SCALE_SELBSTAENDIG),
      scaleCriterion('4.6', 'An- und Auskleiden des Unterkörpers',
        'Anziehen und Ablegen von Unterwäsche, Hosen, Strümpfen, Schuhen.', SCALE_SELBSTAENDIG),
      scaleCriterion('4.7', 'Mundgerechtes Zubereiten der Nahrung und Eingießen von Getränken',
        'Speisen klein schneiden, Brote streichen, Getränke eingießen — die Vorbereitung am Tisch zur Selbstversorgung.', SCALE_SELBSTAENDIG),
      scaleCriterion('4.8', 'Essen',
        'Aufnehmen der bereitgestellten, mundgerechten Nahrung. Wegen der besonderen Bedeutung stärker gewichtet (0/3/6/9 Punkte).',
        SCALE_SELBSTAENDIG, [0, 3, 6, 9]),
      scaleCriterion('4.9', 'Trinken',
        'Aufnehmen von Getränken aus Tasse, Glas oder Trinkhilfe. Wegen der besonderen Bedeutung stärker gewichtet (0/2/4/6 Punkte).',
        SCALE_SELBSTAENDIG, [0, 2, 4, 6]),
      scaleCriterion('4.10', 'Benutzen einer Toilette oder eines Toilettenstuhls',
        'Aufsuchen, Hinsetzen, Reinigung und Wiederaufstehen — der Toilettengang als Gesamtablauf. Stärker gewichtet (0/2/4/6 Punkte).',
        SCALE_SELBSTAENDIG, [0, 2, 4, 6]),
      {
        id: '4.11', name: 'Bewältigen der Folgen einer Harninkontinenz und Umgang mit Dauerkatheter und Urostoma',
        text: 'Umgang mit Inkontinenz-Hilfsmitteln, Wechseln von Vorlagen, Versorgung eines Dauerkatheters oder Urostomas. Die Punkte zählen nur bei „überwiegend inkontinent“, „vollständig inkontinent“ oder künstlicher Harnableitung.',
        type: 'incont', options: withPoints(SCALE_SELBSTAENDIG, P_0123)
      },
      {
        id: '4.12', name: 'Bewältigen der Folgen einer Stuhlinkontinenz und Umgang mit Stoma',
        text: 'Umgang mit Inkontinenz-Hilfsmitteln, Versorgung eines künstlichen Darmausgangs (Stoma). Die Punkte zählen nur bei „überwiegend inkontinent“, „vollständig inkontinent“ oder künstlicher Stuhlableitung.',
        type: 'incont', options: withPoints(SCALE_SELBSTAENDIG, P_0123)
      },
      scaleCriterion('4.13', 'Ernährung parenteral oder über Sonde',
        'Sonderskala: „teilweise“ ergibt 6 Punkte, „vollständig“ nur 3 Punkte, weil der Aufwand bei der oralen Nahrungsaufnahme dann weitgehend entfällt.',
        SCALE_SONDE, [0, 6, 3])
    ]
  },
  {
    id: 5, name: 'Bewältigung von und selbständiger Umgang mit krankheits- oder therapiebedingten Anforderungen und Belastungen',
    weight: 20, maxRaw: 15,
    desc: 'Medizinische und therapeutische Maßnahmen, die nicht selbständig durchgeführt werden können. Erfasst wird die durchschnittliche Häufigkeit pro Tag, Woche oder Monat (auf Dauer, voraussichtlich mindestens sechs Monate).',
    bands: [0, 1, 3, 5], weighted: [0, 5, 10, 15, 20],
    bandLabels: ['0', '1', '2 – 3', '4 – 5', '6 – 15'],
    criteria: [
      ['5.1', 'Medikation', 'a'],
      ['5.2', 'Injektionen (subcutan oder intramuskulär)', 'a'],
      ['5.3', 'Versorgung intravenöser Zugänge (Port)', 'a'],
      ['5.4', 'Absaugen und Sauerstoffgabe', 'a'],
      ['5.5', 'Einreibungen oder Kälte- und Wärmeanwendungen', 'a'],
      ['5.6', 'Messung und Deutung von Körperzuständen', 'a'],
      ['5.7', 'Körpernahe Hilfsmittel', 'a'],
      ['5.8', 'Verbandswechsel und Wundversorgung', 'b'],
      ['5.9', 'Versorgung mit Stoma', 'b'],
      ['5.10', 'Regelmäßige Einmalkatheterisierung und Nutzung von Abführmethoden', 'b'],
      ['5.11', 'Therapiemaßnahmen in häuslicher Umgebung', 'b']
    ].map(([id, name, group]) => ({
      id, name, group, type: 'freq',
      text: 'Anzahl der Maßnahmen, die der Versicherte nicht selbständig durchführen kann: durchschnittlich pro Tag, pro Woche und pro Monat. „Entfällt oder selbständig“ = überall 0.'
    })).concat([
      {
        id: '5.12', name: 'Zeit- und technikintensive Maßnahmen in häuslicher Umgebung', group: 'c', type: 'visits',
        weights: { day: 60, week: 8.6, month: 2 }, hasDaily: true,
        text: 'Regelmäßig täglich: 60 Punkte. Jede regelmäßige wöchentliche Maßnahme zählt 8,6 Punkte, jede monatliche 2 Punkte.'
      },
      {
        id: '5.13', name: 'Arztbesuche', group: 'c', type: 'visits',
        weights: { week: 4.3, month: 1 },
        text: 'Regelmäßige Besuche: jeder wöchentliche Besuch zählt 4,3 Punkte, jeder monatliche 1 Punkt.'
      },
      {
        id: '5.14', name: 'Besuch anderer medizinischer oder therapeutischer Einrichtungen (bis zu drei Stunden)', group: 'c', type: 'visits',
        weights: { week: 4.3, month: 1 },
        text: 'Regelmäßige Besuche: jeder wöchentliche Besuch zählt 4,3 Punkte, jeder monatliche 1 Punkt.'
      },
      {
        id: '5.15', name: 'Zeitlich ausgedehnte Besuche anderer medizinischer oder therapeutischer Einrichtungen (länger als drei Stunden)', group: 'c', type: 'visits',
        weights: { week: 8.6, month: 2 },
        text: 'Zeitlich ausgedehnte Besuche werden doppelt gewertet: wöchentlich 8,6 Punkte, monatlich 2 Punkte.'
      },
      scaleCriterion('5.16', 'Einhaltung einer Diät und anderer krankheits- oder therapiebedingter Verhaltensvorschriften',
        'Selbständiges Einhalten einer ärztlich verordneten Diät oder anderer dauerhafter Verhaltensregeln (z. B. Trinkmengenbegrenzung).', SCALE_5_16)
    ])
  },
  {
    id: 6, name: 'Gestaltung des Alltagslebens und sozialer Kontakte', weight: 15, maxRaw: 18,
    desc: 'Selbständigkeit bei der Tagesgestaltung, beim Sich-Beschäftigen und bei der Pflege sozialer Kontakte.',
    bands: [0, 3, 6, 11], weighted: [0, 3.75, 7.5, 11.25, 15],
    bandLabels: ['0', '1 – 3', '4 – 6', '7 – 11', '12 – 18'],
    criteria: [
      scaleCriterion('6.1', 'Gestaltung des Tagesablaufs und Anpassung an Veränderungen',
        'Den eigenen Tag selbständig strukturieren, planen und an unerwartete Änderungen anpassen.', SCALE_SELBSTAENDIG),
      scaleCriterion('6.2', 'Ruhen und Schlafen',
        'Selbständig in den Schlaf finden, durchschlafen und tagsüber Ruhephasen einplanen.', SCALE_SELBSTAENDIG),
      scaleCriterion('6.3', 'Sichbeschäftigen',
        'Selbständig sinnvolle Beschäftigungen wählen und durchführen — Hobbys, Lesen, Spiele, Spaziergänge.', SCALE_SELBSTAENDIG),
      scaleCriterion('6.4', 'Vornehmen von in die Zukunft gerichteten Planungen',
        'Vorausplanen — etwa Termine vereinbaren, Einkäufe planen, Verabredungen treffen.', SCALE_SELBSTAENDIG),
      scaleCriterion('6.5', 'Interaktion mit Personen im direkten Kontakt',
        'Selbständig in Kontakt treten, ein Gespräch führen, auf andere reagieren — im häuslichen oder pflegerischen Umfeld.', SCALE_SELBSTAENDIG),
      scaleCriterion('6.6', 'Kontaktpflege zu Personen außerhalb des direkten Umfelds',
        'Kontakt zu entfernten Familienangehörigen, Freunden oder Bekannten halten, etwa per Telefon, Brief oder Besuch.', SCALE_SELBSTAENDIG)
    ]
  }
];

// Pflegegrad-Schwellen (gewichtete Gesamtpunkte, § 15 Abs. 3 SGB XI)
export const PFLEGEGRAD_THRESHOLDS = [
  { grade: 1, from: 12.5 },
  { grade: 2, from: 27 },
  { grade: 3, from: 47.5 },
  { grade: 4, from: 70 },
  { grade: 5, from: 90 }
];

export const SEVERITY_LABELS = ['keine', 'geringe', 'erhebliche', 'schwere', 'schwerste'];

export const MODULES_BY_ID = Object.fromEntries(MODULES.map(m => [m.id, m]));

export const CRITERIA = MODULES.flatMap(m => m.criteria.map(c => ({ ...c, module: m.id })));

export const CRITERIA_BY_ID = Object.fromEntries(CRITERIA.map(c => [c.id, c]));

// Meta-Schlüssel, die der Server annimmt (z. B. im MD-Gutachten gedruckte Summen zur Gegenprobe)
export const META_KEYS = ['md_printed', 'case_title'];
