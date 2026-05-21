import type { AIProvider, SolveInput } from './provider';
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
  ): Promise<GeneratedQuestion[]> {
    const sectionName = section === 'rw' ? 'Reading & Writing' : 'Math';
    // A complete, filled example is far more reliable than an inline
    // `<placeholder>` template — a literal-minded model can echo placeholders.
    const example =
      section === 'rw'
        ? `{"section":"rw","skill":"${skill}","passage":"A short passage giving the context.",` +
          `"prompt":"Which choice best completes the text?","choices":["alpha","beta","gamma","delta"],` +
          `"answerIndex":2,"explanation":"Gamma fits because the passage stresses ..."}`
        : `{"section":"math","skill":"${skill}",` +
          `"prompt":"If 3x + 6 = 18, what is the value of x?","choices":["2","4","6","8"],` +
          `"answerIndex":1,"explanation":"Subtract 6 from both sides, then divide by 3: x = 4."}`;
    const content = await chat(
      `Generate ${count} original Digital SAT ${sectionName} multiple-choice practice questions ` +
        `for the skill "${skill}".\n` +
        `Return ONLY a JSON array of objects — no prose, no markdown fences.\n` +
        `Each object must have exactly these keys: section, skill, ` +
        `${section === 'rw' ? 'passage, ' : ''}prompt, choices, answerIndex, explanation.\n` +
        `- "section" must be "${section}"; "skill" must be "${skill}".\n` +
        `- "choices" must be an array of exactly 4 distinct strings.\n` +
        `- "answerIndex" must be an integer 0-3: the 0-based index of the correct choice.\n` +
        `- "explanation" must be PLAIN TEXT (no HTML, no markdown) saying why the answer is correct.\n` +
        (section === 'rw'
          ? `- "passage" must be a short text giving the context the question needs.\n`
          : `- Omit "passage" entirely unless the problem genuinely needs a setup.\n`) +
        `Example of one valid array element:\n${example}`,
    );
    const parsed = extractJson(content);
    if (!Array.isArray(parsed)) {
      throw new Error('Ollama generateQuestions: expected a JSON array');
    }
    return parsed as GeneratedQuestion[]; // shape validated downstream by zod
  }

  async solve(q: SolveInput): Promise<number> {
    const content = await chat(
      `Solve this Digital SAT question. Respond with ONLY the 0-based index ` +
        `(0, 1, 2, or 3) of the correct choice — a single digit, nothing else.\n` +
        (q.passage ? `Passage: ${q.passage}\n` : '') +
        `Question: ${q.prompt}\n` +
        q.choices.map((c, i) => `${i}: ${c}`).join('\n'),
    );
    const trimmed = content.trim();
    // The model was asked for a bare digit; accept that first, otherwise the
    // first standalone 0-3 digit anywhere in the response.
    const m = trimmed.match(/^[0-3]$/) ?? trimmed.match(/\b[0-3]\b/);
    if (!m) throw new Error(`Ollama solve: no index in response: ${trimmed.slice(0, 80)}`);
    return Number.parseInt(m[0], 10);
  }
}
