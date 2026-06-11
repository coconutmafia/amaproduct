import { redirect } from 'next/navigation'

// «Виральные рилз» merged into «Тренды» (owner decision) — keep old deep links
// and bookmarks working.
export default async function ViralReelsRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  redirect(`/projects/${id}/trends`)
}
