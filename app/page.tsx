import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import LandingPage from '@/components/landing/LandingPage'

export const metadata = {
  title: 'AMA — AI-продюсер для блогеров и экспертов',
  description: 'Личный AI-продюсер: пишет контент в твоём голосе и делает визуал в твоём стиле — карусели, посты, сторис. План прогрева за 8 минут.',
}

export default async function Home() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) redirect('/dashboard')
  return <LandingPage />
}
