// Server-only. ONE guard for every endpoint that spends money (Claude / OpenAI /
// Apify / Whisper).
//
// Why this exists: metering (gateContentUnit) answers «сколько единиц осталось»,
// but only 3 routes called it — so an un-entitled user was blocked from the
// «Сгенерировать» button while ~24 other AI endpoints stayed wide open (free
// chat that writes full posts, competitor analysis, edits, transcription,
// images, scraping). Under the «плати сразу» model that's a complete bypass of
// payment. ACCESS and METERING are different questions:
//   * requirePaidAccess — may this user touch AI at all?  → every paid endpoint
//   * gateContentUnit   — does this finished unit fit the quota? → only routes
//                          that produce a countable content unit
// A paying user's free chat/edits stay unmetered (fair use) — this guard only
// keeps out people without a plan.
import { NextResponse } from 'next/server'
import { BILLING_ENFORCED, isEntitled } from '@/lib/generations'
import { setUsageUser } from '@/lib/ai/usageContext'
import { checkBudgetCap } from '@/lib/billing/costCap'

// Returns a 402 Response to return early, or null when the user may proceed.
// Inert while BILLING_ENFORCED is off, and fail-OPEN inside isEntitled — an
// infra hiccup must never lock out a paying customer.
export async function requirePaidAccess(userId: string): Promise<NextResponse | null> {
  // Помечаем контекст запроса: журнал ai_usage подхватит user_id сам, без
  // протягивания его через все места вызова Claude (см. lib/ai/usageContext).
  setUsageUser(userId)
  if (!BILLING_ENFORCED) return null
  if (!(await isEntitled(userId))) {
    // Same code the client already maps to «Выбери тариф, чтобы начать».
    return NextResponse.json(
      { error: 'payment_required', code: 'payment_required' },
      { status: 402 },
    )
  }
  // Долларовый кап месяца НА ОБЩЕЙ ДВЕРИ: requirePaidAccess стоит у КАЖДОГО
  // платного AI-роута, включая неметереные (ToV, автозаполнение мастера) —
  // свип 29.08 показал, что кап только в гейтах юнитов оставляет их без
  // потолка. Дубль с проверкой в гейтах не вреден (fail-open, один select).
  const budget = await checkBudgetCap(userId)
  if (budget.blocked) {
    return NextResponse.json(
      { error: 'limit_reached', code: 'limit_reached' },
      { status: 402 },
    )
  }
  return null
}
