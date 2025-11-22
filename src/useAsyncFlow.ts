import React from "react";

export type AsyncFlowContext = {
  signal: AbortSignal;
  cancelled: () => boolean;
  spawn: SpawnHelpers;
};

export type SpawnHelpers = {
  parallel: <T>(tasks: Array<() => Promise<T>>) => Promise<T[]>;
  sequence: <T>(tasks: Array<() => Promise<T>>) => Promise<T[]>;
  race: <T>(tasks: Array<() => Promise<T>>) => Promise<T>;
  retry: <T>(
    fn: () => Promise<T>,
    retries?: number,
    delayMs?: number
  ) => Promise<T>;
  timeout: <T>(fn: () => Promise<T>, ms: number) => Promise<T>;
};

export type UseAsyncFlowOptions<T> = {
  run: (ctx: AsyncFlowContext) => Promise<T> | T;
  deps?: React.DependencyList;
  auto?: boolean;
  onError?: (err: any) => void;
  onFinally?: () => void;
  dev?: boolean;
};

export type UseAsyncFlowReturn<T> = {
  run: () => Promise<T | undefined>;
  status: "idle" | "running" | "success" | "error" | "cancelled";
  result: T | null;
  error?: any;
  cancel: () => void;
};

const DEFAULT_RETRIES = 3;
const DEFAULT_DELAY_MS = 300;

const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

async function pTimeout<T>(p: Promise<T>, ms: number) {
  let timer: any;
  const timeout = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error("timeout")), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// Helper function to create spawn utilities with abort signal
const makeSpawn = (signal: AbortSignal): SpawnHelpers => ({
  parallel: (tasks) =>
    Promise.all(
      tasks.map((task) =>
        signal.aborted ? Promise.reject(new Error("aborted")) : task()
      )
    ),

  sequence: async (tasks) => {
    const results = [];

    for (const task of tasks) {
      if (signal.aborted) throw new Error("aborted");
      results.push(await task());
    }
    return results;
  },

  race: (tasks) => Promise.race(tasks.map((task) => task())),

  retry: async (fn, retries = DEFAULT_RETRIES, delayMs = DEFAULT_DELAY_MS) => {
    let lastError;

    for (let attempt = 0; attempt < retries; attempt++) {
      if (signal.aborted) throw new Error("aborted");
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        if (attempt < retries - 1) await delay(delayMs);
      }
    }
    throw lastError;
  },

  timeout: (fn, ms) => pTimeout(fn(), ms),
});

export function useAsyncFlow<T>(
  opts: UseAsyncFlowOptions<T>
): UseAsyncFlowReturn<T> {
  const { run, deps = [], auto = true, onError, onFinally, dev = false } = opts;

  const [status, setStatus] =
    React.useState<UseAsyncFlowReturn<T>["status"]>("idle");
  const [result, setResult] = React.useState<T | null>(null);
  const [error, setError] = React.useState<any>(null);

  const abortRef = React.useRef<AbortController | null>(null);
  const mountedRef = React.useRef(true);

  // Track mount state & cleanup
  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  // Helper: start a new controller, abort old one
  const createAbortController = () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    return controller;
  };

  // Core executor
  const executeRun = React.useCallback(async () => {
    const controller = createAbortController();

    setStatus("running");
    setError(null);
    setResult(null);

    const ctx: AsyncFlowContext = {
      signal: controller.signal,
      cancelled: () => controller.signal.aborted || !mountedRef.current,
      spawn: makeSpawn(controller.signal),
    };

    try {
      dev && console.log("[RAO] start");
      const value = await Promise.resolve(run(ctx));

      if (ctx.cancelled()) {
        setStatus("cancelled");
        dev && console.log("[RAO] cancelled");
        return;
      }

      setStatus("success");
      setResult(value);
      dev && console.log("[RAO] success", value);
      return value;
    } catch (err) {
      if (ctx.cancelled()) {
        setStatus("cancelled");
        return;
      }

      setStatus("error");
      setError(err);
      onError?.(err);

      dev && console.error("[RAO] error", err);
    } finally {
      onFinally?.();
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [run, dev, onError, onFinally]);

  // Auto execution when dependencies change
  React.useEffect(() => {
    if (auto) executeRun();
    return () => abortRef.current?.abort();
  }, deps);

  // Manual cancel
  const cancel = React.useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus("cancelled");
  }, []);

  return { run: executeRun, cancel, status, result, error };
}
