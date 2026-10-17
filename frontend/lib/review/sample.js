/* =============================================================================
   The sample report shown at /review/sample.

   An invented portfolio, written to show the shape and tone of a real report —
   not anyone's actual work. The dimensions, weights, levels, gates and bands
   are the RPS Review Base v0.3. Every number on the page is worked out from
   the levels below in code, the same way a real report's would be: nothing
   is typed in as a total.
   ============================================================================= */

/* ------------------------------------------------------------------ rubric */

/* The four pillars a person sees. `ask` is the pillar in plain words; `paper`
   picks the bento tile colour. */
export const PILLARS = [
  { id: 'story', name: 'Story', ask: 'Do your case studies explain the problem, your choices and the result?', paper: 'peach' },
  { id: 'aim', name: 'Ownership and aim', ask: 'Is it clear what you did, and what job you want?', paper: 'sky' },
  { id: 'craft', name: 'Craft', ask: 'Does the work look polished?', paper: 'mint' },
  { id: 'clarity', name: 'Clarity', ask: 'Is it quick to read, with nothing broken?', paper: 'amber' },
];

/* Ten dimensions, weights add to 100. `name` is the rubric's; `label` is what
   the report shows, in plain words. `perCase` dimensions are scored on each
   case study and blended with caseWeights; the rest are scored once for the
   whole portfolio. */
export const DIMENSIONS = [
  { id: 'd1', name: 'Problem framing', label: 'The problem', pillar: 'story', weight: 12, perCase: true },
  { id: 'd2', name: 'Decisions and trade-offs', label: 'Your design choices', pillar: 'story', weight: 18, perCase: true },
  { id: 'd3', name: 'Evidence and outcome', label: 'Results', pillar: 'story', weight: 12, perCase: true },
  { id: 'd4', name: 'Reflection', label: 'What you learned', pillar: 'story', weight: 6, perCase: true },
  { id: 'd5', name: 'Positioning and first screen', label: 'Home page', pillar: 'aim', weight: 10, perCase: false },
  { id: 'd6', name: 'Role and ownership', label: 'Your role', pillar: 'aim', weight: 10, perCase: true },
  { id: 'd7', name: 'Curation and range', label: 'Choice of projects', pillar: 'aim', weight: 8, perCase: false },
  { id: 'd8', name: 'Visual and interaction craft', label: 'Visual polish', pillar: 'craft', weight: 12, perCase: false },
  { id: 'd9', name: 'Communication and scannability', label: 'Easy to skim', pillar: 'clarity', weight: 8, perCase: true },
  { id: 'd10', name: 'Hygiene and access', label: 'Links, mobile, contact', pillar: 'clarity', weight: 4, perCase: false },
];

/* Anchored levels, not a 1–10 scale. N/A is reported, never scored. The
   rubric calls level 2 "Solid" and level 1 "Developing"; the report says
   "Good" and "Needs work", plain words a student reads without a key. */
export const LEVELS = [
  { n: 3, name: 'Strong' },
  { n: 2, name: 'Good' },
  { n: 1, name: 'Needs work' },
  { n: 0, name: 'Missing' },
];
/* A blended level (2.3) takes the nearest level's name; exactly halfway (1.5)
   rounds down, so the word never claims more than the evidence. */
export const levelName = (n) => {
  const near = n % 1 === 0.5 ? Math.floor(n) : Math.round(n);
  return (LEVELS.find((l) => l.n === near) || {}).name || 'Can’t see';
};

/* First case study is read closely, the rest are spot-checked. */
export const caseWeights = (count) =>
  count >= 3 ? [0.5, 0.3, 0.2] : count === 2 ? [0.6, 0.4] : [1];

/* Highest band first. `min` is inclusive. */
/* The rubric's Ready to send / Close / Developing / Rebuild, named as steps
   up rather than grades, each with the next thing to do. */
export const BANDS = [
  { id: 'ready', name: 'Interview-ready', short: 'Ready', min: 85, means: 'Fix the small stuff and start applying.' },
  { id: 'almost', name: 'Almost there', min: 70, means: 'One or two fixes and you’re ready to apply.' },
  { id: 'getting', name: 'Getting there', min: 50, means: 'Good bones. Show your thinking and your results.' },
  { id: 'warming', name: 'Warming up', min: 0, means: 'The pieces are there. Now build one strong case study.' },
];

