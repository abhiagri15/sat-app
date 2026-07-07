// SAT seed question bank. Each entry's `id` is immutable once committed:
// see Foundation spec Section 5 Step 4 sub-step 3 for the ordering rule.
//
// Two response formats:
//   'mcq' (default) — multiple choice. Uses `choices` + `answerIndex`.
//   'spr'           — student-produced response (numeric / fraction entry).
//                     Uses `correctAnswer` + optional `answerTolerance`;
//                     `choices` is unused (empty array) and `answerIndex`
//                     is a placeholder (0). All BANK entries are mcq —
//                     spr questions only enter the runtime via the
//                     generator pipeline + sat.questions table.
export interface Question {
  id: string;                  // `seed-rw-NNN` or `seed-math-NNN`, 1-indexed by order in this file
  section: 'rw' | 'math';
  skill: string;
  passage?: string;
  prompt: string;
  choices: string[];
  answerIndex: number;         // index into `choices` (mcq); placeholder 0 for spr
  explanation: string;         // may contain inline HTML (<b>, <i>) — trusted seed content
  source: 'seed' | 'ai';       // every Foundation entry is 'seed'
  response_format?: 'mcq' | 'spr';   // undefined / 'mcq' = multiple choice
  correct_answer?: string | null;    // SPR canonical answer (null for mcq)
  answer_tolerance?: number | null;  // SPR float tolerance (null = exact)
  // Structured math-figure spec (validated jsonb on sat.questions.figure).
  // Typed `unknown | null` here on purpose — sub-project #15 Task 4 threads the
  // snapshot end-to-end while Task 5 NARROWS this to `Figure | null` and wires
  // generation/rendering. Do not import figure-schema here (Task 4 owns the
  // passthrough, not the type). Null when a question carries no figure.
  figure?: unknown | null;
}

