import type { AIProvider, SolveInput, SolveResult } from './provider';
import type { GeneratedQuestion } from './schema';

const BASE_URL = process.env.OLLAMA_BASE_URL ?? 'https://ollama.com';

interface ChatResponse {
  choices?: { message?: { content?: string } }[];
}

async function chat(content: string): Promise<string> {
  const apiKey = process.env.OLLAMA_API_KEY;
  const model = process.env.SAT_AI_MODEL;
  if (!apiKey) throw new Error('OLLAMA_API_KEY is not set');
  if (!model) throw new Error('SAT_AI_MODEL is not set');

  const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content }],
      stream: false,
    }),
  });
  if (!res.ok) {
    throw new Error(`Ollama Cloud ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = (await res.json()) as ChatResponse;
  return data.choices?.[0]?.message?.content ?? '';
}

// Per-skill format directives for the drift-prone R&W skills. Injected into
// the generation prompt so the model produces the authentic Digital SAT
// archetype for the skill instead of a superficially-similar question. Skills
// not listed here are covered by the global RW authenticity rules below.
const RW_ARCHETYPES: Record<string, string> = {
  'Rhetorical Synthesis':
    'FORMAT: the passage MUST begin with "While researching a topic, a student has taken the following notes:" followed by 3-5 short bulleted facts, each on its own line prefixed with "- ". The prompt states a specific goal (e.g. "The student wants to emphasize ..."). The 4 choices are full sentences synthesizing the notes; exactly one accomplishes the stated goal using only information from the notes. Do NOT write abstract "Critic X praised / Critic Y said" stems.',
  'Transitions':
    'FORMAT: the passage is 1-3 complete sentences with a single blank "______" where a transition belongs. The 4 choices are transition words/phrases (e.g. "However", "For example", "As a result", "Similarly").',
  'Boundaries (Punctuation)':
    'FORMAT: the passage has a single blank "______" at a clause boundary. The 4 choices MUST be the literal punctuation/text to insert (e.g. ";", ", and", ":", " —") — NEVER meta-descriptions like "a semicolon", "a comma", or "no punctuation".',
  'Words in Context':
    'FORMAT: a single blank "______". The 4 choices are high-utility academic words of the kind the College Board actually uses (e.g. "undermine", "comprehensive", "novel", "tentative"). Do NOT use obscure or archaic vocabulary (e.g. "circumlocution", "cogency", "perspicacious").',
  'Command of Evidence (Quantitative)':
    'FORMAT: the passage briefly describes data (a study, table, or figure summarized in words with specific numbers) and states a claim or hypothesis. The prompt asks which finding would most directly support or weaken the claim. The choices reference the data.',
  'Cross-Text Connections':
    'FORMAT: the passage contains two labeled texts ("Text 1" and "Text 2") by different authors on a shared topic. The prompt asks how the two texts relate or how one author would respond to the other.',
};

// Global authenticity rules appended to every R&W generation prompt. These
// target the failure modes seen in real attempts: trivial common-sense items,
// math/logic puzzles dressed as Reading, unfair pronoun items, and references
// to UI affordances (underlines) the app does not render.
const RW_AUTHENTICITY_RULES =
  '- AUTHENTICITY: this must read like a real Digital SAT R&W question. Do NOT write trivial or common-sense items solvable from everyday experience (e.g. inferring a season from falling leaves). For Inferences / Central Ideas / Text Structure and Purpose, the passage must be substantive academic prose (3-6 sentences) and the answer must require reading THAT passage, not outside knowledge.\n' +
  '- Do NOT disguise arithmetic, probability, or logic puzzles as a Reading question. Quantitative reasoning belongs only in the Math section.\n' +
  '- For Pronoun Agreement, NEVER make the answer hinge on "their" vs "his or her" — singular "they" is accepted on the Digital SAT. Test genuine number agreement or ambiguous-reference errors instead.\n' +
  '- NEVER refer to "the underlined sentence", "the underlined portion", or any bold/highlighted text — the app renders no such markup. Quote the relevant text directly in the prompt instead.\n';

// Tolerantly extract a JSON value from a model response (strips ``` fences).
function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced ? fenced[1] : text).trim();
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`extractJson: invalid JSON from model: ${raw.slice(0, 120)}`);
  }
}

