import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import LandingPage from '@/components/landing/LandingPage'

export const metadata = {
  title: 'AMA — AI SMM-ассистент для экспертов',
  description: 'Твой личный AI SMM-щик, который пишет как ты. План прогрева за 8 минут. Посты, рилсы, сториз — одним кликом.',
}

export default async function Home() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) redirect('/dashboard')
  return <LandingPage />
}