export const BANK: Question[] = [
  /* ---------- READING & WRITING (16 entries) ---------- */
  {
    id: 'seed-rw-001',
    section: 'rw',
    skill: 'Words in Context',
    passage: `Marie Curie's discovery of radium was not the product of a single flash of insight. Rather, it emerged from years of ______ labor, as she processed tons of pitchblende ore in a leaky shed to isolate mere fractions of a gram.`,
    prompt: 'Which word best completes the text?',
    choices: ['painstaking', 'effortless', 'reckless', 'momentary'],
    answerIndex: 0,
    explanation: 'The passage stresses "years of...labor" and processing "tons" of ore for tiny amounts — that describes <b>painstaking</b> (careful, laborious) work. "Effortless" and "momentary" contradict the years of toil; "reckless" misreads her careful method.',
    source: 'seed',
  },
  {
    id: 'seed-rw-002',
    section: 'rw',
    skill: 'Words in Context',
    passage: `Although the critic was known for harsh reviews, her assessment of the young novelist's debut was surprisingly ______, praising its ambition while gently noting its flaws.`,
    prompt: 'Which word best completes the text?',
    choices: ['scathing', 'magnanimous', 'indifferent', 'hostile'],
    answerIndex: 1,
    explanation: '"Surprisingly" signals a contrast with her usual harshness, and she "prais[es]" the book — so the review is generous: <b>magnanimous</b>. "Scathing" and "hostile" mean harsh; "indifferent" contradicts the praise.',
    source: 'seed',
  },
  {
    id: 'seed-rw-003',
    section: 'rw',
    skill: 'Command of Evidence',
    passage: `A researcher hypothesizes that urban community gardens reduce neighborhood food costs. She surveys residents near three new gardens.`,
    prompt: 'Which finding, if true, would most directly support the hypothesis?',
    choices: [
      'Residents reported spending less on vegetables after the gardens opened.',
      'The gardens attracted more visitors than expected.',
      'Residents said the gardens made the neighborhood more attractive.',
      'Volunteers enjoyed working in the gardens.',
    ],
    answerIndex: 0,
    explanation: 'The hypothesis is specifically about <b>reduced food costs</b>. Only spending less on vegetables directly measures cost. The other options describe popularity or aesthetics, which do not test the cost claim.',
    source: 'seed',
  },
  {
    id: 'seed-rw-004',
    section: 'rw',
    skill: 'Central Ideas',
    passage: `Octopuses can change both the color and the texture of their skin in under a second, using specialized cells and muscles. This ability serves not only camouflage but also communication, as some species flash patterns to warn rivals or signal mates.`,
    prompt: 'Which choice best states the main idea of the text?',
    choices: [
      'Octopuses are the fastest animals in the ocean.',
      'Octopus skin can shift rapidly and serves more than one purpose.',
      'Octopuses prefer to communicate rather than hide.',
      'Color change in octopuses is purely for camouflage.',
    ],
    answerIndex: 1,
    explanation: 'The text describes rapid skin change AND lists two purposes (camouflage and communication). Choice B captures both. D is too narrow, C overstates a preference, and A is unsupported.',
    source: 'seed',
  },
  {
    id: 'seed-rw-005',
    section: 'rw',
    skill: 'Boundaries (Punctuation)',
    passage: `The hurricane weakened before landfall ______ nevertheless, it caused significant flooding along the coast.`,
    prompt: 'Which choice completes the text so that it conforms to the conventions of Standard English?',
    choices: ['landfall, nevertheless,', 'landfall; nevertheless,', 'landfall nevertheless,', 'landfall: nevertheless'],
    answerIndex: 1,
    explanation: 'Two independent clauses joined by the conjunctive adverb "nevertheless" require a <b>semicolon</b> before it and a comma after. A comma alone (A) creates a comma splice.',
    source: 'seed',
  },
  {
    id: 'seed-rw-006',
    section: 'rw',
    skill: 'Form & Structure (Verbs)',
    passage: `By the time the team finished analyzing the data, they ______ over four thousand individual measurements.`,
    prompt: 'Which choice completes the text so that it conforms to the conventions of Standard English?',
    choices: ['will collect', 'collect', 'had collected', 'collects'],
    answerIndex: 2,
    explanation: 'The collecting happened before the finishing — a past action completed before another past action — so the <b>past perfect</b> "had collected" is correct.',
    source: 'seed',
  },
  {
    id: 'seed-rw-007',
    section: 'rw',
    skill: 'Transitions',
    passage: `Solar panels have become far cheaper over the past decade. ______, many homeowners still hesitate to install them because of high upfront costs.`,
    prompt: 'Which transition best fits the logic of the text?',
    choices: ['As a result', 'For example', 'Nevertheless', 'Similarly'],
    answerIndex: 2,
    explanation: 'Cheaper panels would suggest more adoption, but homeowners "still hesitate" — a contrast. <b>Nevertheless</b> signals that contrast. "As a result" and "Similarly" imply agreement; "For example" introduces an instance.',
    source: 'seed',
  },
  {
    id: 'seed-rw-008',
    section: 'rw',
    skill: 'Boundaries (Modifiers)',
    passage: `______, the ancient manuscript revealed details about trade routes that historians had never documented.`,
    prompt: 'Which choice completes the text so that it conforms to the conventions of Standard English?',
    choices: [
      'Carefully restored by conservators,',
      'Carefully restoring by conservators,',
      'Conservators carefully restored,',
      'Having carefully restored the conservators,',
    ],
    answerIndex: 0,
    explanation: 'The modifier must logically describe "the manuscript," which was restored. "Carefully restored by conservators" correctly modifies the manuscript. The others either misattribute the action or are ungrammatical.',
    source: 'seed',
  },
  {
    id: 'seed-rw-009',
    section: 'rw',
    skill: 'Words in Context',
    passage: `The senator's speech was deliberately ______: every phrase could be read two ways, allowing her to avoid committing to either side of the debate.`,
    prompt: 'Which word best completes the text?',
    choices: ['precise', 'ambiguous', 'enthusiastic', 'brief'],
    answerIndex: 1,
    explanation: '"Every phrase could be read two ways" defines <b>ambiguous</b>. "Precise" is the opposite; "enthusiastic" and "brief" do not relate to double meanings.',
    source: 'seed',
  },
  {
    id: 'seed-rw-010',
    section: 'rw',
    skill: 'Subject-Verb Agreement',
    passage: `The collection of rare coins, along with several gold medals, ______ displayed in the museum's east wing.`,
    prompt: 'Which choice completes the text so that it conforms to the conventions of Standard English?',
    choices: ['are', 'were', 'is', 'have been'],
    answerIndex: 2,
    explanation: 'The subject is "collection" (singular); "along with several gold medals" is a parenthetical that does not change the number. The singular verb <b>is</b> agrees with "collection."',
    source: 'seed',
  },
  {
    id: 'seed-rw-011',
    section: 'rw',
    skill: 'Central Ideas',
    passage: `Bioluminescence — the production of light by living organisms — is far more common in the deep ocean than on land. In the lightless depths, glowing is used to lure prey, find mates, and confuse predators, making it a vital survival tool rather than a curiosity.`,
    prompt: 'According to the text, deep-ocean bioluminescence is best described as',
    choices: [
      'a rare accident of evolution',
      'an essential adaptation with multiple uses',
      'mainly a way to attract human researchers',
      'less useful than light production on land',
    ],
    answerIndex: 1,
    explanation: 'The text calls it "a vital survival tool" with several uses (lure prey, find mates, confuse predators) — an essential adaptation with multiple uses (B). A and D contradict "common" and "vital"; C is absurd.',
    source: 'seed',
  },
  {
    id: 'seed-rw-012',
    section: 'rw',
    skill: 'Rhetorical Synthesis',
    passage: `Notes:\n• The library extended weekend hours last fall.\n• Student visits on weekends rose 40%.\n• A survey showed students wanted quiet study space.\n• The new hours added Saturday evenings.`,
    prompt: 'The student wants to emphasize the effect of the new hours. Which choice best uses the notes to accomplish this goal?',
    choices: [
      'The library is a popular place for students to study.',
      'After the library extended its weekend hours, student visits on weekends rose 40%.',
      'Students surveyed said they wanted quiet study space.',
      'The library is open on Saturday evenings.',
    ],
    answerIndex: 1,
    explanation: 'To emphasize the <b>effect</b> of the new hours, the sentence should link the change (extended hours) to a result (40% rise). Choice B does exactly that; the others state isolated facts without showing effect.',
    source: 'seed',
  },
  {
    id: 'seed-rw-013',
    section: 'rw',
    skill: 'Boundaries (Punctuation)',
    passage: `Jupiter, the largest planet in the solar system ______ has at least 95 known moons.`,
    prompt: 'Which choice completes the text so that it conforms to the conventions of Standard English?',
    choices: [', and', ',', ' ', ': '],
    answerIndex: 1,
    explanation: '"the largest planet in the solar system" is a nonessential appositive that must be set off by commas on BOTH sides. There is already a comma after "Jupiter," so a closing <b>comma</b> is needed before "has."',
    source: 'seed',
  },
  {
    id: 'seed-rw-014',
    section: 'rw',
    skill: 'Words in Context',
    passage: `Far from being ______, the new policy was the result of months of negotiation among groups with sharply different interests.`,
    prompt: 'Which word best completes the text?',
    choices: ['arbitrary', 'deliberate', 'collaborative', 'detailed'],
    answerIndex: 0,
    explanation: '"Far from being ___" sets up a contrast with "months of negotiation." The policy was carefully negotiated, so it was NOT <b>arbitrary</b> (random, without reason). The other words agree with negotiation rather than contrast it.',
    source: 'seed',
  },
  {
    id: 'seed-rw-015',
    section: 'rw',
    skill: 'Transitions',
    passage: `The first prototype failed every stress test. ______, the engineers rebuilt it with a reinforced frame, and the second version passed easily.`,
    prompt: 'Which transition best fits the logic of the text?',
    choices: ['In contrast', 'Consequently', 'For instance', 'Likewise'],
    answerIndex: 1,
    explanation: 'The failure caused the rebuild — a cause-and-effect relationship. <b>Consequently</b> signals result. "In contrast" and "Likewise" show comparison; "For instance" introduces an example.',
    source: 'seed',
  },
  {
    id: 'seed-rw-016',
    section: 'rw',
    skill: 'Pronoun Agreement',
    passage: `Each of the volunteers must bring ______ own identification badge to the orientation.`,
    prompt: 'Which choice completes the text so that it conforms to the conventions of Standard English?',
    choices: ['their', 'its', 'his or her', "they're"],
    answerIndex: 2,
    explanation: '"Each" is singular, so the pronoun should be singular: <b>his or her</b> (the form the SAT treats as standard for a singular indefinite). "Their" is plural; "its" is for objects; "they\'re" means "they are."',
    source: 'seed',
  },

  /* ---------- MATH (17 entries) ---------- */
  {
    id: 'seed-math-001',
    section: 'math',
    skill: 'Linear Equations',
    prompt: 'If 3x + 7 = 22, what is the value of x?',
    choices: ['3', '5', '7', '15'],
    answerIndex: 1,
    explanation: 'Subtract 7: 3x = 15. Divide by 3: <b>x = 5</b>.',
    source: 'seed',
  },
  {
    id: 'seed-math-002',
    section: 'math',
    skill: 'Linear Equations',
    prompt: 'If 2(x − 4) = 10, what is the value of x?',
    choices: ['7', '9', '3', '5'],
    answerIndex: 1,
    explanation: 'Divide both sides by 2: x − 4 = 5, so <b>x = 9</b>. (Or distribute: 2x − 8 = 10, 2x = 18, x = 9.)',
    source: 'seed',
  },
  {
    id: 'seed-math-003',
    section: 'math',
    skill: 'Percentages',
    prompt: 'A jacket originally costs $80 and is on sale for 25% off. What is the sale price?',
    choices: ['$55', '$60', '$65', '$20'],
    answerIndex: 1,
    explanation: '25% of 80 is 20, the discount. 80 − 20 = <b>$60</b>.',
    source: 'seed',
  },
  {
    id: 'seed-math-004',
    section: 'math',
    skill: 'Ratios & Proportions',
    prompt: 'A recipe uses 3 cups of flour for every 2 cups of sugar. If you use 9 cups of flour, how many cups of sugar are needed?',
    choices: ['4', '5', '6', '7'],
    answerIndex: 2,
    explanation: 'Set up the proportion 3/2 = 9/x, so 3x = 18 and x = 6. Or: 9 cups of flour is 3 batches (9 ÷ 3), and 3 × 2 = <b>6</b> cups of sugar.',
    source: 'seed',
  },
  {
    id: 'seed-math-005',
    section: 'math',
    skill: 'Systems of Equations',
    prompt: 'If x + y = 10 and x − y = 4, what is the value of x?',
    choices: ['3', '6', '7', '8'],
    answerIndex: 2,
    explanation: 'Add the equations: 2x = 14, so <b>x = 7</b> (and y = 3).',
    source: 'seed',
  },
  {
    id: 'seed-math-006',
    section: 'math',
    skill: 'Slope & Lines',
    prompt: 'What is the slope of the line passing through the points (1, 2) and (4, 11)?',
    choices: ['2', '3', '9', '13'],
    answerIndex: 1,
    explanation: 'Slope = (11 − 2)/(4 − 1) = 9/3 = <b>3</b>.',
    source: 'seed',
  },
  {
    id: 'seed-math-007',
    section: 'math',
    skill: 'Quadratics',
    prompt: 'What are the solutions to x² − 5x + 6 = 0?',
    choices: ['x = 1 and x = 6', 'x = 2 and x = 3', 'x = −2 and x = −3', 'x = 5 and x = 6'],
    answerIndex: 1,
    explanation: 'Factor: (x − 2)(x − 3) = 0, since 2 and 3 multiply to 6 and add to 5. So <b>x = 2 and x = 3</b>.',
    source: 'seed',
  },
  {
    id: 'seed-math-008',
    section: 'math',
    skill: 'Exponents',
    prompt: 'Simplify: (2x³)(3x²).',
    choices: ['5x⁵', '6x⁵', '6x⁶', '5x⁶'],
    answerIndex: 1,
    explanation: 'Multiply coefficients (2×3 = 6) and add exponents (3 + 2 = 5): <b>6x⁵</b>.',
    source: 'seed',
  },
  {
    id: 'seed-math-009',
    section: 'math',
    skill: 'Geometry (Area)',
    prompt: 'A circle has a radius of 5. What is its area? (Use π.)',
    choices: ['10π', '25π', '50π', '5π'],
    answerIndex: 1,
    explanation: 'Area = πr² = π(5)² = <b>25π</b>.',
    source: 'seed',
  },
  {
    id: 'seed-math-010',
    section: 'math',
    skill: 'Geometry (Triangles)',
    prompt: 'A right triangle has legs of length 6 and 8. What is the length of the hypotenuse?',
    choices: ['10', '12', '14', '48'],
    answerIndex: 0,
    explanation: 'By the Pythagorean theorem: 6² + 8² = 36 + 64 = 100, and √100 = <b>10</b>. (This is the classic 6-8-10 triangle.)',
    source: 'seed',
  },
  {
    id: 'seed-math-011',
    section: 'math',
    skill: 'Statistics (Mean)',
    prompt: 'The mean of five numbers is 12. Four of the numbers are 10, 11, 13, and 14. What is the fifth number?',
    choices: ['10', '12', '14', '60'],
    answerIndex: 1,
    explanation: 'The five numbers sum to 5 × 12 = 60. The four known numbers sum to 48, so the fifth is 60 − 48 = <b>12</b>.',
    source: 'seed',
  },
  {
    id: 'seed-math-012',
    section: 'math',
    skill: 'Linear Functions',
    prompt: 'A taxi charges a $3 base fare plus $2 per mile. Which equation gives the total cost C for m miles?',
    choices: ['C = 3m + 2', 'C = 2m + 3', 'C = 5m', 'C = 2m − 3'],
    answerIndex: 1,
    explanation: 'The per-mile rate (2) multiplies miles, and the base fare (3) is added once: <b>C = 2m + 3</b>.',
    source: 'seed',
  },
  {
    id: 'seed-math-013',
    section: 'math',
    skill: 'Percentages',
    prompt: '15 is what percent of 60?',
    choices: ['15%', '20%', '25%', '40%'],
    answerIndex: 2,
    explanation: '15/60 = 0.25 = <b>25%</b>.',
    source: 'seed',
  },
  {
    id: 'seed-math-014',
    section: 'math',
    skill: 'Probability',
    prompt: 'A bag has 3 red, 4 blue, and 5 green marbles. If one marble is drawn at random, what is the probability it is blue?',
    choices: ['1/4', '1/3', '1/2', '5/12'],
    answerIndex: 1,
    explanation: 'There are 3 + 4 + 5 = 12 marbles, 4 of them blue. Probability = 4/12 = <b>1/3</b>.',
    source: 'seed',
  },
  {
    id: 'seed-math-015',
    section: 'math',
    skill: 'Inequalities',
    prompt: 'Solve for x: 4x − 3 < 9.',
    choices: ['x < 3', 'x > 3', 'x < 1.5', 'x > 1.5'],
    answerIndex: 0,
    explanation: 'Add 3: 4x < 12. Divide by 4: <b>x < 3</b>. (The inequality sign stays the same because we divided by a positive number.)',
    source: 'seed',
  },
  {
    id: 'seed-math-016',
    section: 'math',
    skill: 'Exponential Growth',
    prompt: 'A population of bacteria doubles every hour. If it starts at 50, how many are there after 3 hours?',
    choices: ['150', '300', '400', '450'],
    answerIndex: 2,
    explanation: 'Doubling each hour: 50 → 100 → 200 → 400. After 3 hours there are 50 × 2³ = <b>400</b>.',
    source: 'seed',
  },
  {
    id: 'seed-math-017',
    section: 'math',
    skill: 'Functions',
    prompt: 'If f(x) = 2x² − 1, what is f(3)?',
    choices: ['11', '17', '12', '35'],
    answerIndex: 1,
    explanation: 'f(3) = 2(3)² − 1 = 2(9) − 1 = 18 − 1 = <b>17</b>.',
    source: 'seed',
  },
];

