'use client';

import { useEffect, useRef, useState } from 'react';

// Line reader (sub-project #17, spec §A). A Bluebook-style focus band that
// follows the pointer over the passage container: a ~3-line-tall translucent
// window with dim masks above and below. Purely visual — no persisted state
// beyond the band's own position. Rendered as an absolute overlay INSIDE the
// (relatively-positioned) passage container, so all coordinates are
// container-relative.
//
// Controls: the pointer's Y sets the band centre; ArrowUp/ArrowDown nudge it
// one line-height; Escape turns the tool off via `onClose`. When the pointer
// leaves the container the band stays put at its last position.

interface LineReaderProps {
  // The passage container the band overlays. Read for its height + line-height
  // and to attach pointer tracking. Must be positioned (the parent sets
  // `relative`).
  containerRef: React.RefObject<HTMLElement | null>;
  // Escape (or the caller's toggle) turns the tool off.
  onClose: () => void;
}

// Band height in line-heights. ~3 lines is the Bluebook feel.
const BAND_LINES = 3;

export function LineReader({ containerRef, onClose }: LineReaderProps) {
  // Band centre Y, in container-relative pixels. null until first measured, so
  // the band starts near the top of the passage.
  const [centerY, setCenterY] = useState<number | null>(null);
  const [lineHeight, setLineHeight] = useState(24);
  const [height, setHeight] = useState(0);
  // Live ref of centreY so the keyboard handler nudges from the current value
  // without re-subscribing on every move.
  const centerRef = useRef<number | null>(null);
  centerRef.current = centerY;

  // Measure the container: its rendered height and computed line-height. Seed
  // the band centre to the first band's middle if we haven't tracked yet.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const cs = window.getComputedStyle(el);
    const lh = parseFloat(cs.lineHeight);
    const measuredLh = Number.isFinite(lh) && lh > 0
      ? lh
      : parseFloat(cs.fontSize) * 1.5 || 24;
    setLineHeight(measuredLh);
    setHeight(el.clientHeight);
    setCenterY((prev) => (prev == null ? (measuredLh * BAND_LINES) / 2 : prev));
  }, [containerRef]);

  // Pointer tracking on the container: the band centre follows the cursor's Y.
  // Leaving the container is intentionally NOT reset — the band stays put.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    function onMove(e: PointerEvent) {
      const rect = el!.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const clamped = Math.max(0, Math.min(y, rect.height));
      setHeight(el!.clientHeight);
      setCenterY(clamped);
    }
    el.addEventListener('pointermove', onMove);
    return () => el.removeEventListener('pointermove', onMove);
  }, [containerRef]);

  // Keyboard: ArrowUp/Down nudge one line-height; Escape turns the tool off.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const el = containerRef.current;
        const max = el ? el.clientHeight : height;
        e.preventDefault();
        const cur = centerRef.current ?? (lineHeight * BAND_LINES) / 2;
        const next = e.key === 'ArrowUp' ? cur - lineHeight : cur + lineHeight;
        setCenterY(Math.max(0, Math.min(next, max)));
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [containerRef, height, lineHeight, onClose]);

  const bandHeight = lineHeight * BAND_LINES;
  const c = centerY ?? bandHeight / 2;
  // Clamp the band so it never runs off the top/bottom of the container.
  const bandTop = Math.max(0, Math.min(c - bandHeight / 2, Math.max(0, height - bandHeight)));
  const bandBottom = bandTop + bandHeight;

  return (
    <div className="pointer-events-none absolute inset-0 z-10" aria-hidden="true">
      {/* Dim mask ABOVE the band. */}
      <div
        className="absolute inset-x-0 top-0 bg-slate-900/40"
        style={{ height: bandTop }}
      />
      {/* The clear focus band — a subtle outline, no dimming. */}
      <div
        className="absolute inset-x-0 border-y border-amber-400/70"
        style={{ top: bandTop, height: bandHeight }}
      />
      {/* Dim mask BELOW the band. */}
      <div
        className="absolute inset-x-0 bottom-0 bg-slate-900/40"
        style={{ top: bandBottom }}
      />
    </div>
  );
}
