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
  const {
    run,
    deps = [],
    auto = true,
    onError,
    onFinally,
    dev = false,
  } = opts;

  const [status, setStatus] = React.useState<UseAsyncFlowReturn<T>["status"]>("idle");
  const [result, setResult] = React.useState<T | null>(null);
  const [error, setError] = React.useState<any>(null);

  // Refs for abort controller and mount status
  const abortControllerRef = React.useRef<AbortController | null>(null);
  const isMountedRef = React.useRef(true);

  // Handle component mount/unmount
  React.useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
    };
  }, []);

  // Core async runner function
  const executeRun = React.useCallback(async () => {
    // Cancel any previous run
    abortControllerRef.current?.abort();

    // Create new abort controller for this run
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    // Reset state for new run
    setStatus("running");
    setError(null);
    setResult(null);

    // Create context with abort signal and spawn helpers
    const context: AsyncFlowContext = {
      signal: abortController.signal,
      cancelled: () => abortController.signal.aborted || !isMountedRef.current,
      spawn: makeSpawn(abortController.signal),
    };

    try {
      if (dev) console.log("[RAO] start");

      const resultValue = await Promise.resolve(run(context));

      // Check if cancelled after execution
      if (context.cancelled()) {
        setStatus("cancelled");
        if (dev) console.log("[RAO] cancelled");
        return;
      }

      setStatus("success");
      setResult(resultValue);

      if (dev) console.log("[RAO] success", resultValue);
      return resultValue;
    } catch (err) {
      // Check if cancelled due to error
      if (context.cancelled()) {
        setStatus("cancelled");
        return;
      }

      setStatus("error");
      setError(err);
      onError?.(err);

      if (dev) console.error("[RAO] error", err);
      return;
    } finally {
      // Cleanup
      onFinally?.();
      if (abortControllerRef.current === abortController) abortControllerRef.current = null;
    }
  }, [run, dev, onError, onFinally]);

  // Auto-run effect when dependencies change
  React.useEffect(() => {

    if (auto) executeRun();
    return () => abortControllerRef.current?.abort();
  }, deps);

  const cancel = React.useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setStatus("cancelled");
  }, []);

  return { run: executeRun, cancel, status, result, error };
}