export class OllamaCloudProvider implements AIProvider {
  async generateQuestions(
    section: 'rw' | 'math',
    skill: string,
    count: number,
    useSpr: boolean,
    targetDifficulty: 'easy' | 'medium' | 'hard',
  ): Promise<GeneratedQuestion[]> {
    // SPR is Math-only by spec; defensively force back to mcq if the caller
    // requested spr for an R&W skill.
    const effectiveSpr = useSpr && section === 'math';
    if (effectiveSpr) {
      return this.generateSprBatch(skill, count, targetDifficulty);
    }
    return this.generateMcqBatch(section, skill, count, targetDifficulty);
  }

  // Existing multiple-choice generation. Returns an array of `responseFormat:
  // 'mcq'` candidates — the discriminator is injected here so callers do not
  // have to special-case it before zod validation.
  private async generateMcqBatch(
    section: 'rw' | 'math',
    skill: string,
    count: number,
    targetDifficulty: 'easy' | 'medium' | 'hard',
  ): Promise<GeneratedQuestion[]> {
    const sectionName = section === 'rw' ? 'Reading & Writing' : 'Math';
    const example =
      section === 'rw'
        ? `{"responseFormat":"mcq","section":"rw","skill":"${skill}","difficulty":"${targetDifficulty}","passage":"Although critics initially called the design ______, recent reviews praise its bold use of color.",` +
          `"prompt":"Which choice best completes the text?","choices":["uninspired","captivating","traditional","minimal"],` +
          `"answerIndex":0,"explanation":"The contrast \\"Although ... recent reviews praise\\" signals the initial reaction was negative; uninspired fits."}`
        : `{"responseFormat":"mcq","section":"math","skill":"${skill}","difficulty":"${targetDifficulty}",` +
          `"prompt":"If 3x + 6 = 18, what is the value of x?","choices":["2","4","6","8"],` +
          `"answerIndex":1,"explanation":"Subtract 6 from both sides, then divide by 3: x = 4."}`;
    const content = await chat(
      `Generate ${count} original Digital SAT ${sectionName} multiple-choice practice questions ` +
        `for the skill "${skill}" at "${targetDifficulty}" difficulty.\n` +
        `Return ONLY a JSON array of objects — no prose, no markdown fences.\n` +
        `Each object must have exactly these keys: responseFormat, section, skill, difficulty, ` +
        `${section === 'rw' ? 'passage, ' : ''}prompt, choices, answerIndex, explanation.\n` +
        `- "responseFormat" must be "mcq".\n` +
        `- "section" must be "${section}"; "skill" must be "${skill}".\n` +
        `- "difficulty" must be exactly "${targetDifficulty}". Calibrate:\n` +
        `    easy   = single computational or recall step; one common skill; low working memory.\n` +
        `    medium = two steps or a less common skill.\n` +
        `    hard   = multi-step reasoning, careful reading, or nuanced inference.\n` +
        `- "choices" must be an array of exactly 4 distinct strings.\n` +
        `- "answerIndex" must be an integer 0-3: the 0-based index of the correct choice.\n` +
        `- CRITICAL distractor uniqueness rule: exactly ONE of the 4 choices may be a valid answer. The other 3 must be plausible distractors that are NOT valid answers. For math equations with multiple solutions (e.g. quadratics with two roots, |x|=c with two values), include only ONE of the solutions in the choices — never both roots, never both values. The other 3 should be common-mistake values (sign errors, dropped terms, miscalculated discriminants). For R&W "best choice" questions, ensure only one choice is unambiguously best; the others must be defensibly worse on inspection. Candidates that violate this rule are rejected by the self-verify multi-validity check.\n` +
        `- "explanation" must be PLAIN TEXT (no HTML, no markdown) saying why the answer is correct.\n` +
        `- IMPORTANT: in "explanation", NEVER refer to a choice by its letter or number (no "Choice A", "Option B", "choice 3", etc.). The app shuffles choices per test, so any letter/number reference becomes wrong at runtime. Refer to the chosen option as "the correct choice" or by quoting its content; refer to incorrect ones as "the other choices" / "the option that says X".\n` +
        (section === 'rw'
          ? `- "passage" must be a short text giving the context the question needs.\n` +
            `- If the question requires choosing a word, phrase, verb form, or punctuation mark to INSERT into the passage (sentence completion / cloze), the passage MUST contain exactly one blank marked with six underscores ("______") at the insertion point. Do NOT embed the chosen answer in the passage. For reading-comprehension questions (e.g., main idea, evidence support, transition between sentences as a whole), the passage is a complete text and MUST NOT contain "______".\n` +
            RW_AUTHENTICITY_RULES +
            (RW_ARCHETYPES[skill] ? `- ${RW_ARCHETYPES[skill]}\n` : '')
          : `- Omit "passage" entirely unless the problem genuinely needs a setup.\n`) +
        `Example of one valid array element:\n${example}`,
    );
    const parsed = extractJson(content);
    if (!Array.isArray(parsed)) {
      throw new Error('Ollama generateQuestions: expected a JSON array');
    }
    // Backfill responseFormat = 'mcq' if the model forgot it — the schema's
    // discriminated-union check would reject it otherwise.
    return parsed.map((q) =>
      q && typeof q === 'object' && !('responseFormat' in q)
        ? { ...q, responseFormat: 'mcq', difficulty: targetDifficulty }
        : q && typeof q === 'object' && !('difficulty' in q)
        ? { ...q, difficulty: targetDifficulty }
        : q,
    ) as GeneratedQuestion[];
  }

