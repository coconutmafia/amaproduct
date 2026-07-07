import { createClient } from '@/lib/supabase/server'
import { getProjectRole } from '@/lib/projects/access'
import { ReadOnlyBanner } from '@/components/projects/ReadOnlyBanner'

// Wraps every /projects/[id]/* page. Its only job right now is to surface a
// read-only banner for VIEWER-role members (client access), so they immediately
// understand they can look but not edit. Owners/editors see nothing extra.
// getProjectRole short-circuits to 'owner' on the first query for owners, so
// this adds no cost for the common case. Access itself is enforced by RLS +
// the per-route checks — this layer is purely informational.
export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  let role: string | null = null
  if (user) role = await getProjectRole(supabase, id, user.id)

  return (
    <>
      {role === 'viewer' && <ReadOnlyBanner />}
      {children}
    </>
  )
}
