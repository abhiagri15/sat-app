'use client';

import { useRef } from 'react';
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
  lineReaderOn = false,
  onLineReaderClose,
}: QuestionViewProps) {
  const isSpr = question.response_format === 'spr';
  const passageRef = useRef<HTMLDivElement | null>(null);

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

  // On mouseup with the highlighter on: read the selection, convert its
  // endpoints to plain-text offsets, clamp to the passage, and emit an
  // interval. Collapsed selections are ignored. The selection is cleared after.
  function handlePassageMouseUp() {
    if (!highlighterOn || !onAddHighlight) return;
    const container = passageRef.current;
    if (!container) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    // Ignore selections that don't touch the passage at all.
    if (!container.contains(range.startContainer) && !container.contains(range.endContainer)) {
      return;
    }
    const startNode = container.contains(range.startContainer) ? range.startContainer : container;
    const startOff = container.contains(range.startContainer) ? range.startOffset : 0;
    const endNode = container.contains(range.endContainer) ? range.endContainer : container;
    const total = container.textContent?.length ?? 0;
    const endOff = container.contains(range.endContainer) ? range.endOffset : total;

    let a = offsetOf(container, startNode, startOff);
    let b = offsetOf(container, endNode, endOff);
    if (a == null || b == null) return;
    if (a > b) [a, b] = [b, a];
    // Clamp to the passage text range; addInterval also clamps, belt-and-braces.
    a = Math.max(0, Math.min(a, total));
    b = Math.max(0, Math.min(b, total));
    if (b > a) onAddHighlight({ start: a, end: b });
    sel.removeAllRanges();
  }

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
              {segments.map((seg, i) =>
                seg.highlighted ? (
                  <mark
                    key={i}
                    // Track the plain-text start of this highlighted run so a
                    // click can remove exactly it. Clicking a <mark> while the
                    // highlighter is on removes the whole merged interval.
                    data-hl-start={segmentStart(segments, i)}
                    onClick={
                      highlighterOn && onRemoveHighlightAt
                        ? (e) => {
                            e.stopPropagation();
                            onRemoveHighlightAt(segmentStart(segments, i));
                          }
                        : undefined
                    }
                    className={clsx(
                      'bg-yellow-200 rounded-sm',
                      highlighterOn && 'cursor-pointer',
                    )}
                  >
                    {seg.text}
                  </mark>
                ) : (
                  <span key={i}>{seg.text}</span>
                ),
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
              return (
                <div
                  key={i}
                  className={clsx(
                    'flex items-start gap-3 rounded-lg border border-slate-200 px-4 py-3 cursor-pointer transition hover:border-blue-500 hover:bg-blue-50',
                    selected === i && 'border-blue-500 bg-blue-50 ring-1 ring-inset ring-blue-500',
                    isEliminated && 'opacity-40',
                  )}
                  // Clicking a choice selects it (and clears its elimination —
                  // see TestScreen's onAnswer wrapper). Eliminated choices stay
                  // clickable.
                  onClick={() => onAnswer(i)}
                >
                  <span className="font-bold text-blue-600 min-w-[20px]">{LETTERS[i]}</span>
                  <span className={clsx('flex-1', isEliminated && 'line-through')}>{c}</span>
                  {eliminatorOn && onToggleEliminate && (
                    <button
                      type="button"
                      aria-pressed={isEliminated}
                      aria-label={
                        isEliminated
                          ? `Restore option ${LETTERS[i]}`
                          : `Eliminate option ${LETTERS[i]}`
                      }
                      // Toggle elimination without selecting the choice.
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleEliminate(i);
                      }}
                      className="ml-1 min-w-[24px] rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs font-semibold text-slate-500 transition hover:border-slate-500 hover:text-slate-800"
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
