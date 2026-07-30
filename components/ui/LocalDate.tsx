'use client'

import { useEffect, useState } from 'react'
import { fmtDateRu, fmtDateTimeRu, fmtDateLocalRu, fmtDateTimeLocalRu } from '@/lib/dates'

interface LocalDateProps {
  ts: string | number | Date
  opts?: Intl.DateTimeFormatOptions
  withTime?: boolean
}

// Дата в зоне ЗРИТЕЛЯ для данных, которые рендерятся уже при SSR (пропсы с
// серверной страницы). SSR и первый клиентский рендер дают ОДИНАКОВУЮ
// детерминированную строку (Москва) — гидрации не на чем разойтись; после
// маунта строка заменяется на локальную зону браузера. Для данных, приходящих
// после маунта, компонент не нужен — там сразу fmtDateLocalRu (см. lib/dates).
export function LocalDate({ ts, opts, withTime }: LocalDateProps) {
  const [text, setText] = useState(() =>
    withTime ? fmtDateTimeRu(ts, opts) : fmtDateRu(ts, opts)
  )
  useEffect(() => {
    setText(withTime ? fmtDateTimeLocalRu(ts, opts) : fmtDateLocalRu(ts, opts))
    // opts на call-site — литерал; сериализованный ts стабилен как зависимость.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [String(ts), withTime])
  return <>{text}</>
}