// `moduleSeconds` is the OFFICIAL Digital SAT per-module time budget and the
// source of truth for full-test module timers (R&W 32 min = 1920 s, Math
// 35 min = 2100 s). `secsPerQ` is DERIVED (`moduleSeconds / moduleSize` —
// ≈71.1 s for R&W, ≈95.5 s for Math) so short-test budgets
// (`Math.round(shortCount × secsPerQ)`) and every existing multiply-only call
// site keep working while automatically tracking real pacing. Because
// `secsPerQ` is now fractional, every timer seed derived from it must be
// `Math.round`ed so `remaining` starts integral. Scoring curves are
// count-based and untouched by this timing change.
export const SECTION_CONFIG = {
  rw:   { name: 'Reading & Writing', shortCount: 10, moduleSize: 27, modulesPerSection: 2, moduleSeconds: 1920, secsPerQ: 1920 / 27 },
  math: { name: 'Math',              shortCount: 10, moduleSize: 22, modulesPerSection: 2, moduleSeconds: 2100, secsPerQ: 2100 / 22 },
} as const;

export const SECTION_ORDER = ['rw', 'math'] as const;
export type SectionKey = (typeof SECTION_ORDER)[number];

// Total questions across a section when the test is 'full' (sum of all
// modules). For 'short', the count is `shortCount` (one module only).
export function fullSectionCount(s: SectionKey): number {
  const c = SECTION_CONFIG[s];
  return c.moduleSize * c.modulesPerSection;   // 54 / 44
}

