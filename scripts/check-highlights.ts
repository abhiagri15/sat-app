// Scripted check for the passage-highlight interval helpers (no unit-test
// runner — see CLAUDE.md). Covers spec §A:
//   - overlapping adds merge; adjacent ([2,5)+[5,9)) merge; containment;
//     out-of-bounds clamp; removeAt hits the whole merged run;
//   - segmentText round-trips (concatenated segments === original) and
//     alternates correctly; empty-intervals passthrough;
//   - notes (spec §C): merge keeps the FIRST non-empty note (both orders),
//     setNoteAt set/clear/no-op-outside, segment note passthrough.
// Run: pnpm dlx tsx scripts/check-highlights.ts
import {
  mergeIntervals,
  addInterval,
  removeIntervalAt,
  segmentText,
  setNoteAt,
  type Interval,
} from '../app/lib/highlights';

let count = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
  count += 1;
  console.log('  ok —', msg);
}

function eqIntervals(a: Interval[], b: Interval[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((iv, i) => iv.start === b[i].start && iv.end === b[i].end);
}

// --- mergeIntervals ---------------------------------------------------------

// Overlapping intervals merge into one.
assert(
  eqIntervals(
    mergeIntervals([{ start: 2, end: 6 }, { start: 4, end: 9 }]),
    [{ start: 2, end: 9 }],
  ),
  'overlapping [2,6)+[4,9) merge to [2,9)',
);

// Adjacent (touching) intervals merge — [2,5) end === [5,9) start.
assert(
  eqIntervals(
    mergeIntervals([{ start: 2, end: 5 }, { start: 5, end: 9 }]),
    [{ start: 2, end: 9 }],
  ),
  'adjacent [2,5)+[5,9) merge to [2,9)',
);

// A one-character GAP does NOT merge — [2,5) and [6,9) stay separate.
assert(
  eqIntervals(
    mergeIntervals([{ start: 6, end: 9 }, { start: 2, end: 5 }]),
    [{ start: 2, end: 5 }, { start: 6, end: 9 }],
  ),
  'gapped [2,5) and [6,9) stay separate (and sort ascending)',
);

// Containment — a wholly-contained interval is absorbed.
assert(
  eqIntervals(
    mergeIntervals([{ start: 0, end: 10 }, { start: 3, end: 5 }]),
    [{ start: 0, end: 10 }],
  ),
  'containment: [3,5) inside [0,10) collapses to [0,10)',
);

// Degenerate (empty / reversed) intervals are dropped.
assert(
  eqIntervals(
    mergeIntervals([{ start: 4, end: 4 }, { start: 5, end: 3 }, { start: 1, end: 2 }]),
    [{ start: 1, end: 2 }],
  ),
  'empty and reversed intervals are dropped',
);

// --- addInterval (adds + merges + clamps) -----------------------------------

// Overlapping add merges with the existing set.
assert(
  eqIntervals(
    addInterval([{ start: 0, end: 4 }], { start: 3, end: 8 }, 20),
    [{ start: 0, end: 8 }],
  ),
  'addInterval overlapping [3,8) onto [0,4) -> [0,8)',
);

// Out-of-bounds add clamps to [0, textLength].
assert(
  eqIntervals(
    addInterval([], { start: -5, end: 100 }, 12),
    [{ start: 0, end: 12 }],
  ),
  'addInterval clamps [-5,100) to [0,12) when textLength=12',
);

// Partially out-of-bounds add clamps only the overflowing end.
assert(
  eqIntervals(
    addInterval([], { start: 8, end: 999 }, 12),
    [{ start: 8, end: 12 }],
  ),
  'addInterval clamps [8,999) to [8,12)',
);

// Fully out-of-bounds add is a no-op (existing set re-merged).
assert(
  eqIntervals(
    addInterval([{ start: 2, end: 5 }], { start: 30, end: 40 }, 12),
    [{ start: 2, end: 5 }],
  ),
  'addInterval fully-out-of-bounds add is a no-op',
);

// --- removeIntervalAt -------------------------------------------------------

// removeAt on a position inside the MERGED whole removes the whole run.
{
  // Two adds that merge into [2,9); clicking at pos 6 removes all of it.
  const merged = addInterval([{ start: 2, end: 5 }], { start: 5, end: 9 }, 20);
  assert(
    eqIntervals(removeIntervalAt(merged, 6), []),
    'removeIntervalAt(pos inside merged [2,9)) removes the whole merged run',
  );
  // Clicking the exclusive end offset (9) removes nothing.
  assert(
    eqIntervals(removeIntervalAt(merged, 9), [{ start: 2, end: 9 }]),
    'removeIntervalAt at the exclusive end (9) is a no-op',
  );
  // Clicking the inclusive start offset (2) hits it.
  assert(
    eqIntervals(removeIntervalAt(merged, 2), []),
    'removeIntervalAt at the inclusive start (2) removes it',
  );
}

// removeAt only removes the run that contains pos — others survive.
assert(
  eqIntervals(
    removeIntervalAt([{ start: 0, end: 3 }, { start: 6, end: 9 }], 7),
    [{ start: 0, end: 3 }],
  ),
  'removeIntervalAt removes only the containing run, others survive',
);

// --- segmentText ------------------------------------------------------------

const TEXT = 'The quick brown fox';

// Round-trip: concatenated segment text === original, always.
function assertRoundTrip(text: string, intervals: Interval[], label: string): void {
  const segs = segmentText(text, intervals);
  assert(
    segs.map((s) => s.text).join('') === text,
    `segmentText round-trips (${label})`,
  );
  // Alternation: no two consecutive segments share a `highlighted` value.
  const alternates = segs.every(
    (s, i) => i === 0 || s.highlighted !== segs[i - 1].highlighted,
  );
  assert(alternates, `segmentText alternates (${label})`);
}

assertRoundTrip(TEXT, [{ start: 4, end: 9 }], 'single mid highlight');
assertRoundTrip(TEXT, [{ start: 0, end: 3 }, { start: 10, end: 15 }], 'two highlights');
assertRoundTrip(TEXT, [{ start: 0, end: TEXT.length }], 'whole-text highlight');
assertRoundTrip(TEXT, [], 'no highlights');

// Explicit shape for a known case: "The " plain, "quick" highlighted, rest plain.
{
  const segs = segmentText(TEXT, [{ start: 4, end: 9 }]);
  assert(segs.length === 3, 'segmentText mid highlight yields 3 segments');
  assert(segs[0].text === 'The ' && !segs[0].highlighted, 'segment 0 = "The " plain');
  assert(segs[1].text === 'quick' && segs[1].highlighted, 'segment 1 = "quick" highlighted');
  assert(segs[2].text === ' brown fox' && !segs[2].highlighted, 'segment 2 = " brown fox" plain');
}

// Empty-intervals passthrough: one un-highlighted segment for the whole text.
{
  const segs = segmentText(TEXT, []);
  assert(segs.length === 1, 'empty intervals -> single segment');
  assert(segs[0].text === TEXT && !segs[0].highlighted, 'single segment is the whole plain text');
}

// A highlight touching the very start renders no leading empty plain segment.
{
  const segs = segmentText(TEXT, [{ start: 0, end: 3 }]);
  assert(segs[0].highlighted && segs[0].text === 'The', 'leading highlight has no empty plain prefix');
}

// Empty text yields no segments (and still "round-trips" to '').
{
  const segs = segmentText('', [{ start: 0, end: 5 }]);
  assert(segs.length === 0, 'empty text yields zero segments');
  assert(segs.map((s) => s.text).join('') === '', 'empty text round-trips to ""');
}

// --- notes on highlights (spec §C) -----------------------------------------

// A note-aware interval equality (start/end/note all match).
function eqNoted(a: Interval[], b: Interval[]): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (iv, i) =>
      iv.start === b[i].start &&
      iv.end === b[i].end &&
      (iv.note ?? undefined) === (b[i].note ?? undefined),
  );
}

