/* Live smoke: prove sat.save_attempt v3 recomputes correctness SERVER-SIDE and
 * ignores a lying client. Run:
 *   pnpm dlx tsx scripts/smoke-lying-save.ts
 * (loads .env.local itself; needs the service-role key + anon key)
 *
 * How it works: signs in as the dedicated E2E account (sat-e2e@example.com —
 * created if missing, same as e2e/global-setup / smoke-live-rpcs), builds a
 * payload of REAL wire shape over REAL mcq question rows fetched from
 * sat.questions (so the server's mcq join hits) where EVERY response is
 * objectively WRONG (the picked choice text != the question's canonical text)
 * but the client-claimed aggregates LIE: sectionBreakdown[].correct = total,
 * totalCorrect maxed, scaledScore 1600, every response isCorrect:true. It calls
 * the sat.save_attempt RPC as the signed-in user, reads the attempt back, and
 * asserts the STORED total_correct / per-section correct / scaled_score reflect
 * the TRUTH (0 correct → 200 + 200 = 400 floor), and that every stored response
 * row has is_correct = false.
 *
 * Then it saves a second, HONEST mini-payload (the picked choice IS the correct
 * one) and asserts the stored aggregates round-trip correctly (all correct,
 * scaled 400..1600).
 *
 * Self-cleaning like smoke-explain-cache.ts: both attempts are deleted via the
 * service-role client on BOTH the success and failure paths (which also restores
 * the daily-attempt-limit slots). Exit 0/1.
 *
 * NOTE: this smoke FAILS until the 20260708000000_sat_score_truth.sql migration
 * is applied live (the current deployed body trusts the client section counts).
 * That is expected — the orchestrator applies the migration, then runs this.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { loadEnvLocal, requireEnv, E2E_EMAIL, e2ePassword } from '../e2e/support/env';
import { adminClient, findTestUserId } from '../e2e/support/cleanup';

// Minimal shape of a sat.questions row we care about.
interface QuestionRow {
  id: string;
  section: 'rw' | 'math';
  skill: string;
  passage: string | null;
  prompt: string;
  choices: string[];
  answer_index: number;
  explanation: string;
  source: 'seed' | 'ai';
}

// Build one attempt_responses wire item over a real mcq question.
// `honest = false` → pick a WRONG choice but the item still claims isCorrect:true.
// `honest = true`  → pick the correct choice (a legitimate all-correct save).
function makeResponse(
  q: QuestionRow,
  sectionKey: 'rw' | 'math',
  sectionName: string,
  position: number,
  honest: boolean,
) {
  const correctIdx = q.answer_index;
  const chosenIndex = honest
    ? correctIdx
    : (correctIdx + 1) % q.choices.length; // a different slot => different text
  return {
    sectionKey,
    sectionName,
    position,
    questionId: q.id,
    skill: q.skill,
    source: q.source,
    passage: q.passage,
    prompt: q.prompt,
    // The as-presented choices (server compares canonical text vs the text at
    // chosenIndex — the shuffle is irrelevant, so we send the stored order).
    choices: q.choices,
    answerIndex: correctIdx,
    explanation: q.explanation,
    responseFormat: 'mcq' as const,
    chosenIndex,
    enteredValue: null,
    correctAnswer: null,
    answerTolerance: null,
    // Always claim correct. For honest=true it is genuinely correct; for
    // honest=false it is the LIE the server must ignore (picked text is wrong).
    isCorrect: true,
    moduleIndex: null,
    timeMs: null,
    figure: null,
  };
}

async function fetchMcqQuestions(
  admin: SupabaseClient,
  section: 'rw' | 'math',
  n: number,
): Promise<QuestionRow[]> {
  const { data, error } = await admin
    .schema('sat')
    .from('questions')
    .select('id, section, skill, passage, prompt, choices, answer_index, explanation, source')
    .eq('section', section)
    .eq('enabled', true)
    .eq('response_format', 'mcq')
    .limit(50);
  if (error) throw new Error(`fetch ${section} questions failed: ${error.message}`);
  const rows = (data ?? []) as unknown as QuestionRow[];
  // Keep only rows whose "wrong" pick is genuinely a different text than the
  // canonical (guards the rare duplicate-choice-text question).
  const usable = rows.filter((q) => {
    if (!Array.isArray(q.choices) || q.choices.length < 2) return false;
    const correct = String(q.choices[q.answer_index]).trim();
    const wrong = String(q.choices[(q.answer_index + 1) % q.choices.length]).trim();
    return correct !== wrong;
  });
  if (usable.length < n) {
    throw new Error(
      `need ${n} usable mcq ${section} questions, found ${usable.length} (seed the pool?)`,
    );
  }
  return usable.slice(0, n);
}

async function deleteAttempt(admin: SupabaseClient, attemptId: string): Promise<void> {
  // attempt_responses cascade on the FK; delete the parent by id + user scope
  // is unnecessary (id is a uuid pk), but keep it tight.
  const { error } = await admin
    .schema('sat')
    .from('test_attempts')
    .delete()
    .eq('id', attemptId);
  if (error) throw new Error(`delete attempt ${attemptId} failed: ${error.message}`);
}

async function main(): Promise<boolean> {
  loadEnvLocal();
  const { url } = requireEnv();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anonKey) throw new Error('needs NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local');

  const admin = adminClient();

  // Ensure + sign in as the dedicated E2E account (mirrors smoke-live-rpcs).
  let userId = await findTestUserId(admin);
  if (!userId) {
    const { data, error } = await admin.auth.admin.createUser({
      email: E2E_EMAIL,
      password: e2ePassword(),
      email_confirm: true,
    });
    if (error) throw new Error(`could not create E2E user: ${error.message}`);
    userId = data.user.id;
  }

  const user = createClient(url, anonKey, { auth: { persistSession: false } });
  const signIn = await user.auth.signInWithPassword({
    email: E2E_EMAIL,
    password: e2ePassword(),
  });
  if (signIn.error) throw new Error(`E2E sign-in failed: ${signIn.error.message}`);

  const saveAttempt = async (attempt: unknown, responses: unknown): Promise<string> => {
    const { data, error } = await user
      .schema('sat')
      .rpc('save_attempt', { p_attempt: attempt, p_responses: responses });
    if (error) throw new Error(`save_attempt: ${error.code ?? ''} ${error.message}`);
    return data as string;
  };

  const readBack = async (attemptId: string) => {
    const { data: attempt, error: aErr } = await user
      .schema('sat')
      .from('test_attempts')
      .select('total_correct, total_questions, scaled_score, section_breakdown')
      .eq('id', attemptId)
      .single();
    if (aErr) throw new Error(`readback attempt failed: ${aErr.message}`);
    const { data: rows, error: rErr } = await user
      .schema('sat')
      .from('attempt_responses')
      .select('is_correct, section_key')
      .eq('attempt_id', attemptId);
    if (rErr) throw new Error(`readback responses failed: ${rErr.message}`);
    return { attempt, rows: rows ?? [] };
  };

  const createdAttempts: string[] = [];
  let failures = 0;
  const check = (cond: unknown, label: string): void => {
    if (cond) {
      console.log(`ok   ${label}`);
    } else {
      failures += 1;
      console.error(`FAIL ${label}`);
    }
  };

  try {
    // Fetch real questions: 3 R&W + 3 Math, all mcq.
    const rw = await fetchMcqQuestions(admin, 'rw', 3);
    const math = await fetchMcqQuestions(admin, 'math', 3);

    // ---- 1) LYING payload: every response WRONG, aggregates claim perfect. ----
    const lyingResponses = [
      ...rw.map((q, i) => makeResponse(q, 'rw', 'Reading & Writing', i, false)),
      ...math.map((q, i) => makeResponse(q, 'math', 'Math', i, false)),
    ];
    const lyingAttempt = {
      studentName: 'Lying Client',
      testLength: 'short',
      // All lies below — server must ignore them.
      totalCorrect: lyingResponses.length,
      totalQuestions: lyingResponses.length,
      scaledScore: 1600,
      breaksUsed: false,
      attemptUuid: randomUUID(),
      sectionBreakdown: [
        { name: 'Reading & Writing', sectionKey: 'rw', correct: rw.length, total: rw.length, module2Path: null },
        { name: 'Math', sectionKey: 'math', correct: math.length, total: math.length, module2Path: null },
      ],
      responses: lyingResponses,
    };

    const lyingId = await saveAttempt(lyingAttempt, lyingResponses);
    createdAttempts.push(lyingId);
    const lying = await readBack(lyingId);

    check(lying.attempt.total_correct === 0, `lying: stored total_correct === 0 (got ${lying.attempt.total_correct})`);
    check(
      lying.attempt.total_questions === lyingResponses.length,
      `lying: stored total_questions === ${lyingResponses.length} (got ${lying.attempt.total_questions})`,
    );
    // 0 correct short test → RW_CURVE[0]=200 + MATH_CURVE[0]=200 = 400 (floor).
    check(lying.attempt.scaled_score === 400, `lying: stored scaled_score === 400 floor (got ${lying.attempt.scaled_score})`);
    const bd = lying.attempt.section_breakdown as { sectionKey: string; correct: number; scaled: number }[];
    const rwBd = bd.find((b) => b.sectionKey === 'rw');
    const mathBd = bd.find((b) => b.sectionKey === 'math');
    check(rwBd?.correct === 0 && rwBd?.scaled === 200, `lying: rw breakdown correct=0 scaled=200 (got ${JSON.stringify(rwBd)})`);
    check(mathBd?.correct === 0 && mathBd?.scaled === 200, `lying: math breakdown correct=0 scaled=200 (got ${JSON.stringify(mathBd)})`);
    check(
      lying.rows.length === lyingResponses.length && lying.rows.every((r) => r.is_correct === false),
      `lying: every stored response row is_correct === false (${lying.rows.length} rows)`,
    );

    // ---- 2) HONEST mini-payload: 2 correct mcq, must round-trip correctly. ----
    const honestQs = [rw[0], math[0]];
    const honestResponses = [
      makeResponse(honestQs[0], 'rw', 'Reading & Writing', 0, true),
      makeResponse(honestQs[1], 'math', 'Math', 1, true),
    ];
    const honestAttempt = {
      studentName: 'Honest Client',
      testLength: 'short',
      totalCorrect: 2,
      totalQuestions: 2,
      scaledScore: 400, // even honest scaledScore is ignored; server recomputes
      breaksUsed: false,
      attemptUuid: randomUUID(),
      sectionBreakdown: [
        { name: 'Reading & Writing', sectionKey: 'rw', correct: 1, total: 1, module2Path: null },
        { name: 'Math', sectionKey: 'math', correct: 1, total: 1, module2Path: null },
      ],
      responses: honestResponses,
    };

    const honestId = await saveAttempt(honestAttempt, honestResponses);
    createdAttempts.push(honestId);
    const honest = await readBack(honestId);

    check(honest.attempt.total_correct === 2, `honest: stored total_correct === 2 (got ${honest.attempt.total_correct})`);
    check(honest.attempt.total_questions === 2, `honest: stored total_questions === 2 (got ${honest.attempt.total_questions})`);
    check(
      honest.rows.length === 2 && honest.rows.every((r) => r.is_correct === true),
      `honest: every stored response row is_correct === true (${honest.rows.length} rows)`,
    );
    // 1/1 short → projects to full → 800 per section → 1600 composite.
    check(
      honest.attempt.scaled_score >= 400 && honest.attempt.scaled_score <= 1600,
      `honest: stored scaled_score in [400,1600] (got ${honest.attempt.scaled_score})`,
    );
  } finally {
    // Self-cleaning: delete both attempts (restores daily-limit slots) on BOTH
    // the success and failure paths.
    for (const id of createdAttempts) {
      try {
        await deleteAttempt(admin, id);
      } catch (err) {
        console.error(`cleanup: ${String(err instanceof Error ? err.message : err)}`);
        failures += 1;
      }
    }
  }

  console.log(
    failures === 0
      ? '\nlying-client smoke passed — server recomputed correctness, ignored the lie'
      : `\n${failures} assertion(s)/cleanup step(s) FAILED`,
  );
  return failures === 0;
}

main().then(
  (ok) => process.exit(ok ? 0 : 1),
  (err) => {
    console.error(String(err instanceof Error ? err.message : err));
    process.exit(1);
  },
);
