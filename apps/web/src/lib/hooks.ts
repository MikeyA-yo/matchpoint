import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, subscribe } from "./api";
import type { StreamEvent } from "./types";

function toApiError(e: unknown): ApiError {
  return e instanceof ApiError ? e : new ApiError(0, "CLIENT_ERROR", e instanceof Error ? e.message : String(e));
}

interface QueryState<T> {
  data?: T;
  error?: ApiError;
  loading: boolean;
}

/** Runs `fn` on mount and whenever `deps` change. Keeps the last data while reloading. */
export function useQuery<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [state, setState] = useState<QueryState<T>>({ loading: true });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    fn()
      .then((data) => alive && setState({ data, loading: false }))
      .catch((e) => alive && setState((s) => ({ ...s, error: toApiError(e), loading: false })));
    return () => {
      alive = false;
    };
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}

/** Wraps a mutation: `run` resolves to the result, or undefined if it failed (error is in state). */
export function useAction<A extends unknown[], T>(fn: (...args: A) => Promise<T>) {
  const [state, setState] = useState<QueryState<T>>({ loading: false });
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const run = useCallback(async (...args: A) => {
    setState((s) => ({ data: s.data, loading: true }));
    try {
      const data = await fnRef.current(...args);
      setState({ data, loading: false });
      return data;
    } catch (e) {
      setState({ error: toApiError(e), loading: false });
      return undefined;
    }
  }, []);
  const reset = useCallback(() => setState({ loading: false }), []);
  return [run, state, reset] as const;
}

/** Calls `onEvent` for every event on GET /stream. */
export function useStream(onEvent: (e: StreamEvent) => void) {
  const ref = useRef(onEvent);
  ref.current = onEvent;
  useEffect(() => subscribe((e) => ref.current(e)), []);
}

/** The most recent stream events, newest first. */
export function useEventLog(filter: (e: StreamEvent) => boolean = () => true, max = 40) {
  const [events, setEvents] = useState<StreamEvent[]>([]);
  useStream((e) => {
    if (filter(e)) setEvents((prev) => [e, ...prev].slice(0, max));
  });
  return [events, () => setEvents([])] as const;
}