// mergeIntervals keeps the FIRST non-empty note when two intervals merge —
// earlier-note interval given first in the input.
assert(
  eqNoted(
    mergeIntervals([
      { start: 2, end: 5, note: 'alpha' },
      { start: 5, end: 9, note: 'beta' },
    ]),
    [{ start: 2, end: 9, note: 'alpha' }],
  ),
  'merge keeps first non-empty note (earlier note listed first) -> "alpha"',
);

// Same pair in the OTHER input order — "first" is by canonical sort (ascending
// start), so [2,5)'s note still wins even though [5,9) was listed first.
assert(
  eqNoted(
    mergeIntervals([
      { start: 5, end: 9, note: 'beta' },
      { start: 2, end: 5, note: 'alpha' },
    ]),
    [{ start: 2, end: 9, note: 'alpha' }],
  ),
  'merge keeps first non-empty note by sort order (reversed input) -> "alpha"',
);

// If the earlier interval has NO note, the later interval's note is adopted.
assert(
  eqNoted(
    mergeIntervals([
      { start: 2, end: 5 },
      { start: 5, end: 9, note: 'beta' },
    ]),
    [{ start: 2, end: 9, note: 'beta' }],
  ),
  'merge adopts later note when the first-sorted interval has none -> "beta"',
);

