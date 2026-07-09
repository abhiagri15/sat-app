'use client';

import { useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { LETTERS } from '@/app/lib/test';
import type { Question } from '@/app/lib/questions';
import type { ResponseValue } from '@/app/lib/test';
import { Button } from '@/app/components/ui/button';
import { Card, CardContent } from '@/app/components/ui/card';
import { SprInput } from './SprInput';
import { FigureView } from './FigureView';
import { LineReader } from './LineReader';
import { segmentText, type Interval } from '@/app/lib/highlights';

interface QuestionViewProps {
  section: { name: string };
  question: Question;
  // For mcq this is a number (the chosen choice index) or null (skipped).
  // For SPR this is a string (the typed entry) or null (skipped).
  selected: ResponseValue;
  onAnswer: (value: number | string) => void;
  onPrev: () => void;
  onNext: () => void;
  isFirst: boolean;
  isLast: boolean;
  // Answer eliminator (design spec §D). UI-state only — never persisted. When
  // `eliminatorOn` is true, each mcq choice row gets a small cross-out control;
  // `eliminated` holds the struck choice indices for THIS question; toggling
  // calls `onToggleEliminate`. SPR is unaffected (no choices). These are
  // optional so pre-existing callers (none today) still compile.
  eliminatorOn?: boolean;
  eliminated?: Set<number>;
  onToggleEliminate?: (i: number) => void;
  // Passage tools (sub-project #17, spec §A) — passage-only, UI-state only,
  // never persisted. `highlights` are half-open plain-text intervals for THIS
  // question. When `highlighterOn`, releasing a text selection inside the
  // passage adds one (offsets computed via a text-node walk); clicking an
  // existing <mark> removes that interval. `lineReaderOn` overlays the focus
  // band. All optional so other callers still compile.
  highlights?: Interval[];
  highlighterOn?: boolean;
  onAddHighlight?: (interval: Interval) => void;
  onRemoveHighlightAt?: (pos: number) => void;
  // Notes on highlights (sub-project #19, spec §C). With the highlighter ON,
  // clicking a <mark> opens a small note popover (instead of removing). Save
  // sets the note via `onSetHighlightNote(pos, note)`; an empty note clears it.
  // Remove-highlight in the popover calls `onRemoveHighlightAt(pos)`. Both
  // optional so other callers still compile; when `onSetHighlightNote` is
  // absent the old click-to-remove behavior is used.
  onSetHighlightNote?: (pos: number, note: string) => void;
  lineReaderOn?: boolean;
  onLineReaderClose?: () => void;
}

export function QuestionView({
  section,
  question,
  selected,
  onAnswer,
  onPrev,
  onNext,
  isFirst,
  isLast,
  eliminatorOn = false,
  eliminated,
  onToggleEliminate,
  highlights = [],
  highlighterOn = false,
  onAddHighlight,
  onRemoveHighlightAt,
  onSetHighlightNote,
  lineReaderOn = false,
  onLineReaderClose,
}: QuestionViewProps) {
  const isSpr = question.response_format === 'spr';
  const passageRef = useRef<HTMLDivElement | null>(null);

  // Note popover state (spec §C). `notePopover` holds the plain-text start
  // offset of the clicked mark, the mark's on-screen anchor rect (relative to
  // the passage container), and the current note text being edited. null = no
  // popover open. The popover is anchored with a positioned div near the mark.
  const [notePopover, setNotePopover] = useState<{
    pos: number;
    top: number;
    left: number;
    draft: string;
  } | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const notesEnabled = highlighterOn && Boolean(onSetHighlightNote);

  // Read-only note popover (sub-project #21, spec C6). When the highlighter is
  // OFF, tapping a NOTED mark shows its note anchored below the mark — the
  // touch-visible replacement for the mouse-only `title` tooltip. `pos` doubles
  // as the toggle key: tapping the same noted mark again closes it. null = none.
  const [readNote, setReadNote] = useState<{
    pos: number;
    top: number;
    left: number;
    note: string;
  } | null>(null);
  const readNoteRef = useRef<HTMLDivElement | null>(null);

  // Any change of question closes an open popover (stale offsets otherwise).
  useEffect(() => {
    setNotePopover(null);
  }, [question.id]);

  // Turning the highlighter off closes the popover (it's a highlighter-on tool).
  useEffect(() => {
    if (!highlighterOn) setNotePopover(null);
  }, [highlighterOn]);

  // The read-only note popover is a highlighter-OFF tool; turning the tool ON
  // (edit popover takes over) or changing the question closes it.
  useEffect(() => {
    if (highlighterOn) setReadNote(null);
  }, [highlighterOn]);
  useEffect(() => {
    setReadNote(null);
  }, [question.id]);

  // Read-only note popover dismissal: Escape or an outside tap/click. Uses
  // pointerdown (capture) so touch AND mouse both dismiss before the event
  // reaches the passage. Only while the popover is open.
  useEffect(() => {
    if (!readNote) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setReadNote(null);
    }
    function onDown(e: Event) {
      if (readNoteRef.current && !readNoteRef.current.contains(e.target as Node)) {
        setReadNote(null);
      }
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown, true);
    };
  }, [readNote]);

  // Escape closes; outside-click (mousedown outside the popover) closes. Both
  // only while the popover is open.
  useEffect(() => {
    if (!notePopover) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setNotePopover(null);
    }
    function onDown(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setNotePopover(null);
      }
    }
    document.addEventListener('keydown', onKey);
    // `capture` so we see the outside mousedown before it bubbles anywhere.
    document.addEventListener('mousedown', onDown, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown, true);
    };
  }, [notePopover]);

  // Open the note popover for the mark at plain-text offset `pos`, anchored just
  // below the clicked mark. `markEl` supplies the anchor rect; positions are
  // computed relative to the passage container so the absolutely-positioned
  // popover tracks the mark.
  function openNotePopover(pos: number, note: string, markEl: HTMLElement) {
    const container = passageRef.current;
    if (!container) return;
    const cRect = container.getBoundingClientRect();
    const mRect = markEl.getBoundingClientRect();
    setNotePopover({
      pos,
      top: mRect.bottom - cRect.top + 4,
      left: Math.max(0, mRect.left - cRect.left),
      draft: note,
    });
  }

  // Toggle the read-only note popover for a noted mark (highlighter OFF path).
  // Same anchoring math as `openNotePopover`; tapping the same mark (same `pos`)
  // again closes it.
  function toggleReadNote(pos: number, note: string, markEl: HTMLElement) {
    const container = passageRef.current;
    if (!container) return;
    if (readNote && readNote.pos === pos) {
      setReadNote(null);
      return;
    }
    const cRect = container.getBoundingClientRect();
    const mRect = markEl.getBoundingClientRect();
    setReadNote({
      pos,
      top: mRect.bottom - cRect.top + 4,
      left: Math.max(0, mRect.left - cRect.left),
      note,
    });
  }

  // Convert a DOM selection endpoint (node, offset) into a PLAIN-TEXT character
  // offset relative to the passage container. Existing <mark> spans split the
  // passage into multiple text nodes, so a naive `selectionStart` is
  // unavailable — the standard technique is to WALK the container's text nodes
  // in document order, accumulating lengths. A range whose end lands before
  // `(node, offset)` contributes its full text; the node the point lands in
  // contributes only up to the point. Returns null if the node isn't inside
  // the container. Handles both text-node endpoints (offset = char index) and
  // element-node endpoints (offset = child index) via a boundary Range compare.
  function offsetOf(container: HTMLElement, node: Node, nodeOffset: number): number | null {
    if (node !== container && !container.contains(node)) return null;
    // A collapsed range AT the endpoint; we compare each text node against it.
    const point = document.createRange();
    try {
      point.setStart(node, nodeOffset);
    } catch {
      return null;
    }
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let acc = 0;
    let current = walker.nextNode() as Text | null;
    while (current) {
      const len = current.textContent?.length ?? 0;
      // Where does the endpoint fall relative to THIS text node's [start,end)?
      // compareBoundaryPoints(START_TO_START, r) with r starting at the text
      // node's start: <0 means the point precedes this node entirely.
      const nodeRange = document.createRange();
      nodeRange.selectNodeContents(current);
      // point start vs node end: if point <= node start, this whole node is
      // after the point — stop.
      if (point.compareBoundaryPoints(Range.START_TO_START, nodeRange) <= 0) {
        break;
      }
      // point start vs node end: if point is within this node, add the partial.
      if (point.compareBoundaryPoints(Range.START_TO_END, nodeRange) < 0) {
        // The point is inside this text node. If the endpoint IS this text
        // node, nodeOffset is the char index; otherwise fall back to full len.
        acc += node === current ? nodeOffset : len;
        return acc;
      }
      // The point is at or after this node's end — count the whole node.
      acc += len;
      current = walker.nextNode() as Text | null;
    }
    return acc;
  }

  // Convert the CURRENT document selection into a clamped plain-text interval
  // scoped to the passage container, or null. Single source of the
  // selection→offset accumulation (mouseup AND the touch selectionchange path
  // both call this — the text-node-walk lives ONLY in `offsetOf`). A collapsed
  // or non-passage-touching selection yields null; a range that only clips the
  // passage is clamped to its bounds. Does NOT clear the selection — callers
  // that commit clear it (so the debounced path no-ops on the cleared range).
  function selectionToInterval(container: HTMLElement, sel: Selection): Interval | null {
    if (sel.rangeCount === 0 || sel.isCollapsed) return null;
    const range = sel.getRangeAt(0);
    // Ignore selections that don't touch the passage at all.
    if (!container.contains(range.startContainer) && !container.contains(range.endContainer)) {
      return null;
    }
    const startNode = container.contains(range.startContainer) ? range.startContainer : container;
    const startOff = container.contains(range.startContainer) ? range.startOffset : 0;
    const endNode = container.contains(range.endContainer) ? range.endContainer : container;
    const total = container.textContent?.length ?? 0;
    const endOff = container.contains(range.endContainer) ? range.endOffset : total;

    let a = offsetOf(container, startNode, startOff);
    let b = offsetOf(container, endNode, endOff);
    if (a == null || b == null) return null;
    if (a > b) [a, b] = [b, a];
    // Clamp to the passage text range; addInterval also clamps, belt-and-braces.
    a = Math.max(0, Math.min(a, total));
    b = Math.max(0, Math.min(b, total));
    if (b <= a) return null;
    return { start: a, end: b };
  }

  // On mouseup with the highlighter on: commit the current selection as a
  // highlight, then clear the selection. Clearing is load-bearing — the
  // debounced selectionchange path (touch) reads the SAME live selection, so a
  // committed-then-cleared range makes that path no-op instead of double-adding.
  function handlePassageMouseUp() {
    if (!highlighterOn || !onAddHighlight) return;
    const container = passageRef.current;
    if (!container) return;
    const sel = window.getSelection();
    if (!sel) return;
    const interval = selectionToInterval(container, sel);
    if (interval) {
      onAddHighlight(interval);
      sel.removeAllRanges();
    }
  }

  // Touch-capable highlight capture (sub-project #21, spec C6). Long-press
  // selection on touch reliably fires `selectionchange` but not a mouseup while
  // a range is live, so mouseup alone leaves the iPad highlighter dead. This
  // ADDITIVE path debounces selectionchange (~300ms, so it fires once the drag
  // settles), commits the range, and clears the selection. Guards against a
  // double-add with the mouseup path: committing clears the selection, and the
  // debounce no-ops on a collapsed/cleared/non-passage selection (both paths
  // read the same live selection, so whichever commits first empties it). The
  // listener is attached ONLY while `highlighterOn && passage present`.
  useEffect(() => {
    if (!highlighterOn || !onAddHighlight || !question.passage) return;
    const container = passageRef.current;
    if (!container) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    function onSelectionChange() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        const sel = window.getSelection();
        if (!sel) return;
        const interval = selectionToInterval(container!, sel);
        if (!interval) return;
        onAddHighlight!(interval);
        sel.removeAllRanges();
      }, 300);
    }
    document.addEventListener('selectionchange', onSelectionChange);
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange);
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlighterOn, onAddHighlight, question.passage, question.id]);

  // Segment the passage plain text into plain / highlighted runs. Rendered as
  // React-escaped spans — NEVER dangerouslySetInnerHTML.
  const passageText = question.passage ?? '';
  const segments = segmentText(passageText, highlights);
  // A <mark> click (highlighter on) removes the highlight under the click. We
  // reconstruct the click's plain-text offset from the segment start plus the
  // browser's caret position within the mark, but the segment start alone (any
  // position inside the merged run) is enough for removeIntervalAt.

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">{section.name} · {question.skill}</div>
        {question.passage && (
          <div className="relative mb-4">
            <div
              ref={passageRef}
              onMouseUp={handlePassageMouseUp}
              className={clsx(
                'bg-slate-50 border-l-4 border-blue-500 rounded-md p-4 whitespace-pre-wrap',
                highlighterOn && 'cursor-text select-text',
              )}
            >
              {segments.map((seg, i) => {
                if (!seg.highlighted) {
                  return <span key={i}>{seg.text}</span>;
                }
                const start = segmentStart(segments, i);
                const hasNote = Boolean(seg.note);
                return (
                  <mark
                    key={i}
                    // Track the plain-text start of this highlighted run so a
                    // click resolves to exactly its merged interval.
                    data-hl-start={start}
                    // Highlighter OFF: a noted mark exposes its note via the
                    // native `title` tooltip and is otherwise non-interactive.
                    title={!highlighterOn && hasNote ? seg.note : undefined}
                    // Highlighter ON: click opens the edit note popover (spec
                    // §C); without a note handler, fall back to click-to-remove.
                    // Highlighter OFF: tapping a NOTED mark toggles a read-only
                    // note popover (spec C6 — the touch-visible replacement for
                    // the hover-only `title`). A non-noted mark stays inert.
                    onClick={
                      notesEnabled
                        ? (e) => {
                            e.stopPropagation();
                            openNotePopover(start, seg.note ?? '', e.currentTarget);
                          }
                        : highlighterOn && onRemoveHighlightAt
                          ? (e) => {
                              e.stopPropagation();
                              onRemoveHighlightAt(start);
                            }
                          : !highlighterOn && hasNote
                            ? (e) => {
                                e.stopPropagation();
                                toggleReadNote(start, seg.note ?? '', e.currentTarget);
                              }
                            : undefined
                    }
                    className={clsx(
                      'bg-yellow-200 rounded-sm',
                      (highlighterOn || (!highlighterOn && hasNote)) && 'cursor-pointer',
                      hasNote && 'underline decoration-dotted decoration-slate-500',
                    )}
                  >
                    {seg.text}
                    {hasNote && (
                      <sup aria-hidden="true" className="ml-0.5 text-[0.6em] text-slate-500">
                        ●
                      </sup>
                    )}
                  </mark>
                );
              })}
              {notePopover && onSetHighlightNote && (
                <div
                  ref={popoverRef}
                  // Keep the popover from triggering the passage mouseup add-
                  // highlight handler and from bubbling clicks to the passage.
                  onMouseUp={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                  role="dialog"
                  aria-label="Highlight note"
                  className="absolute z-20 w-64 rounded-md border border-slate-300 bg-white p-3 shadow-lg"
                  style={{ top: notePopover.top, left: notePopover.left }}
                >
                  <textarea
                    autoFocus
                    maxLength={280}
                    value={notePopover.draft}
                    onChange={(e) =>
                      setNotePopover((p) => (p ? { ...p, draft: e.target.value } : p))
                    }
                    placeholder="Add a note…"
                    className="h-20 w-full resize-none rounded border border-slate-300 p-2 text-sm focus:border-blue-500 focus:outline-none"
                  />
                  <div className="mt-1 text-right text-[11px] text-slate-400">
                    {notePopover.draft.length}/280
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        onSetHighlightNote(notePopover.pos, notePopover.draft.trim());
                        setNotePopover(null);
                      }}
                      className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-blue-700"
                    >
                      Save note
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onRemoveHighlightAt?.(notePopover.pos);
                        setNotePopover(null);
                      }}
                      className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 transition hover:border-red-400 hover:text-red-600"
                    >
                      Remove highlight
                    </button>
                  </div>
                </div>
              )}
              {/* Read-only note popover (spec C6): touch-visible note when the
                  highlighter is OFF. Same anchoring + shell as the edit popover,
                  no textarea/buttons — display only. Dismissed by outside tap,
                  Escape, or tapping the mark again (see the effect + toggle). */}
              {readNote && (
                <div
                  ref={readNoteRef}
                  onPointerDown={(e) => e.stopPropagation()}
                  role="dialog"
                  aria-label="Highlight note"
                  className="absolute z-20 w-64 rounded-md border border-slate-300 bg-white p-3 shadow-lg"
                  style={{ top: readNote.top, left: readNote.left }}
                >
                  <p className="whitespace-pre-wrap break-words text-sm text-slate-700">
                    {readNote.note}
                  </p>
                </div>
              )}
            </div>
            {lineReaderOn && (
              <LineReader
                containerRef={passageRef}
                onClose={onLineReaderClose ?? (() => {})}
              />
            )}
          </div>
        )}
        {question.figure && (
          <div className="mb-4">
            <FigureView figure={question.figure} />
          </div>
        )}
        <div className="text-lg font-semibold mb-4">{question.prompt}</div>

        {isSpr ? (
          <SprInput
            value={typeof selected === 'string' ? selected : ''}
            onChange={onAnswer}
          />
        ) : (
          <div className="flex flex-col gap-2.5">
            {question.choices.map((c, i) => {
              const isEliminated = eliminated?.has(i) ?? false;
              // Structure (C5): a row DIV holds a real choice <button> (flex-1,
              // native focus/Enter/Space) and a SIBLING eliminator button — never
              // a button nested inside a clickable button. The row itself carries
              // only the visual state classes.
              return (
                <div
                  key={i}
                  className={clsx(
                    'flex items-stretch gap-1 rounded-lg border border-slate-200 transition hover:border-blue-500 hover:bg-blue-50',
                    selected === i && 'border-blue-500 bg-blue-50 ring-1 ring-inset ring-blue-500',
                    isEliminated && 'opacity-40',
                  )}
                >
                  <button
                    type="button"
                    // Selecting a choice clears its elimination — see TestScreen's
                    // onAnswer wrapper. Eliminated choices stay selectable.
                    onClick={() => onAnswer(i)}
                    className="flex flex-1 items-start gap-3 px-4 py-3 text-left"
                  >
                    <span className="font-bold text-blue-600 min-w-[20px]">{LETTERS[i]}</span>
                    <span className={clsx('flex-1', isEliminated && 'line-through')}>{c}</span>
                  </button>
                  {eliminatorOn && onToggleEliminate && (
                    <button
                      type="button"
                      aria-pressed={isEliminated}
                      aria-label={
                        isEliminated
                          ? `Restore option ${LETTERS[i]}`
                          : `Eliminate option ${LETTERS[i]}`
                      }
                      // Toggle elimination without selecting the choice — a sibling
                      // button, so no nested-button / event-stopPropagation dance.
                      onClick={() => onToggleEliminate(i)}
                      className="my-2 mr-2 flex min-h-[40px] min-w-[40px] items-center justify-center rounded border border-slate-300 bg-white text-xs font-semibold text-slate-500 transition hover:border-slate-500 hover:text-slate-800"
                    >
                      {isEliminated ? '↺' : '✕'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="flex flex-wrap gap-2.5 mt-[22px] justify-between">
          <Button
            variant="secondary"
            className={clsx(isFirst && 'invisible')}
            onClick={onPrev}
          >
            ‹ Previous
          </Button>
          <Button
            onClick={onNext}
          >
            {isLast ? 'Review' : 'Next ›'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// The plain-text start offset of segment `i` — the sum of every prior
// segment's length. Used to derive a removable position for a <mark> click
// (any position inside the merged run works for removeIntervalAt).
function segmentStart(segments: { text: string }[], i: number): number {
  let acc = 0;
  for (let k = 0; k < i; k++) acc += segments[k].text.length;
  return acc;
}
