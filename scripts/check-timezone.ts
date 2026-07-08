// Scripted check for app/lib/planner/timezone.ts (no unit-test runner — see
// CLAUDE.md). Covers spec §B:
//   - UTC basic;
//   - America/New_York on an instant where UTC's calendar day differs from NY's
//     (2026-07-07T02:00:00Z = July 6 22:00 in NY → the NY week differs from UTC's);
//   - Asia/Kolkata (half-hour offset);
//   - garbage tz → equals the UTC result (fallback);
//   - a Monday-00:30-in-zone instant maps to that same Monday;
//   - a Sunday-23:30-in-zone instant maps to the PREVIOUS Monday;
//   - the result is always valid ISO (parseable) and <= now.
// Run: pnpm dlx tsx scripts/check-timezone.ts
import { weekStartInTz } from '../app/lib/planner/timezone';

let count = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
  count += 1;
  console.log('  ok —', msg);
}

// A result must always be a parseable ISO instant that is <= the query instant.
function assertValidAndBounded(nowIso: string, result: string, label: string): void {
  const t = Date.parse(result);
  assert(!Number.isNaN(t), `${label}: result is parseable ISO ("${result}")`);
  assert(t <= Date.parse(nowIso), `${label}: result <= now`);
  // ISO round-trips (a valid Date serializes back to the same instant).
  assert(new Date(t).toISOString() === result, `${label}: result is canonical ISO`);
}

// --- 1. UTC basic -----------------------------------------------------------
// 2026-07-07 is a Tuesday. Monday 00:00 UTC of that week = 2026-07-06T00:00:00Z.
console.log('\n[1] UTC basic');
{
  const now = '2026-07-07T12:00:00.000Z';
  const ws = weekStartInTz(now, 'UTC');
  assert(ws === '2026-07-06T00:00:00.000Z', `UTC Tue → Mon 00:00 UTC (got ${ws})`);
  assertValidAndBounded(now, ws, 'UTC basic');

  // A Monday itself (before midnight-week roll) stays on that Monday.
  const mon = '2026-07-06T15:00:00.000Z';
  assert(
    weekStartInTz(mon, 'UTC') === '2026-07-06T00:00:00.000Z',
    'UTC Monday afternoon → same Monday 00:00',
  );
  // A Sunday rolls back to the previous Monday (6 days).
  const sun = '2026-07-12T23:00:00.000Z';
  assert(
    weekStartInTz(sun, 'UTC') === '2026-07-06T00:00:00.000Z',
    'UTC Sunday → previous Monday 00:00',
  );
}

// --- 2. America/New_York: UTC day differs from NY day -----------------------
// 2026-07-07T02:00:00Z is 2026-07-06 22:00 in New York (EDT, UTC-4). So:
//   - in UTC the instant is Tuesday July 7  → UTC week start = Mon July 6.
//   - in NY  the instant is Monday  July 6  → NY  week start = Mon July 6 local,
//     i.e. 2026-07-06T04:00:00Z (Monday 00:00 EDT = 04:00 UTC).
// The two answers differ, which is the whole point of the feature.
console.log('\n[2] America/New_York (UTC calendar day differs)');
{
  const now = '2026-07-07T02:00:00.000Z';
  const nyWs = weekStartInTz(now, 'America/New_York');
  const utcWs = weekStartInTz(now, 'UTC');
  assert(
    nyWs === '2026-07-06T04:00:00.000Z',
    `NY week start = Mon 00:00 EDT = 04:00Z (got ${nyWs})`,
  );
  assert(utcWs === '2026-07-06T00:00:00.000Z', `UTC week start = Mon 00:00Z (got ${utcWs})`);
  assert(nyWs !== utcWs, 'NY and UTC week boundaries DIFFER for this instant');
  assertValidAndBounded(now, nyWs, 'NY differing-day');

  // Sanity: a mid-week NY afternoon lands on this week's Monday 00:00 EDT.
  const wed = '2026-07-08T18:00:00.000Z'; // 14:00 Wed in NY
  assert(
    weekStartInTz(wed, 'America/New_York') === '2026-07-06T04:00:00.000Z',
    'NY Wednesday afternoon → Mon 00:00 EDT (04:00Z)',
  );
}

