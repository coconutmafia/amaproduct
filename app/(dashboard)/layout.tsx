import { Sidebar } from '@/components/layout/Sidebar'
import { Header } from '@/components/layout/Header'
import { AuthRefresh } from '@/components/shared/AuthRefresh'
import { PageTransition } from '@/components/shared/PageTransition'
import { BottomNav } from '@/components/layout/BottomNav'
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
    supabase
      .from('projects')
      .select('id, name, completeness_score')
      .eq('owner_id', userId)
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
        {/* pb-24 on mobile = space for the BottomNav */}
        <main className="flex-1 overflow-y-auto relative pb-24 lg:pb-0">
          <AuthRefresh />
          <PageTransition>{children}</PageTransition>
        </main>
      </div>

      {/* Bottom nav — mobile only */}
      <BottomNav />
    </div>
  )
}
