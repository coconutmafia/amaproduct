'use client'

import { use } from 'react'
import Link from 'next/link'
import { ArrowLeft, Film } from 'lucide-react'
import { ViralReelsManager } from '@/components/projects/ViralReelsManager'

export default function ProjectViralReelsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-5">
      <div className="flex items-center gap-3">
        <Link href={`/projects/${id}`} className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-secondary"><ArrowLeft className="h-4 w-4" /></Link>
        <div>
          <h1 className="text-lg font-bold text-foreground flex items-center gap-2"><Film className="h-4 w-4 text-primary" /> Виральные рилз</h1>
          <p className="text-xs text-muted-foreground">Залетевшие рилз → AI вплетёт их формат в твой план</p>
        </div>
      </div>
      <ViralReelsManager scope="project" projectId={id} />
    </div>
  )
}