/* Conditions that hold the score down however well the rest scores (Review
   Base v0.3). G1 and G5 are flagged on the report; the others cap the score
   at `max`. Past 70 takes two real case studies and results; past 75, a
   measured or shipped result; 85 and up, a lead project a top team would
   call excellent. */
const lead = (r) => (r.cases[0] && r.cases[0].levels) || {};
export const GATES = [
  { id: 'g1', name: 'Work you can open', test: (r) => r.cases.length > 0 },
  { id: 'g2', name: 'A problem stated somewhere', test: (r) => r.cases.some((c) => c.levels.d1 > 0), max: 49 },
  { id: 'g3', name: 'Your role stated somewhere', test: (r) => r.cases.some((c) => c.levels.d6 > 0), max: 49 },
  { id: 'g4', name: 'More than final screens', test: (r) => r.cases.some((c) => c.levels.d2 > 0), max: 49 },
  { id: 'g5', name: 'No integrity concerns', test: (r) => !r.integrityFlag },
  { id: 'g6', name: 'A real design decision, explained, in your lead project', test: (r) => lead(r).d2 >= 2, max: 59 },
  { id: 'g7', name: 'Results shown in at least one project', test: (r) => r.cases.some((c) => c.levels.d3 >= 2), max: 59 },
  { id: 'g8', name: 'Your role clear in your lead project', test: (r) => lead(r).d6 >= 2, max: 64 },
  { id: 'g9', name: 'At least two case studies', test: (r) => r.cases.length >= 2, max: 69 },
  { id: 'g10', name: 'A measured or shipped result', test: (r) => r.cases.some((c) => c.levels.d3 >= 3), max: 74 },
  {
    id: 'g11',
    name: 'A lead project with strong decisions and a measured result, on a clear, polished site',
    test: (r) =>
      lead(r).d1 >= 2 && lead(r).d2 >= 3 && lead(r).d3 >= 3 && lead(r).d6 >= 2 &&
      r.portfolio.d5 >= 2 && r.portfolio.d8 >= 2,
    max: 84,
  },
];

/* ------------------------------------------------------------------ maths */

/* A dimension's blended level, 0..3 (fractional when blended across cases). */
export function dimLevel(report, dim) {
  if (!dim.perCase) return report.portfolio[dim.id];
  const w = caseWeights(report.cases.length);
  return report.cases.reduce((sum, c, i) => sum + (c.levels[dim.id] || 0) * w[i], 0);
}

/* How much of a dimension's weight each level earns. Not a straight line:
   "Good" is the hiring bar, not two-thirds of the way to excellent, so it
   earns half; "Needs work" earns little; only "Strong" earns it all. */
export const LEVEL_SHARE = [0, 0.15, 0.5, 1];

/* A blended level (2.3) earns in proportion between its two neighbours. */
export function levelShare(level) {
  const lo = Math.max(0, Math.min(3, Math.floor(level)));
  const hi = Math.min(3, lo + 1);
  return LEVEL_SHARE[lo] + (LEVEL_SHARE[hi] - LEVEL_SHARE[lo]) * (level - lo);
}

/* Points = weight × the share its level earns. */
export const dimPoints = (report, dim) => dim.weight * levelShare(dimLevel(report, dim));

export const pillarWeight = (pillarId) =>
  DIMENSIONS.filter((d) => d.pillar === pillarId).reduce((s, d) => s + d.weight, 0);

export const pillarPoints = (report, pillarId) =>
  DIMENSIONS.filter((d) => d.pillar === pillarId).reduce((s, d) => s + dimPoints(report, d), 0);

export const exactScore = (report) => DIMENSIONS.reduce((s, d) => s + dimPoints(report, d), 0);

export const gateResults = (report) => GATES.map((g) => ({ ...g, passed: g.test(report) }));

/* The gates this report misses that hold its score down, lowest ceiling first. */
export const heldBy = (report) =>
  gateResults(report)
    .filter((g) => !g.passed && g.max != null)
    .sort((a, b) => a.max - b.max);

/* The most this report can score until it clears those gates: 100 if none. */
export const scoreCap = (report) => heldBy(report).reduce((m, g) => Math.min(m, g.max), 100);

/* The score before rounding, with the gates' ceiling applied. */
const cappedScore = (report) => Math.min(exactScore(report), scoreCap(report));
export const overallScore = (report) => Math.round(cappedScore(report));

/* The band follows the score; the gates have already held the score down.
   `report` is accepted so older callers keep working. */
// eslint-disable-next-line no-unused-vars
export function bandFor(score, report) {
  return BANDS.find((b) => score >= b.min) || BANDS[BANDS.length - 1];
}

