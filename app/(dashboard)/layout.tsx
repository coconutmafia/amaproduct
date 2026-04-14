import { Sidebar } from '@/components/layout/Sidebar'
import { Header } from '@/components/layout/Header'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  const { data: projects } = await supabase
    .from('projects')
    .select('id, name, completeness_score')
    .eq('owner_id', user.id)
    .eq('status', 'active')
    .order('updated_at', { ascending: false })

  const isAdmin = profile?.role === 'admin'

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar — hidden on mobile */}
      <div className="hidden lg:flex">
        <Sidebar
          user={profile ? { name: profile.full_name || user.email || '', email: user.email || '', avatar: profile.avatar_url || undefined, role: profile.role } : undefined}
          projects={projects || []}
          isAdmin={isAdmin}
        />
      </div>

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header
          user={profile ? { name: profile.full_name || user.email || '', email: user.email || '', avatar: profile.avatar_url || undefined, role: profile.role } : undefined}
          projects={projects || []}
          isAdmin={isAdmin}
        />
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  )
}
