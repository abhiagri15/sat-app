import { NextResponse } from 'next/server';
import { createClient } from '@/app/lib/supabase/server';
import { SKILLS } from '@/app/lib/questions';
import { topupSkill } from '@/app/lib/practice/generation';

// Session-authed POST route: post-drill targeted question top-up for a skill.
// Fired fire-and-forget by the client after a drill save (keepalive). NOT in
// middleware PUBLIC_PATHS — session-gated + re-checked in-route (the generation
// module performs service-role writes).
export const dynamic = 'force-dynamic';
// The batch generation runs the full quality gate (several Ollama calls); match
// the generate-questions route budget.
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

  const section = (['rw', 'math'] as const).find((s) => SKILLS[s].includes(skill));
  if (!section) {
    return NextResponse.json({ ok: false, error: 'unknown_skill' }, { status: 404 });
  }

  // Unseen count via the security-definer RPC (keyed on auth.uid()), called
  // through the USER's client.
  const unseenRes = await supabase
    .schema('sat')
    .rpc('unseen_count_for_skill', { p_skill: skill });
  if (unseenRes.error) {
    console.error('[practice] topup unseen_count_for_skill failed:', unseenRes.error);
    return NextResponse.json({ ok: false, error: 'internal' }, { status: 500 });
  }
  const unseenCount = Number(unseenRes.data ?? 0);

  const result = await topupSkill(user.id, section, skill, unseenCount);
  if (result.status === 'failed') {
    return NextResponse.json({ ok: false, status: 'failed' }, { status: 502 });
  }
  if (result.status === 'generated') {
    return NextResponse.json({ ok: true, status: result.status, inserted: result.inserted });
  }
  return NextResponse.json({ ok: true, status: result.status });
}
