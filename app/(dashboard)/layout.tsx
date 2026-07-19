import { Sidebar } from '@/components/layout/Sidebar'
import { Header } from '@/components/layout/Header'
import { AuthRefresh } from '@/components/shared/AuthRefresh'
import { PageTransition } from '@/components/shared/PageTransition'
import { BottomNav } from '@/components/layout/BottomNav'
import { TrialBanner } from '@/components/billing/TrialBanner'
import { UpgradeDialogHost } from '@/components/billing/UpgradeDialog'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()

  // getSession() читает из куки без сетевого запроса — надёжнее в production
  const { data: { session } } = await supabase.auth.getSession()

  if (!session?.user) {
    redirect('/login')
  }

  const userId = session.user.id
  const userEmail = session.user.email || ''

  // Параллельно загружаем профиль и проекты
  const [{ data: profile }, { data: projects }] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', userId).single(),
    // RLS (projects_select, migration 025) scopes this to owned + member
    // projects — no app-layer owner_id filter needed.
    supabase
      .from('projects')
      .select('id, name, completeness_score')
      .eq('status', 'active')
      .order('updated_at', { ascending: false }),
  ])

  const isAdmin = profile?.role === 'admin'

  return (
    <div className="flex overflow-hidden" style={{ height: '100dvh' }}>
      {/* Sidebar — hidden on mobile */}
      <div className="hidden lg:flex">
        <Sidebar
          user={{
            name: profile?.full_name || userEmail,
            email: userEmail,
            avatar: profile?.avatar_url || undefined,
            role: profile?.role || 'client',
          }}
          projects={projects || []}
          isAdmin={isAdmin}
        />
      </div>

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header
          user={{
            name: profile?.full_name || userEmail,
            email: userEmail,
            avatar: profile?.avatar_url || undefined,
            role: profile?.role || 'client',
          }}
          projects={projects || []}
          isAdmin={isAdmin}
        />
        <TrialBanner
          status={(profile as Record<string, unknown>)?.subscription_status as string | undefined}
          trialEndsAt={(profile as Record<string, unknown>)?.trial_ends_at as string | undefined}
        />
        {/* Отступ снизу = место под фиксированную BottomNav.
            ⚠️ Было жёстко pb-24 (96px), и этого НЕ хватало: сама BottomNav —
            это ~60px содержимого ПЛЮС её собственный `max(12px,
            env(safe-area-inset-bottom))`. На айфоне с «домашней полоской»
            (34px) панель занимает ~94px, то есть запас был 2 пикселя, а в
            in-app браузере (Telegram/Instagram) уходил в минус — последний
            элемент страницы оказывался ПОД панелью и его нельзя было нажать.
            Поймано на видео от клиента 19 июля: кнопка «Сохранить в материалы»
            на разборе интервью была разрезана панелью пополам.
            Теперь отступ учитывает safe-area так же, как сама панель. */}
        <main className="flex-1 overflow-y-auto relative pb-[calc(6rem_+_env(safe-area-inset-bottom))] lg:pb-0">
          <AuthRefresh />
          <PageTransition>{children}</PageTransition>
        </main>
      </div>

      {/* Bottom nav — mobile only */}
      <BottomNav />

      {/* Upgrade dialog — opened via showUpgrade() from the banner or 402 handlers */}
      <UpgradeDialogHost />
    </div>
  )
}