// The skill taxonomy the AI generator targets — covers all College Board
// Digital SAT domains (R&W: Craft and Structure, Information and Ideas,
// Standard English Conventions, Expression of Ideas; Math: Algebra,
// Advanced Math, Problem-Solving and Data Analysis, Geometry and
// Trigonometry). Alphabetised within each section. Keep in sync with
// the n8n workflow's Plan Batches `SKILLS` constant (manual sync — see
// CLAUDE.md "AI sub-project gotchas").
export const SKILLS: Record<SectionKey, string[]> = {
  rw: [
    'Boundaries (Modifiers)',
    'Boundaries (Punctuation)',
    'Central Ideas',
    'Command of Evidence',
    'Command of Evidence (Quantitative)',
    'Cross-Text Connections',
    'Form & Structure (Verbs)',
    'Inferences',
    'Pronoun Agreement',
    'Rhetorical Synthesis',
    'Subject-Verb Agreement',
    'Text Structure and Purpose',
    'Transitions',
    'Words in Context',
  ],
  math: [
    'Circles',
    'Equivalent Expressions',
    'Exponential Growth',
    'Exponents',
    'Functions',
    'Geometry (Area)',
    'Geometry (Triangles)',
    'Inequalities',
    'Linear Equations',
    'Linear Functions',
    'Percentages',
    'Probability',
    'Quadratics',
    'Ratios & Proportions',
    'Right Triangle Trigonometry',
    'Scatterplots & Models',
    'Slope & Lines',
    'Statistics (Mean)',
    'Statistics (Spread)',
    'Systems of Equations',
    'Volume',
  ],
};