  // Student-Produced Response generation — Math-only. The model is asked for
  // a typed numeric answer (not a 0-3 index) and the canonical answer is what
  // we store in sat.questions.correct_answer.
  private async generateSprBatch(
    skill: string,
    count: number,
    targetDifficulty: 'easy' | 'medium' | 'hard',
  ): Promise<GeneratedQuestion[]> {
    const example =
      `{"responseFormat":"spr","section":"math","skill":"${skill}","difficulty":"${targetDifficulty}",` +
      `"prompt":"If 2x + 5 = 17, what is the value of x?",` +
      `"correctAnswer":"6","explanation":"Subtract 5: 2x = 12. Divide by 2: x = 6."}`;
    const content = await chat(
      `Generate ${count} original Digital SAT Math student-produced-response (SPR / grid-in) ` +
        `practice questions for the skill "${skill}" at "${targetDifficulty}" difficulty.\n` +
        `Return ONLY a JSON array of objects — no prose, no markdown fences.\n` +
        `Each object must have exactly these keys: responseFormat, section, skill, difficulty, prompt, ` +
        `correctAnswer, explanation. Optionally include answerTolerance.\n` +
        `- "responseFormat" must be "spr".\n` +
        `- "section" must be "math"; "skill" must be "${skill}".\n` +
        `- "difficulty" must be exactly "${targetDifficulty}". Calibrate:\n` +
        `    easy   = single computational or recall step.\n` +
        `    medium = two steps or a less common skill.\n` +
        `    hard   = multi-step reasoning or nuanced setup.\n` +
        `- "prompt" must be a clear math problem whose answer is a single number or fraction.\n` +
        `- "correctAnswer" must be the exact answer as a STRING. Accepted forms: integer ("7"), ` +
        `decimal ("3.14"), or simple fraction ("3/4"). Do NOT use mixed numbers ("1 1/2") — write ` +
        `"1.5" or "3/2" instead. No units, no commas, no leading "+" sign.\n` +
        `- "answerTolerance" is OPTIONAL. Include it ONLY when the natural answer is a non-terminating ` +
        `decimal (e.g. an answer of π should be "3.14" with tolerance 0.01). Most answers are exact ` +
        `and should omit this field.\n` +
        `- "explanation" must be PLAIN TEXT (no HTML, no markdown). Show the steps that lead to ` +
        `"correctAnswer". Do not refer to multiple-choice options — SPR questions have none.\n` +
        `- Do NOT include "choices" or "answerIndex" fields. SPR questions have no choices.\n` +
        `Example of one valid array element:\n${example}`,
    );
    const parsed = extractJson(content);
    if (!Array.isArray(parsed)) {
      throw new Error('Ollama generateQuestions(spr): expected a JSON array');
    }
    return parsed.map((q) =>
      q && typeof q === 'object' && !('responseFormat' in q)
        ? { ...q, responseFormat: 'spr', section: 'math', difficulty: targetDifficulty }
        : q && typeof q === 'object' && !('difficulty' in q)
        ? { ...q, difficulty: targetDifficulty }
        : q,
    ) as GeneratedQuestion[];
  }

