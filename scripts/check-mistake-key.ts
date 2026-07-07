// Scripted check for mistakeKey — the explanation-cache key normalization
// (design spec §C, app/lib/ai/explanation-schema.ts). No unit-test runner — see
// CLAUDE.md. Three jobs:
//   1. SHUFFLE-INVARIANCE: the same chosen mcq TEXT keys the same regardless of
//      case / surrounding & internal whitespace (the per-test choice shuffle
//      moves the wrong choice around, but the cache must still hit).
//   2. SPR EQUIVALENCE: "3.5" and "7/2" (and "3.50", "07/2") canonicalize to one
//      key; a non-parseable entry keys on its own trimmed literal.
//   3. CROSS-QUESTION SEPARATION is deliberately NOT mistakeKey's job — it is
//      the table PK's (question_id, chosen_key). Two different questions with
//      the same wrong-answer text produce the SAME chosen_key here (asserted
//      below) and are kept apart ONLY by question_id in the composite PK. This
//      fixture documents that contract so nobody "fixes" mistakeKey to fold the
//      question id in.
// Run: pnpm dlx tsx scripts/check-mistake-key.ts
import { mistakeKey } from '../app/lib/ai/explanation-schema';

let count = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
  count += 1;
  console.log('  ok —', msg);
}

// --- 1. mcq shuffle-invariance ---------------------------------------------
// enteredValue is irrelevant for mcq — pass '' as the caller would.
const a = mistakeKey('mcq', 'The author is skeptical', '');
assert(a === 'mcq:the author is skeptical', 'mcq key is lowercased + prefixed');

assert(
  mistakeKey('mcq', '  The Author   is  Skeptical ', '') === a,
  'mcq key is invariant to case, leading/trailing, and collapsed internal whitespace',
);
assert(
  mistakeKey('mcq', 'THE AUTHOR IS SKEPTICAL', '') === a,
  'mcq key is invariant to a fully upper-cased choice',
);
assert(
  mistakeKey('mcq', 'The author\tis\nskeptical', '') === a,
  'mcq key collapses tabs/newlines to single spaces',
);

// A genuinely different choice keys differently.
assert(
  mistakeKey('mcq', 'The author is enthusiastic', '') !== a,
  'a different mcq choice text yields a different key',
);

// --- 2. spr equivalence -----------------------------------------------------
// chosenText is irrelevant for spr — pass '' as the caller would.
const half = mistakeKey('spr', '', '3.5');
assert(half === 'spr:3.5', 'spr canonicalizes a decimal ("3.5") to its numeric value');
assert(
  mistakeKey('spr', '', '7/2') === half,
  'spr "7/2" ≡ "3.5" (fraction canonicalizes to the same numeric value)',
);
assert(
  mistakeKey('spr', '', '  3.50 ') === half,
  'spr "3.50" (padded) canonicalizes to the same key',
);
assert(
  mistakeKey('spr', '', '07/2') === half,
  'spr "07/2" canonicalizes to the same numeric value',
);

// Integer canonical.
assert(mistakeKey('spr', '', '5') === 'spr:5', 'spr integer canonicalizes to "5"');
assert(
  mistakeKey('spr', '', '5.0') === 'spr:5',
  'spr "5.0" canonicalizes to the integer value "5"',
);

// A non-parseable spr entry keys on its own TRIMMED literal (never null/empty).
assert(
  mistakeKey('spr', '', '  1 1/2 ') === 'spr:1 1/2',
  'a non-parseable spr entry (mixed number) keys on its trimmed raw literal',
);
assert(
  mistakeKey('spr', '', 'abc') === 'spr:abc',
  'a non-numeric spr entry keys on its raw literal',
);

// Different spr values key differently.
assert(mistakeKey('spr', '', '3.5') !== mistakeKey('spr', '', '3.6'), 'distinct spr values differ');

// mcq and spr namespaces never collide (the prefix separates them).
assert(
  mistakeKey('mcq', '5', '') !== mistakeKey('spr', '', '5'),
  'mcq and spr keys never collide (distinct prefixes)',
);

// --- 3. cross-question separation is the PK's job (documented contract) ------
// Two DIFFERENT questions with the identical wrong answer produce the SAME
// chosen_key. Separation is provided by question_id in the composite PK
// (question_id, chosen_key), NOT by this helper.
assert(
  mistakeKey('mcq', 'The author is skeptical', '') ===
    mistakeKey('mcq', 'The author is skeptical', ''),
  'identical wrong-answer text → identical chosen_key (cross-question separation is the PK’s job)',
);

console.log(`\ncheck-mistake-key: ${count} assertions passed`);