// ---- College Board Digital SAT content domains ----
// Domain-weighted full-test assembly (app/lib/assembly.ts + app/lib/pool.ts)
// draws each full test to the official domain blueprint. The skill->domain map
// and the blueprint live ONLY here — the draw_questions RPC receives a plain
// skill list (p_skills), so there is no SQL-side or n8n-side domain copy to
// keep in sync.
export const RW_DOMAINS = [
  'Information and Ideas',
  'Craft and Structure',
  'Expression of Ideas',
  'Standard English Conventions',
] as const;
export const MATH_DOMAINS = [
  'Algebra',
  'Advanced Math',
  'Problem-Solving and Data Analysis',
  'Geometry and Trigonometry',
] as const;
export type Domain = (typeof RW_DOMAINS)[number] | (typeof MATH_DOMAINS)[number];

export const DOMAINS: Record<SectionKey, readonly Domain[]> = {
  rw: RW_DOMAINS,
  math: MATH_DOMAINS,
};

// Every skill in SKILLS maps to exactly one domain. (Verified exhaustive by
// scripts/check-assembly.ts.)
export const SKILL_DOMAIN: Record<string, Domain> = {
  // R&W — Information and Ideas
  'Central Ideas': 'Information and Ideas',
  'Inferences': 'Information and Ideas',
  'Command of Evidence': 'Information and Ideas',
  'Command of Evidence (Quantitative)': 'Information and Ideas',
  // R&W — Craft and Structure
  'Words in Context': 'Craft and Structure',
  'Text Structure and Purpose': 'Craft and Structure',
  'Cross-Text Connections': 'Craft and Structure',
  // R&W — Expression of Ideas
  'Rhetorical Synthesis': 'Expression of Ideas',
  'Transitions': 'Expression of Ideas',
  // R&W — Standard English Conventions
  'Boundaries (Modifiers)': 'Standard English Conventions',
  'Boundaries (Punctuation)': 'Standard English Conventions',
  'Form & Structure (Verbs)': 'Standard English Conventions',
  'Subject-Verb Agreement': 'Standard English Conventions',
  'Pronoun Agreement': 'Standard English Conventions',
  // Math — Algebra
  'Linear Equations': 'Algebra',
  'Linear Functions': 'Algebra',
  'Systems of Equations': 'Algebra',
  'Inequalities': 'Algebra',
  'Slope & Lines': 'Algebra',
  // Math — Advanced Math
  'Quadratics': 'Advanced Math',
  'Exponents': 'Advanced Math',
  'Exponential Growth': 'Advanced Math',
  'Equivalent Expressions': 'Advanced Math',
  'Functions': 'Advanced Math',
  // Math — Problem-Solving and Data Analysis
  'Percentages': 'Problem-Solving and Data Analysis',
  'Ratios & Proportions': 'Problem-Solving and Data Analysis',
  'Probability': 'Problem-Solving and Data Analysis',
  'Statistics (Mean)': 'Problem-Solving and Data Analysis',
  'Statistics (Spread)': 'Problem-Solving and Data Analysis',
  'Scatterplots & Models': 'Problem-Solving and Data Analysis',
  // Math — Geometry and Trigonometry
  'Circles': 'Geometry and Trigonometry',
  'Geometry (Area)': 'Geometry and Trigonometry',
  'Geometry (Triangles)': 'Geometry and Trigonometry',
  'Volume': 'Geometry and Trigonometry',
  'Right Triangle Trigonometry': 'Geometry and Trigonometry',
};

