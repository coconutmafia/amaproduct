'use client'

import { Film } from 'lucide-react'
import { ViralReelsManager } from '@/components/projects/ViralReelsManager'

export default function AdminViralReelsPage() {
  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-5">
      <div className="flex items-center gap-2">
        <Film className="h-5 w-5 text-primary" />
        <h1 className="text-lg font-bold text-foreground">Виральные рилз (для всех)</h1>
      </div>
      <ViralReelsManager scope="system" />
    </div>
  )
}
