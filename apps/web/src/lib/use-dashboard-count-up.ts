'use client';

import { useEffect, useState } from 'react';

export const DASHBOARD_COUNT_UP_MS = 1000;

export function dashboardCountAt(target: number, elapsed: number): number {
  return target * Math.min(1, Math.max(0, elapsed / DASHBOARD_COUNT_UP_MS));
}

export function useDashboardCountUp(target: number | null): number {
  const [frame, setFrame] = useState({ target, value: 0 });

  useEffect(() => {
    if (target === null) return;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let request = 0;
    const started = performance.now();
    const tick = (now: number) => {
      setFrame({ target, value: dashboardCountAt(target, now - started) });
      if (now - started < DASHBOARD_COUNT_UP_MS) request = requestAnimationFrame(tick);
    };
    const finish = () => {
      if (!motion.matches) return;
      cancelAnimationFrame(request);
      setFrame({ target, value: target });
    };
    if (motion.matches) finish();
    else {
      setFrame({ target, value: 0 });
      request = requestAnimationFrame(tick);
    }
    motion.addEventListener('change', finish);
    return () => {
      cancelAnimationFrame(request);
      motion.removeEventListener('change', finish);
    };
  }, [target]);

  return frame.target === target ? frame.value : 0;
}
