"use client";

import { useEffect, useRef, useState } from "react";

export function ExpandableText({ children, lines = 3, className = "" }: { children: string; lines?: number; className?: string }) {
  const textRef = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const element = textRef.current;
    if (!element) return;
    const measure = () => setOverflowing(element.scrollHeight > element.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [children, lines, expanded]);

  return <div className={`min-w-0 ${className}`}>
    <p ref={textRef} className={`m-0 min-w-0 [overflow-wrap:anywhere] ${expanded ? "" : "overflow-hidden [display:-webkit-box] [-webkit-box-orient:vertical]"}`} style={expanded ? undefined : { WebkitLineClamp: lines }}>{children}</p>
    {(overflowing || expanded) && <button className="mt-2 border-0 bg-transparent p-0 text-xs font-semibold text-accent-text underline underline-offset-4" type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? "Show less" : "Show more"}</button>}
  </div>;
}
