import { NextResponse } from 'next/server';
import { createClient } from '@/app/lib/supabase/server';
import { SKILLS } from '@/app/lib/questions';
import { ensureBaseLesson } from '@/app/lib/practice/generation';

// Session-authed POST route: ensure an AI base lesson exists for a skill.
// NOT in middleware PUBLIC_PATHS — the middleware session-gates it, and we
// re-check the session in-route because the generation module performs
// service-role writes.
export const dynamic = 'force-dynamic';
// Ollama generation runs 30–60s; match the generate-questions route budget.
export const maxDuration = 300;

export async function POST(request: Request) {
  // Parse the body defensively — garbage in → 400.
  let skill: unknown;
  try {
    const body = await request.json();
    skill = (body as { skill?: unknown })?.skill;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 });
  }
  if (typeof skill !== 'string' || skill.length === 0) {
    return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 });
  }

  // skill is the real skill NAME (not a slug); it must exist in the taxonomy.
  const section = (['rw', 'math'] as const).find((s) => SKILLS[s].includes(skill));
  if (!section) {
    return NextResponse.json({ ok: false, error: 'unknown_skill' }, { status: 404 });
  }

  const { status } = await ensureBaseLesson(section, skill);
  return NextResponse.json({ ok: true, status });
}
