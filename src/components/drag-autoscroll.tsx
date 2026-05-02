"use client";

import { useEffect } from "react";

// Auto-scrolls the window when a custom MH drag is near top/bottom of viewport.
// Active only while a drag carrying x-mh-track or x-mh-album is in progress.
export function DragAutoScroll() {
  useEffect(() => {
    const EDGE = 110;
    const SPEED = 22;
    let raf = 0;
    let dy = 0;
    let active = false;

    const isCustomDrag = (e: DragEvent) => {
      const types = Array.from(e.dataTransfer?.types ?? []);
      return types.includes("application/x-mh-track") || types.includes("application/x-mh-album");
    };

    const tick = () => {
      if (active && dy !== 0) {
        window.scrollBy(0, dy);
        raf = requestAnimationFrame(tick);
      } else {
        raf = 0;
      }
    };

    const onDragOver = (e: DragEvent) => {
      if (!isCustomDrag(e)) return;
      const y = e.clientY;
      const h = window.innerHeight;
      if (y < EDGE) dy = -SPEED * (1 - y / EDGE);
      else if (y > h - EDGE) dy = SPEED * (1 - (h - y) / EDGE);
      else dy = 0;
      active = dy !== 0;
      if (active && !raf) raf = requestAnimationFrame(tick);
    };
    const onDragEnd = () => { active = false; dy = 0; };

    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragend", onDragEnd);
    window.addEventListener("drop", onDragEnd);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragend", onDragEnd);
      window.removeEventListener("drop", onDragEnd);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  return null;
}
