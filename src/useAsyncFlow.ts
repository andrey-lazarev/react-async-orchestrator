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
  result?: T;
  error?: any;
  cancel: () => void;
};

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

export function useAsyncFlow<T>(
  opts: UseAsyncFlowOptions<T>
): UseAsyncFlowReturn<T> {
  const {
    run: userRun,
    deps = [],
    auto = true,
    onError,
    onFinally,
    dev = false,
  } = opts;

  const [status, setStatus] = React.useState<UseAsyncFlowReturn<T>["status"]>("idle");
  const [result, setResult] = React.useState(null);
  const [error, setError] = React.useState(null);

  const abortRef = React.useRef<AbortController | null>(null);
  const mounted = React.useRef(true);

// mount/unmount
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  // Spawn helpers
  const makeSpawn = (signal: AbortSignal): SpawnHelpers => ({
    parallel: (tasks) =>
      Promise.all(
        tasks.map((t) =>
          signal.aborted ? Promise.reject(new Error("aborted")) : t()
        )
      ),

    sequence: async (tasks) => {
      const out = [];
  
      for (const t of tasks) {
        if (signal.aborted) throw new Error("aborted");
        out.push(await t());
      }
      return out;
    },

    race: (tasks) => Promise.race(tasks.map((t) => t())),

    retry: async (fn, retries = 3, delayMs = 300) => {
      let lastErr;

      for (let i = 0; i < retries; i++) {
        if (signal.aborted) throw new Error("aborted");
        try {
          return await fn();
        } catch (e) {
          lastErr = e;
          if (i < retries - 1) await delay(delayMs);
        }
      }
      throw lastErr;
    },

    timeout: (fn, ms) => pTimeout(fn(), ms),
  });

  // Core runner

  const doRun = React.useCallback(async () => {
    abortRef.current?.abort();

    const ac = new AbortController();
    abortRef.current = ac;

    setStatus("running");
    setError(null);
    setResult(null);

    const ctx: AsyncFlowContext = {
      signal: ac.signal,
      cancelled: () => ac.signal.aborted || !mounted.current,
      spawn: makeSpawn(ac.signal),
    };

    try {
      if (dev) console.log("[RAO] start");

      const res = await Promise.resolve(userRun(ctx));

      if (ctx.cancelled()) {
        setStatus("cancelled");
        if (dev) console.log("[RAO] cancelled");
        return;
      }

      setStatus("success");
      setResult(res);
      if (dev) console.log("[RAO] success", res);
      return res;
    } catch (err) {
      if (ctx.cancelled()) {
        setStatus("cancelled");
        return;
      }

      setStatus("error");
      setError(err);
      onError?.(err);
      if (dev) console.error("[RAO] error", err);
      return;
    } finally {
      onFinally?.();
      if (abortRef.current === ac) abortRef.current = null;
    }
  }, [userRun, dev]);

  // Auto run on deps change
  React.useEffect(() => {
    if (auto) doRun();
    return () => abortRef.current?.abort();
  }, deps);

  // Public API

  const cancel = React.useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus("cancelled");
  }, []);

  return { run: doRun, cancel, status, result, error };
}