  async solve(q: SolveInput): Promise<SolveResult> {
    if (q.responseFormat === 'spr') {
      const content = await chat(
        `Solve this Digital SAT Math question. Respond with ONLY the numeric answer ` +
          `as a bare string — an integer, decimal, or simple fraction. Examples of ` +
          `valid answers: "7", "3.14", "3/4", "-0.5". Do not include units, words, ` +
          `or punctuation.\n` +
          `Question: ${q.prompt}`,
      );
      // Take the first contiguous token that looks like a number or fraction.
      const m = content.trim().match(/-?\d+(?:\.\d+)?(?:\/\d+)?|\.\d+/);
      const answer = m ? m[0] : content.trim();
      return { responseFormat: 'spr', answer };
    }

    const content = await chat(
      `Solve this Digital SAT question. Respond with ONLY the 0-based index ` +
        `(0, 1, 2, or 3) of the correct choice — a single digit, nothing else.\n` +
        (q.passage ? `Passage: ${q.passage}\n` : '') +
        `Question: ${q.prompt}\n` +
        q.choices.map((c, i) => `${i}: ${c}`).join('\n'),
    );
    const trimmed = content.trim();
    const m = trimmed.match(/^[0-3]$/) ?? trimmed.match(/\b[0-3]\b/);
    if (!m) throw new Error(`Ollama solve: no index in response: ${trimmed.slice(0, 80)}`);
    return { responseFormat: 'mcq', answerIndex: Number.parseInt(m[0], 10) };
  }

  // Multi-validity check for mcq questions. Asks the model to evaluate EACH
  // of the 4 choices independently and report all that are valid. Used by
  // generate.ts after the single-answer self-verify passes; a candidate with
  // more than one valid index is rejected (the choice list is broken — e.g.
  // a quadratic with both roots in the choices).
  async findValidChoices(
    q: Extract<SolveInput, { responseFormat: 'mcq' }>,
  ): Promise<number[]> {
    const content = await chat(
      `For the Digital SAT question below, evaluate EACH of the 4 choices ` +
        `independently and decide whether it is a valid correct answer. ` +
        `A valid answer satisfies the question completely; do NOT include ` +
        `choices that are merely plausible distractors. For math equations ` +
        `with multiple roots (e.g. quadratics), every actual root that ` +
        `appears in the list counts as valid.\n\n` +
        `Respond with ONLY a JSON array of 0-based indices, e.g. [0] for one ` +
        `valid choice, or [0,2] if two are valid. No prose, no markdown, ` +
        `no other text.\n\n` +
        (q.passage ? `Passage: ${q.passage}\n` : '') +
        `Question: ${q.prompt}\n` +
        q.choices.map((c, i) => `${i}: ${c}`).join('\n'),
    );
    // Tolerant extraction: look for the first JSON-array-of-ints in the
    // response. Falls back to scraping individual 0-3 digits if the model
    // returned an unfenced list like "0, 2".
    const raw = content.trim();
    let arr: number[] | null = null;
    const fenced = raw.match(/\[\s*(?:[0-3]\s*,\s*)*[0-3]?\s*\]/);
    if (fenced) {
      try {
        const parsed = JSON.parse(fenced[0]);
        if (Array.isArray(parsed)) arr = parsed.filter((n) => Number.isInteger(n) && n >= 0 && n <= 3);
      } catch {
        /* fall through */
      }
    }
    if (arr === null) {
      const found = new Set<number>();
      for (const m2 of raw.matchAll(/\b[0-3]\b/g)) found.add(Number.parseInt(m2[0], 10));
      arr = [...found].sort();
    }
    return arr;
  }

