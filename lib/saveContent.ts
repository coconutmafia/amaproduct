'use client'

import { createClient } from '@/lib/supabase/client'

export interface SavedContentRow {
  id: string
  user_id: string
  project_id: string | null
  content_type: string | null
  title: string | null
  body: string
  created_at: string
}

/** Save a piece of approved content to the user's library ("Готовое"). */
export async function saveToLibrary(item: {
  body: string
  title?: string | null
  content_type?: string | null
  project_id?: string | null
}) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Не авторизован')

  const title = (item.title ?? item.body.split('\n').find(l => l.trim()) ?? '').slice(0, 100) || null

  const { error } = await supabase.from('saved_content').insert({
    user_id: user.id,
    body: item.body,
    title,
    content_type: item.content_type ?? null,
    project_id: item.project_id ?? null,
  })
  // Friendly hint if the table hasn't been created yet (migration pending).
  if (error) {
    if (/relation .*saved_content.* does not exist|could not find the table/i.test(error.message)) {
      throw new Error('Библиотека ещё не настроена (нужна миграция БД)')
    }
    throw new Error(error.message)
  }
}
