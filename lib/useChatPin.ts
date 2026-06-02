'use client'

import { useRef, useState, useEffect, useLayoutEffect } from 'react'

/**
 * ChatGPT-style scroll behaviour for a chat message list:
 *  - When you send a message, your question pins to the TOP of the scroll area
 *    and the answer streams in below it.
 *  - A dynamic tail spacer is sized so the question can always reach the top —
 *    it fills the empty space below a SHORT answer, and collapses to 0 for a
 *    LONG answer (no weird permanent gap).
 *
 * Wire it up:
 *   const { scrollRef, lastUserRef, endRef, tailSpace } = useChatPin(messages, streaming)
 *   <div ref={scrollRef} className="overflow-y-auto">
 *     {messages.map((m, i) => <div ref={isLastUser ? lastUserRef : undefined}>…</div>)}
 *     {streaming && <div>…</div>}
 *     <div ref={endRef} />
 *     <div aria-hidden style={{ height: tailSpace }} />
 *   </div>
 */
export function useChatPin(messages: { role: string }[], streaming: string) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const lastUserRef = useRef<HTMLDivElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const [tailSpace, setTailSpace] = useState(0)

  const lastRole = messages[messages.length - 1]?.role
  const count = messages.length

  // Size the tail spacer so the last question can sit at the top with one screen
  // below it. endRef sits BEFORE the spacer, so this measurement excludes the
  // spacer itself (no feedback loop).
  useLayoutEffect(() => {
    const c = scrollRef.current, q = lastUserRef.current, end = endRef.current
    if (!c || !q || !end || count === 0) { setTailSpace(0); return }
    const contentBelowQuestion = end.getBoundingClientRect().bottom - q.getBoundingClientRect().top
    // Enough tail room that the question can sit at the very top with one screen
    // below it; collapses to 0 once the answer alone is taller than a screen.
    const next = Math.max(0, c.clientHeight - contentBelowQuestion)
    setTailSpace(prev => (Math.abs(prev - next) > 1 ? next : prev))
  }, [count, streaming])

  // Pin the just-sent question to the top (explicit scrollTo — smooth
  // scrollIntoView overshoots on mobile webviews and pushed it off-screen).
  useEffect(() => {
    if (lastRole !== 'user') return
    requestAnimationFrame(() => {
      const c = scrollRef.current, q = lastUserRef.current
      if (!c || !q) return
      // The dashboard <main> can double-scroll on mobile (the chat root is taller
      // than <main>, esp. after the keyboard opens/closes). When <main> is left
      // scrolled, the sticky chat header overlaps the pinned message and you only
      // see its bottom sliver. Reset ancestor scrollers so ONLY the inner
      // messages container scrolls — the composer is fully visible at main top 0.
      for (let p = c.parentElement; p; p = p.parentElement) {
        if (p.scrollHeight > p.clientHeight + 1 && getComputedStyle(p).overflowY !== 'visible') {
          p.scrollTop = 0
        }
      }
      const top = q.getBoundingClientRect().top - c.getBoundingClientRect().top + c.scrollTop - 12
      // Instant (not smooth): a smooth animation is still running when the answer
      // starts streaming and the dynamic spacer resizes, which made it land on the
      // wrong part of a long message. Instant completes before that.
      c.scrollTo({ top: Math.max(0, top), behavior: 'auto' })
    })
  }, [count, lastRole])

  return { scrollRef, lastUserRef, endRef, tailSpace }
}
