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
  ): Promise<GeneratedQuestion[]> {
    // SPR is Math-only by spec; defensively force back to mcq if the caller
    // requested spr for an R&W skill.
    const effectiveSpr = useSpr && section === 'math';
    if (effectiveSpr) {
      return this.generateSprBatch(skill, count);
    }
    return this.generateMcqBatch(section, skill, count);
  }

  // Existing multiple-choice generation. Returns an array of `responseFormat:
  // 'mcq'` candidates — the discriminator is injected here so callers do not
  // have to special-case it before zod validation.
  private async generateMcqBatch(
    section: 'rw' | 'math',
    skill: string,
    count: number,
  ): Promise<GeneratedQuestion[]> {
    const sectionName = section === 'rw' ? 'Reading & Writing' : 'Math';
    const example =
      section === 'rw'
        ? `{"responseFormat":"mcq","section":"rw","skill":"${skill}","passage":"Although critics initially called the design ______, recent reviews praise its bold use of color.",` +
          `"prompt":"Which choice best completes the text?","choices":["uninspired","captivating","traditional","minimal"],` +
          `"answerIndex":0,"explanation":"The contrast \\"Although ... recent reviews praise\\" signals the initial reaction was negative; uninspired fits."}`
        : `{"responseFormat":"mcq","section":"math","skill":"${skill}",` +
          `"prompt":"If 3x + 6 = 18, what is the value of x?","choices":["2","4","6","8"],` +
          `"answerIndex":1,"explanation":"Subtract 6 from both sides, then divide by 3: x = 4."}`;
    const content = await chat(
      `Generate ${count} original Digital SAT ${sectionName} multiple-choice practice questions ` +
        `for the skill "${skill}".\n` +
        `Return ONLY a JSON array of objects — no prose, no markdown fences.\n` +
        `Each object must have exactly these keys: responseFormat, section, skill, ` +
        `${section === 'rw' ? 'passage, ' : ''}prompt, choices, answerIndex, explanation.\n` +
        `- "responseFormat" must be "mcq".\n` +
        `- "section" must be "${section}"; "skill" must be "${skill}".\n` +
        `- "choices" must be an array of exactly 4 distinct strings.\n` +
        `- "answerIndex" must be an integer 0-3: the 0-based index of the correct choice.\n` +
        `- "explanation" must be PLAIN TEXT (no HTML, no markdown) saying why the answer is correct.\n` +
        `- IMPORTANT: in "explanation", NEVER refer to a choice by its letter or number (no "Choice A", "Option B", "choice 3", etc.). The app shuffles choices per test, so any letter/number reference becomes wrong at runtime. Refer to the chosen option as "the correct choice" or by quoting its content; refer to incorrect ones as "the other choices" / "the option that says X".\n` +
        (section === 'rw'
          ? `- "passage" must be a short text giving the context the question needs.\n` +
            `- If the question requires choosing a word, phrase, verb form, or punctuation mark to INSERT into the passage (sentence completion / cloze), the passage MUST contain exactly one blank marked with six underscores ("______") at the insertion point. Do NOT embed the chosen answer in the passage. For reading-comprehension questions (e.g., main idea, evidence support, transition between sentences as a whole), the passage is a complete text and MUST NOT contain "______".\n`
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
        ? { ...q, responseFormat: 'mcq' }
        : q,
    ) as GeneratedQuestion[];
  }

  // Student-Produced Response generation — Math-only. The model is asked for
  // a typed numeric answer (not a 0-3 index) and the canonical answer is what
  // we store in sat.questions.correct_answer.
  private async generateSprBatch(
    skill: string,
    count: number,
  ): Promise<GeneratedQuestion[]> {
    const example =
      `{"responseFormat":"spr","section":"math","skill":"${skill}",` +
      `"prompt":"If 2x + 5 = 17, what is the value of x?",` +
      `"correctAnswer":"6","explanation":"Subtract 5: 2x = 12. Divide by 2: x = 6."}`;
    const content = await chat(
      `Generate ${count} original Digital SAT Math student-produced-response (SPR / grid-in) ` +
        `practice questions for the skill "${skill}".\n` +
        `Return ONLY a JSON array of objects — no prose, no markdown fences.\n` +
        `Each object must have exactly these keys: responseFormat, section, skill, prompt, ` +
        `correctAnswer, explanation. Optionally include answerTolerance.\n` +
        `- "responseFormat" must be "spr".\n` +
        `- "section" must be "math"; "skill" must be "${skill}".\n` +
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
        ? { ...q, responseFormat: 'spr', section: 'math' }
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
}
