import { useEffect, useRef } from 'react'

/**
 * Throttled callback scheduled through the visual refresh loop (rAF).
 * Safe to call on every delta — the callback runs only once per frame,
 * reducing DOM work during high-volume streaming updates.
 */
export function useThrottledVisualUpdate<T extends (...args: never[]) => void>(fn: T): T {
  const pending = useRef<number | null>(null)
  const latest = useRef<() => void>(fn as () => void)
  latest.current = fn as () => void

  useEffect(() => {
    return () => {
      if (pending.current !== null) cancelAnimationFrame(pending.current)
    }
  }, [])

  return ((..._args: never[]) => {
    if (pending.current !== null) return
    pending.current = requestAnimationFrame(() => {
      pending.current = null
      try { latest.current() } catch { /* visual update — swallow */ }
    })
  }) as T
}
