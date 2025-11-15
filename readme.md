# React Async Orchestrator

React Async Orchestrator is a small, zero-dependency library for **declarative async orchestration** in React.
It simplifies working with async flows in components, including **parallel/sequential tasks**, **retry**, **timeouts**, and automatic cancellation on unmount.

---

## Features

* `useAsyncFlow` hook: automatic cancellation, status tracking, result/error handling
* `spawn` helpers: `parallel`, `sequence`, `race`, `retry`, `timeout`

---

## Quick Start

```tsx
import React from 'react'
import { useAsyncFlow } from 'react-async-orchestrator'

function Example({ userId }: { userId: number }) {
  const { status, result, run, cancel } = useAsyncFlow({
    deps: [userId],
    auto: true,
    dev: true,
    run: async ({ signal, spawn }) => {
      const user = await spawn.timeout(() => fetch(`/api/users/${userId}`).then(r => r.json()), 5000)
      const [posts, comments] = await spawn.parallel([
        () => fetch(`/api/users/${userId}/posts`, { signal }).then(r => r.json()),
        () => fetch(`/api/users/${userId}/comments`, { signal }).then(r => r.json()),
      ])
      return { user, posts, comments }
    }
  })

  return (
    <div>
      <div>Status: {status}</div>
      <pre>{JSON.stringify(result, null, 2)}</pre>
      <button onClick={() => run()}>Run</button>
      <button onClick={() => cancel()}>Cancel</button>
    </div>
  )
}
```

---

## API

### `useAsyncFlow(options)`

**Options:**

| Property     | Type                                    | Description                                                |
| ------------ | --------------------------------------- | ---------------------------------------------------------- |
| `run`        | `(ctx: AsyncFlowContext) => Promise<T>` | Main async function, receives `signal` and `spawn` helpers |
| `deps?`      | `DependencyList`                        | React deps array; auto-runs on change                      |
| `auto?`      | `boolean`                               | Run automatically on mount/deps change (default `true`)    |
| `onError?`   | `(err: any) => void`                    | Error callback                                             |
| `onFinally?` | `() => void`                            | Called after success/error/cancel                          |
| `dev?`       | `boolean`                               | Enable dev logging                                         |

**Returns:**

| Property | Type               | Description           |             |         |              |               |
| -------- | ------------------ | --------------------- | ----------- | ------- | ------------ | ------------- |
| `run`    | `() => Promise<T>` | Explicitly start flow |             |         |              |               |
| `status` | `'idle'            | 'running'             | 'success'   | 'error' | 'cancelled'` | Current state |
| `result` | `T                 | undefined`            | Flow result |         |              |               |
| `error`  | `any`              | Error if any          |             |         |              |               |
| `cancel` | `() => void`       | Cancel current run    |             |         |              |               |

### `spawn` helpers (inside `run` context)

* `parallel(tasks)` — run tasks concurrently, returns array
* `sequence(tasks)` — run tasks sequentially, returns array
* `race(tasks)` — resolves with first resolved promise
* `retry(fn, retries?, delay?)` — retry function N times with delay
* `timeout(fn, ms)` — reject if function takes longer than `ms`
