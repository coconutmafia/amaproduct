// Server-only. Кто именно тратит деньги провайдера — для отчёта «по клиентам
// с маржой» (usage-report). Обёртка вокруг Anthropic живёт слишком глубоко и
// про юзера не знает, а протягивать userId через 29 мест вызова — это 29 мест,
// где его забудут. Поэтому один раз кладём id в контекст запроса, и журнал его
// подхватывает сам.
//
// enterWith (а не run с колбэком) — потому что нам нужно пометить УЖЕ идущий
// асинхронный контекст, не переписывая роуты в обёртки. Работает и в
// request-контексте, и внутри фонового джоба.
import { AsyncLocalStorage } from 'node:async_hooks'

export const usageContext = new AsyncLocalStorage<{ userId?: string }>()

// Fail-open: учёт не имеет права ломать продукт. Не получилось пометить —
// строка просто ляжет без user_id, и это видно в отчёте.
export function setUsageUser(userId?: string | null): void {
  if (!userId) return
  try {
    usageContext.enterWith({ userId })
  } catch { /* нет поддержки контекста — пишем без юзера */ }
}

export function currentUsageUser(): string | null {
  try {
    return usageContext.getStore()?.userId ?? null
  } catch {
    return null
  }
}
