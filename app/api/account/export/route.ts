// app/api/account/export/route.ts
//
// GET → a downloadable JSON export of the signed-in user's own data.
//
// SESSION-GATED (NOT in middleware.ts PUBLIC_PATHS): the session cookie gates
// the route, and we re-check the session in-route. Reads run through the USER's
// Supabase client, so RLS confines every row to the caller — no service-role
// client is used or needed here (this is a read-only, self-scoped export).
import { NextResponse } from 'next/server';
import { createClient } from '@/app/lib/supabase/server';

export async function GET() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const sat = supabase.schema('sat');

  // All reads are RLS-scoped to the caller. Study plan is at most one row.
  const [profileRes, attemptsRes, attemptResponsesRes, sessionsRes, sessionResponsesRes, planRes] =
    await Promise.all([
      sat.from('profiles').select('full_name, email').maybeSingle(),
      sat
        .from('test_attempts')
        .select(
          'id, created_at, student_name, test_length, total_correct, total_questions, scaled_score, section_breakdown, breaks_used',
        )
        .order('created_at', { ascending: false }),
      sat
        .from('attempt_responses')
        .select(
          'attempt_id, position, section_key, section_name, module_index, question_id, skill, prompt, response_format, chosen_index, entered_value, is_correct, time_ms, miss_reason',
        )
        .order('position', { ascending: true }),
      sat
        .from('practice_sessions')
        .select('id, created_at, skill, total, correct')
        .order('created_at', { ascending: false }),
      sat
        .from('practice_responses')
        .select(
          'session_id, position, question_id, skill, response_format, chosen_index, entered_value, is_correct, time_ms, miss_reason',
        )
        .order('position', { ascending: true }),
      sat
        .from('study_plans')
        .select('target_score, test_date, sessions_per_week, timezone')
        .maybeSingle(),
    ]);

  // Group response rows under their parent so the export is self-contained and
  // easy to read. A failed sub-read degrades to an empty list rather than
  // failing the whole export.
  const attemptResponses = (attemptResponsesRes.data ?? []) as { attempt_id: string }[];
  const sessionResponses = (sessionResponsesRes.data ?? []) as { session_id: string }[];

  const responsesByAttempt = new Map<string, unknown[]>();
  for (const r of attemptResponses) {
    const list = responsesByAttempt.get(r.attempt_id) ?? [];
    list.push(r);
    responsesByAttempt.set(r.attempt_id, list);
  }
  const responsesBySession = new Map<string, unknown[]>();
  for (const r of sessionResponses) {
    const list = responsesBySession.get(r.session_id) ?? [];
    list.push(r);
    responsesBySession.set(r.session_id, list);
  }

  const testAttempts = ((attemptsRes.data ?? []) as { id: string }[]).map((a) => ({
    ...a,
    responses: responsesByAttempt.get(a.id) ?? [],
  }));
  const practiceSessions = ((sessionsRes.data ?? []) as { id: string }[]).map((s) => ({
    ...s,
    responses: responsesBySession.get(s.id) ?? [],
  }));

  const profile = (profileRes.data ?? null) as { full_name: string | null; email: string | null } | null;

  const payload = {
    exportedAt: new Date().toISOString(),
    profile: {
      name: profile?.full_name ?? null,
      email: profile?.email ?? user.email ?? null,
    },
    testAttempts,
    practiceSessions,
    studyPlan: planRes.data ?? null,
  };

  const filename = `sat-practice-data-${new Date().toISOString().slice(0, 10)}.json`;

  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
