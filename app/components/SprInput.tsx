'use client';

// Student-Produced Response (SPR) input — replaces the radio list for
// non-multiple-choice questions. Accepts integer, decimal, or simple
// fraction (a/b) entries; rejects mixed numbers ("1 1/2"). Validation
// happens at submit time via parseSpr / isSprCorrect; this component
// only does light input shaping.

interface Props {
  value: string;
  onChange: (next: string) => void;
}

export function SprInput({ value, onChange }: Props) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium text-slate-700" htmlFor="spr-answer">
        Your answer
      </label>
      <input
        id="spr-answer"
        type="text"
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        pattern="[0-9./\-]*"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="e.g. 7, 3.14, or 3/4"
        aria-label="Numeric answer"
        className="w-full max-w-xs rounded-lg border border-slate-300 bg-white px-4 py-3 text-lg outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
      />
      <p className="text-xs text-slate-500">
        Enter a number or fraction. No mixed numbers — write 1.5 or 3/2, not 1 1/2.
      </p>
    </div>
  );
}