// --- 3. Asia/Kolkata (half-hour offset, UTC+05:30) --------------------------
// Monday 00:00 IST = the previous Sunday 18:30 UTC. Verify the half-hour offset
// is honored (not rounded to a whole hour).
console.log('\n[3] Asia/Kolkata (half-hour offset)');
{
  const now = '2026-07-07T12:00:00.000Z'; // 17:30 Tue in Kolkata
  const ws = weekStartInTz(now, 'Asia/Kolkata');
  assert(
    ws === '2026-07-05T18:30:00.000Z',
    `Kolkata Mon 00:00 IST = Sun 18:30Z (got ${ws})`,
  );
  assertValidAndBounded(now, ws, 'Kolkata');
  assert(ws.endsWith(':30:00.000Z'), 'Kolkata offset preserves the :30 minute');
}

// --- 4. Garbage tz → equals the UTC result ----------------------------------
console.log('\n[4] garbage tz → UTC fallback');
{
  const now = '2026-07-07T02:00:00.000Z';
  const utcWs = weekStartInTz(now, 'UTC');
  for (const bad of ['Not/A_Zone', 'garbage', 'America/Nowhere', '', '   ']) {
    const ws = weekStartInTz(now, bad);
    assert(ws === utcWs, `bad tz "${bad}" → UTC result (${ws})`);
  }
  // null tz likewise falls back to UTC.
  assert(weekStartInTz(now, null) === utcWs, 'null tz → UTC result');
  assertValidAndBounded(now, weekStartInTz(now, 'garbage'), 'garbage fallback');
}

// --- 5. Monday 00:30 in the zone → that same Monday -------------------------
// Instant is 00:30 Monday LOCAL in New York. Monday 00:30 EDT = 04:30Z. The week
// start is that same Monday's 00:00 EDT = 04:00Z (30 minutes earlier).
console.log('\n[5] Monday 00:30 in zone → that Monday');
{
  const now = '2026-07-06T04:30:00.000Z'; // 00:30 Mon in NY
  const ws = weekStartInTz(now, 'America/New_York');
  assert(
    ws === '2026-07-06T04:00:00.000Z',
    `Monday 00:30 local → same Monday 00:00 local (got ${ws})`,
  );
  assertValidAndBounded(now, ws, 'Monday 00:30');
}

// --- 6. Sunday 23:30 in the zone → the PREVIOUS Monday -----------------------
// Instant is 23:30 Sunday LOCAL in New York = the next day 03:30Z. It must roll
// all the way back to the prior Monday 00:00 EDT (04:00Z), NOT forward.
console.log('\n[6] Sunday 23:30 in zone → previous Monday');
{
  const now = '2026-07-13T03:30:00.000Z'; // 23:30 Sun (July 12) in NY
  const ws = weekStartInTz(now, 'America/New_York');
  assert(
    ws === '2026-07-06T04:00:00.000Z',
    `Sunday 23:30 local → previous Monday 00:00 local (got ${ws})`,
  );
  assertValidAndBounded(now, ws, 'Sunday 23:30');
  assert(Date.parse(ws) < Date.parse(now), 'Sunday-late result strictly before now');
}

// --- 7. DST-safe to the hour ------------------------------------------------
// New York switches EST→EDT on 2026-03-08 (spring forward at 02:00). Pick an
// instant in the week AFTER the switch: the Monday-00:00-local offset is EDT
// (UTC-4). A week straddling standard time uses EST (UTC-5). Verify both.
console.log('\n[7] DST-safe (EST vs EDT week starts)');
{
  // Spring-forward is Sun 2026-03-08 02:00. The week of Mon 2026-03-09 is fully
  // EDT, so Mon 00:00 EDT = 04:00Z (a full hour LESS than the winter offset).
  const edtNow = '2026-03-11T12:00:00.000Z';
  assert(
    weekStartInTz(edtNow, 'America/New_York') === '2026-03-09T04:00:00.000Z',
    'week just after spring-forward: Mon 00:00 EDT (04:00Z)',
  );
  // Week of 2026-02-02 (Mon) — fully in EST. Mon 00:00 EST = 05:00Z.
  const estNow = '2026-02-04T12:00:00.000Z';
  assert(
    weekStartInTz(estNow, 'America/New_York') === '2026-02-02T05:00:00.000Z',
    'winter week: Mon 00:00 EST (05:00Z)',
  );
}

// --- 8. Invalid nowIso is tolerated (contract is a valid ISO, but no throw) --
console.log('\n[8] invalid nowIso does not throw');
{
  let ws = '';
  try {
    ws = weekStartInTz('not-a-date', 'UTC');
  } catch (e) {
    assert(false, `invalid nowIso must not throw (threw: ${String(e)})`);
  }
  assert(!Number.isNaN(Date.parse(ws)), `invalid nowIso still yields parseable ISO ("${ws}")`);
}

console.log(`\nALL CHECKS PASSED (${count} assertions)`);