// Official Digital SAT domain weights, as percent of the section (each section
// sums to 100). Keyed per section; only that section's domains are present.
export const DOMAIN_BLUEPRINT: Record<SectionKey, Partial<Record<Domain, number>>> = {
  rw: {
    'Information and Ideas': 26,
    'Craft and Structure': 28,
    'Expression of Ideas': 20,
    'Standard English Conventions': 26,
  },
  math: {
    'Algebra': 35,
    'Advanced Math': 35,
    'Problem-Solving and Data Analysis': 15,
    'Geometry and Trigonometry': 15,
  },
};

// The skills belonging to a domain (derived from SKILL_DOMAIN), used to build
// the p_skills list passed to draw_questions.
export function skillsInDomain(section: SectionKey, domain: Domain): string[] {
  return SKILLS[section].filter((s) => SKILL_DOMAIN[s] === domain);
}

// Maps a sat.questions row (snake_case, choices as jsonb) to the Question type.
// Reads response_format / correct_answer / answer_tolerance with safe defaults
// so the function still works against rows from before the SPR migration ran.
export function rowToQuestion(row: {
  id: string;
  section: string;
  skill: string;
  passage: string | null;
  prompt: string;
  choices: unknown;
  answer_index: number;
  explanation: string;
  source: string;
  response_format?: string | null;
  correct_answer?: string | null;
  answer_tolerance?: number | null;
  figure?: unknown | null;
}): Question {
  return {
    id: row.id,
    section: row.section as SectionKey,
    skill: row.skill,
    passage: row.passage ?? undefined,
    prompt: row.prompt,
    // `choices` is jsonb — guard against a malformed row so a bad value
    // surfaces as an empty-choice question rather than crashing mid-render.
    choices: Array.isArray(row.choices) ? (row.choices as string[]) : [],
    answerIndex: row.answer_index,
    explanation: row.explanation,
    source: row.source as 'seed' | 'ai',
    response_format: row.response_format === 'spr' ? 'spr' : 'mcq',
    correct_answer: row.correct_answer ?? null,
    answer_tolerance: row.answer_tolerance ?? null,
    // Figure snapshot (jsonb, may be null). Task 5 narrows the type + validates;
    // Task 4 just carries the raw value through null-safe.
    figure: row.figure ?? null,
  };
}
