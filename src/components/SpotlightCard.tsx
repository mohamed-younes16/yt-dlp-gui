import { useEffect, useRef, type PropsWithChildren } from "react";
import { cn } from "@/lib/utils";

interface SpotlightCardProps extends PropsWithChildren {
  className?: string;
}

export function SpotlightCard({
  children,
  className,
}: SpotlightCardProps) {
  const divRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  // rAF-throttled, and position is written straight to the DOM — no React
  // re-render per mousemove.
  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    const el = divRef.current;
    const overlay = overlayRef.current;
    if (!el || !overlay || rafRef.current) return;
    const { clientX, clientY } = e;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      const rect = el.getBoundingClientRect();
      overlay.style.background = `radial-gradient(circle at ${clientX - rect.left}px ${clientY - rect.top}px, color-mix(in oklab, var(--primary) 10%, transparent), transparent 80%)`;
    });
  }

  return (
    <div
      ref={divRef}
      onMouseMove={handleMouseMove}
      onMouseEnter={(e) => {
        overlayRef.current?.style.setProperty("opacity", "0.6");
        handleMouseMove(e);
      }}
      onMouseLeave={() =>
        overlayRef.current?.style.setProperty("opacity", "0")
      }
      className={cn(
        "bg-card border-border relative overflow-hidden rounded-xl border",
        className,
      )}
    >
      <div
        ref={overlayRef}
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 ease-in-out"
      />
      {children}
    </div>
  );
}
