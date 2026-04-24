/**
 * Supabase admin client — использует service role key, не требует cookies/auth.
 * Применяется только на сервере для фоновых задач (after(), cron, etc.)
 * Никогда не экспортируй этот клиент на клиентскую сторону.
 */
import { createClient } from '@supabase/supabase-js'

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error('Missing Supabase admin credentials')
  }

  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
