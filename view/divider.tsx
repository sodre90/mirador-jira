import { useRef } from "react";

const MIN_PANE_PX = 320;
const MIN_LIST_PX = 280;
const KEY_STEP_PX = 24;

/** The line between the list and the issue's panel: dragged, or moved with the arrow keys, it sets the panel's width. */
export function Divider({ onResize, onDone }: { onResize(width: number): void; onDone(width: number): void }) {
  const line = useRef<HTMLDivElement>(null);
  const clamped = (wanted: number) => {
    const body = line.current?.parentElement?.getBoundingClientRect().width ?? Infinity;
    return Math.round(Math.max(MIN_PANE_PX, Math.min(body - MIN_LIST_PX, wanted)));
  };
  const paneWidth = () => line.current?.nextElementSibling?.getBoundingClientRect().width ?? MIN_PANE_PX;
  const widthAt = (clientX: number) => clamped((line.current?.parentElement?.getBoundingClientRect().right ?? clientX) - clientX);
  return (
    <div
      ref={line}
      className="divider"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the issue's panel"
      tabIndex={0}
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) onResize(widthAt(event.clientX));
      }}
      onPointerUp={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        event.currentTarget.releasePointerCapture(event.pointerId);
        onDone(widthAt(event.clientX));
      }}
      onKeyDown={(event) => {
        const by = { ArrowLeft: KEY_STEP_PX, ArrowRight: -KEY_STEP_PX }[event.key];
        if (!by) return;
        event.preventDefault();
        event.stopPropagation();
        onDone(clamped(paneWidth() + by));
      }}
    />
  );
}
