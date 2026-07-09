'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// Line reader (sub-project #17, spec §A; touch support sub-project #21, spec C6).
// A Bluebook-style focus band over the passage container: a ~3-line-tall
// translucent window with dim masks above and below. Purely visual — no
// persisted state beyond the band's own position. Rendered as an absolute
// overlay INSIDE the (relatively-positioned) passage container, so all
// coordinates are container-relative.
//
// Controls:
//  - MOUSE: the pointer's Y over the passage sets the band centre (pointer-
//    follow). Untouched by the touch paths (gated on `pointerType === 'mouse'`).
//  - TOUCH: a mouse drag follows the page; a touch drag over the passage would
//    SCROLL the page, so touch gets a dedicated ≥44px drag HANDLE with
//    `touch-action: none` + pointer capture (drag moves the band, never scrolls)
//    plus tap-to-position — tapping anywhere in the passage moves the band to
//    the tap point. Page scroll stays normal everywhere except on the handle.
//  - KEYBOARD: ArrowUp/ArrowDown nudge one line-height; Escape turns the tool
//    off via `onClose`.
// When the pointer leaves the container the band stays put at its last position.

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
// Drag-handle hit target — the a11y minimum touch target (spec C6).
const HANDLE_SIZE = 44;

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
  // True while a handle drag is in progress — suppresses the container
  // tap-to-position so a drag that ends on the passage doesn't double-fire.
  const draggingRef = useRef(false);

  // Set the band centre from a container-relative Y, clamped to the container.
  const setCenterClamped = useCallback((y: number) => {
    const el = containerRef.current;
    const max = el ? el.clientHeight : height;
    if (el) setHeight(el.clientHeight);
    setCenterY(Math.max(0, Math.min(y, max)));
  }, [containerRef, height]);

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

  // MOUSE pointer-follow on the container: the band centre follows the cursor's
  // Y. Gated to `pointerType === 'mouse'` — touch uses the handle + tap paths
  // (a touch pointermove here would fight the page scroll). Leaving the
  // container is intentionally NOT reset — the band stays put.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    function onMove(e: PointerEvent) {
      if (e.pointerType !== 'mouse') return;
      const rect = el!.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const clamped = Math.max(0, Math.min(y, rect.height));
      setHeight(el!.clientHeight);
      setCenterY(clamped);
    }
    el.addEventListener('pointermove', onMove);
    return () => el.removeEventListener('pointermove', onMove);
  }, [containerRef]);

  // TAP-TO-POSITION: a tap anywhere in the passage moves the band to the tap
  // point. Attached to the container (which keeps normal page-scroll behaviour
  // — no touch-action override here). Suppressed mid-handle-drag so a drag that
  // releases over the passage doesn't reposition on top of the drag.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    function onPointerUp(e: PointerEvent) {
      if (draggingRef.current) return;
      const rect = el!.getBoundingClientRect();
      setCenterClamped(e.clientY - rect.top);
    }
    el.addEventListener('pointerup', onPointerUp);
    return () => el.removeEventListener('pointerup', onPointerUp);
  }, [containerRef, setCenterClamped]);

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

  // Handle drag: pointer events + setPointerCapture so the move stream is
  // captured to the handle even as the finger leaves it. `touch-action: none`
  // on the handle (JSX style) stops the browser from claiming the gesture for a
  // page scroll — the ONLY element that overrides scrolling.
  function onHandleDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    draggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onHandleMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) return;
    e.preventDefault();
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setCenterClamped(e.clientY - rect.top);
  }
  function onHandleUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) return;
    e.stopPropagation();
    draggingRef.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }

  const bandHeight = lineHeight * BAND_LINES;
  const c = centerY ?? bandHeight / 2;
  // Clamp the band so it never runs off the top/bottom of the container.
  const bandTop = Math.max(0, Math.min(c - bandHeight / 2, Math.max(0, height - bandHeight)));
  const bandBottom = bandTop + bandHeight;

  return (
    <div
      className="pointer-events-none absolute inset-0 z-10"
      aria-hidden="true"
      // E2E hook: the band is a purely visual, aria-hidden overlay with no role
      // or text, so a test-id is the only stable selector for it.
      data-testid="line-reader"
    >
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
      {/* Touch drag handle (spec C6): ≥44px, pointer-events-auto (the overlay is
          pointer-events-none), touch-action:none so dragging it moves the band
          instead of scrolling the page. Positioned at the band's right edge,
          vertically centred on the band. */}
      <div
        onPointerDown={onHandleDown}
        onPointerMove={onHandleMove}
        onPointerUp={onHandleUp}
        onPointerCancel={onHandleUp}
        data-testid="line-reader-handle"
        className="pointer-events-auto absolute right-1 flex cursor-grab items-center justify-center rounded-full border border-amber-400 bg-amber-100/90 text-amber-700 shadow active:cursor-grabbing"
        style={{
          touchAction: 'none',
          width: HANDLE_SIZE,
          height: HANDLE_SIZE,
          top: bandTop + bandHeight / 2 - HANDLE_SIZE / 2,
        }}
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M8 9l4-4 4 4M8 15l4 4 4-4" />
        </svg>
      </div>
      {/* Dim mask BELOW the band. */}
      <div
        className="absolute inset-x-0 bottom-0 bg-slate-900/40"
        style={{ top: bandBottom }}
      />
    </div>
  );
}
