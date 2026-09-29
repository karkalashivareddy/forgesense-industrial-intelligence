/**
 * Low-frequency clock and elapsed-time hooks.
 *
 * All timers pause when the document is hidden, so a backgrounded tab does no
 * work. This matters for the several 1 s tickers in the shell and inspector.
 */

import { useEffect, useRef, useState } from 'react';

export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  const interval = useRef(intervalMs);
  interval.current = intervalMs;

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer !== null) return;
      setNow(Date.now());
      timer = setInterval(() => setNow(Date.now()), interval.current);
    };

    const stop = () => {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    };

    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };

    if (document.hidden) stop();
    else start();

    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      stop();
    };
  }, []);

  return now;
}

/** True when the user asked for reduced motion. Reactive to the media query. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

/** True below the given breakpoint. Uses matchMedia so it is SSR-safe. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const list = window.matchMedia(query);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    setMatches(list.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