  // Repair a multi-valid choice list by replacing the extra valid choices
  // with plausible-but-incorrect distractors. The intended answer's text is
  // preserved at its original index; only the indices in `indicesToReplace`
  // are rewritten. Returns the new 4-element choices array, or null if the
  // model couldn't produce a clean 4-string array.
  async repairMultiValid(input: {
    section: 'rw' | 'math';
    skill: string;
    passage: string | null | undefined;
    prompt: string;
    choices: string[];
    answerIndex: number;
    indicesToReplace: number[];
  }): Promise<{ choices: string[] } | null> {
    const correctText = input.choices[input.answerIndex];
    const toReplaceList = input.indicesToReplace
      .map((i) => `index ${i}: "${input.choices[i]}" (currently a valid answer, must be replaced)`)
      .join('\n');
    const choicesList = input.choices.map((c, i) => `${i}: ${c}`).join('\n');

    const content = await chat(
      `You are fixing a Digital SAT multiple-choice question whose choice list ` +
        `accidentally contains MULTIPLE valid answers. The intended single correct ` +
        `answer is at index ${input.answerIndex} (text: "${correctText}"). Replace ` +
        `each of these extra valid choices with a plausible-but-INCORRECT ` +
        `distractor:\n` +
        `${toReplaceList}\n\n` +
        `A good distractor is a value a student might compute via a common ` +
        `error (sign flip, dropped term, miscalculated discriminant, off-by-one, ` +
        `sign error inside a radical) but is NOT itself a valid solution to ` +
        `the question. Be specific to the math involved.\n\n` +
        `Rules:\n` +
        `- The choice at index ${input.answerIndex} MUST be preserved EXACTLY: "${correctText}".\n` +
        `- The other un-listed indices (not in the replace list) MUST be preserved EXACTLY too.\n` +
        `- Only replace the choices at the listed indices.\n` +
        `- The final 4 choices must be DISTINCT strings.\n` +
        `- The replacement distractors must NOT themselves be valid solutions.\n` +
        `- No multi-step changes — replacement values should look numerically close to the correct answer.\n\n` +
        (input.passage ? `Passage: ${input.passage}\n\n` : '') +
        `Question: ${input.prompt}\n\n` +
        `Current choices:\n${choicesList}\n\n` +
        `Respond with ONLY a JSON array of exactly 4 strings — the full new ` +
        `choice list with replacements applied. No prose, no markdown.`,
    );

    // Tolerant extract: prefer fenced ```...``` then raw JSON array.
    const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    const raw = (fenced ? fenced[1] : content).trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Try to recover just the array if there's trailing prose.
      const arrMatch = raw.match(/\[\s*"[\s\S]*?"\s*(?:,\s*"[\s\S]*?"\s*){3}\]/);
      if (!arrMatch) return null;
      try {
        parsed = JSON.parse(arrMatch[0]);
      } catch {
        return null;
      }
    }
    if (!Array.isArray(parsed) || parsed.length !== 4) return null;
    if (!parsed.every((s) => typeof s === 'string' && s.length >= 1)) return null;
    const newChoices = parsed as string[];

    // Belt-and-suspenders: the correct choice must still be at its index,
    // and the un-replaced indices must match originals byte-for-byte. If
    // the model rearranged anything despite instructions, refuse the repair.
    if (newChoices[input.answerIndex] !== correctText) return null;
    for (let i = 0; i < 4; i++) {
      if (input.indicesToReplace.includes(i)) continue;
      if (newChoices[i] !== input.choices[i]) return null;
    }
    // Distinctness check.
    if (new Set(newChoices).size !== 4) return null;

    return { choices: newChoices };
  }
}