// A non-merging pair keeps each interval's own note.
assert(
  eqNoted(
    mergeIntervals([
      { start: 2, end: 5, note: 'a' },
      { start: 7, end: 9, note: 'b' },
    ]),
    [{ start: 2, end: 5, note: 'a' }, { start: 7, end: 9, note: 'b' }],
  ),
  'gapped intervals each keep their own note',
);

// setNoteAt sets the note on the interval containing pos.
assert(
  eqNoted(
    setNoteAt([{ start: 2, end: 9 }], 6, 'my note'),
    [{ start: 2, end: 9, note: 'my note' }],
  ),
  'setNoteAt sets the note on the interval containing pos',
);

// setNoteAt with an empty string CLEARS the note.
assert(
  eqNoted(
    setNoteAt([{ start: 2, end: 9, note: 'old' }], 6, ''),
    [{ start: 2, end: 9 }],
  ),
  'setNoteAt with empty string clears the note',
);

// setNoteAt overwrites an existing note.
assert(
  eqNoted(
    setNoteAt([{ start: 2, end: 9, note: 'old' }], 2, 'new'),
    [{ start: 2, end: 9, note: 'new' }],
  ),
  'setNoteAt overwrites an existing note (inclusive start hits)',
);

// setNoteAt is a no-op when pos is outside every interval — others untouched.
assert(
  eqNoted(
    setNoteAt([{ start: 2, end: 5, note: 'x' }, { start: 6, end: 9 }], 5, 'nope'),
    [{ start: 2, end: 5, note: 'x' }, { start: 6, end: 9 }],
  ),
  'setNoteAt at the exclusive end (5, outside both) is a no-op',
);

// setNoteAt only touches the containing run; sibling intervals keep their notes.
assert(
  eqNoted(
    setNoteAt([{ start: 0, end: 3, note: 'keep' }, { start: 6, end: 9 }], 7, 'here'),
    [{ start: 0, end: 3, note: 'keep' }, { start: 6, end: 9, note: 'here' }],
  ),
  'setNoteAt sets only the containing run, siblings keep their notes',
);

// segmentText passes the note through onto the highlighted segment.
{
  const segs = segmentText(TEXT, [{ start: 4, end: 9, note: 'quick note' }]);
  assert(segs.length === 3, 'noted segment: still 3 segments');
  assert(
    segs[1].highlighted && segs[1].note === 'quick note',
    'segmentText passes the note onto the highlighted segment',
  );
  assert(
    segs[0].note === undefined && segs[2].note === undefined,
    'plain segments carry no note',
  );
}

console.log(`\ncheck-highlights: ${count} assertions passed`);
