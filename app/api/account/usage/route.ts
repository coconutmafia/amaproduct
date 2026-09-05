import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getUsageSummary } from '@/lib/billing/usageSummary'

export const dynamic = 'force-dynamic'

// GET — «Тариф и расход» текущего юзера: единицы, ресурс AI, на что ушло,
// на что хватит. Одна правда для настроек, главной и окна лимита.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const summary = await getUsageSummary(user.id)
    return NextResponse.json(summary)
  } catch {
    return NextResponse.json({ error: 'Не удалось загрузить расход — обнови страницу' }, { status: 500 })
  }
}