/* The report as it would be with one fix made: the case-study levels it
   names are raised, everything else stays. */
export function withFix(report, fix) {
  return {
    ...report,
    portfolio: { ...report.portfolio, ...(fix.portfolio || {}) },
    cases: report.cases.map((c, i) =>
      fix.cases && fix.cases[i] != null ? { ...c, levels: { ...c.levels, [fix.dim]: fix.cases[i] } } : c
    ),
  };
}
/* What one fix adds to the score a person sees, gates included: a fix that
   clears a gate can add more than its own points; one held by another gate,
   less. */
export const fixLift = (report, fix) => cappedScore(withFix(report, fix)) - cappedScore(report);
export const withAllFixes = (report) => report.fixes.reduce((r, f) => withFix(r, f), report);

/* 9.2 → "9.2", 12 → "12" */
export const pts = (n) => String(Math.round(n * 10) / 10);

/* ------------------------------------------------------------------ the sample */

export const SAMPLE = {
  // .example is reserved, so this can never be someone's real site.
  site: 'sample-portfolio.example',
  level: 'Fresher',
  role: 'Product designer',
  reviewedOn: '2 October 2026',
  integrityFlag: false,

  /* Scored once for the whole site. */
  portfolio: { d5: 2, d7: 2, d8: 3, d10: 3 },

  /* In the order the portfolio shows them. */
  cases: [
    {
      title: 'Ordering food at the college canteen',
      kind: 'Personal project',
      levels: { d1: 3, d2: 2, d3: 1, d4: 2, d6: 3, d9: 2 },
      good: 'A real problem you saw yourself: students losing 15 minutes of lunch break in the queue.',
      fix: 'You tested it with 5 classmates but never say how it went. Add the result.',
    },
    {
      title: 'Booking a doctor’s appointment',
      kind: 'Course project, team of 3',
      levels: { d1: 2, d2: 1, d3: 1, d4: 1, d6: 1, d9: 2 },
      good: 'A short summary at the top, and screens that are easy to follow.',
      fix: 'It says “we” everywhere. Say which screens you designed yourself.',
    },
    {
      title: 'A habit tracker app',
      kind: 'Hackathon, team of 4',
      levels: { d1: 1, d2: 1, d3: 0, d4: 0, d6: 2, d9: 1 },
      good: 'Shows you can build something with developers in 2 days.',
      fix: 'It opens with screenshots. Start with the problem in one sentence.',
    },
  ],

  /* One line each: why the pillar landed where it did. */
  pillarWhy: {
    story: 'Your first case study explains the problem well, but none of them says how it turned out.',
    aim: 'Your home page says what job you want. In team projects, it’s unclear what you did.',
    craft: 'Clean, consistent screens in every project. Full marks here.',
    clarity: 'Two case studies are quick to read. The habit tracker is one very long page.',
  },

  /* Ordered by lift. `cases` lists the level each case study would reach. */
  fixes: [
    {
      dim: 'd3',
      cases: [3, 2, null],
      title: 'Say how it turned out',
      where: 'Canteen app and doctor app, at the end',
      now: 'Both stop at the final screens. You never say if the design worked.',
      try: '“I tested it with 5 classmates. 4 of them ordered lunch in under a minute. Before, it took 15 minutes in the queue.”',
    },
    {
      dim: 'd2',
      cases: [3, null, null],
      title: 'Show what you tried before the final design',
      where: 'Canteen app, design section',
      now: '“I used a grid of food photos because it looks better.” Only one idea is shown.',
      try: 'Put the two menus you tried side by side, a photo grid and a simple list, and say why the list won. For example: “Students already know the menu, so they want to find items fast, not browse.”',
    },
    {
      dim: 'd6',
      cases: [null, 3, null],
      title: 'Say what you did in team projects',
      where: 'Doctor app, top of the page',
      now: '“We did research, we designed, we tested.” There’s no way to tell which part was yours.',
      try: '“My role: UX designer in a team of 3. I designed the booking and payment screens. Riya ran the interviews, and Arjun made the prototype.”',
    },
  ],

  strengths: [
    'Every project looks clean and consistent.',
    'Your home page says who you are and what job you want, in one line.',
    'Your first project starts from a real problem you saw yourself.',
  ],

  cantSee: 'The Figma prototype inside the habit tracker project. We can’t open embedded files, so we scored the screenshots around it instead. You didn’t lose points for it.',
};
