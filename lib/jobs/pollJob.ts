'use client'

// Generic client-side poller for the background-jobs pattern (roadmap #8).
// Used by any UI that creates a job (POST /api/jobs/... or a route that
// enqueues one) and needs to wait for it to finish without holding a live
// SSE/streaming connection open — a locked/backgrounded phone just resumes
// polling once the tab wakes, instead of losing the in-flight request.
export function pollJob<TResult = Record<string, unknown>>(jobId: string): Promise<TResult> {
  let consecutiveFailures = 0
  const MAX_CONSECUTIVE_FAILURES = 30 // ~2 min of nothing-but-errors → genuinely give up
  return new Promise((resolve, reject) => {
    const poll = async () => {
      try {
        const res = await fetch(`/api/jobs/${jobId}`)
        const body = await res.json() as {
          job?: { status: string; result?: TResult; error?: string }
          error?: string
        }
        if (!res.ok || !body.job) { reject(new Error(body.error ?? 'Не удалось получить статус задачи')); return }
        consecutiveFailures = 0
        const { status, result, error } = body.job
        if (status === 'done') { resolve((result ?? {}) as TResult); return }
        if (status === 'error') { reject(new Error(error ?? 'Ошибка выполнения')); return }
        setTimeout(poll, 2500)
      } catch {
        // Transient network hiccup (e.g. tab just woke up) — keep polling
        // rather than failing the whole job over one dropped request.
        consecutiveFailures++
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          reject(new Error('Нет связи с сервером — проверь интернет и попробуй снова'))
          return
        }
        setTimeout(poll, 4000)
      }
    }
    poll()
  })
}
