'use client'

import { useState } from 'react'
import { Menu, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import { Sidebar } from './Sidebar'

interface MobileNavProps {
  user?: {
    name: string
    email: string
    avatar?: string
    role: string
  }
  projects?: Array<{ id: string; name: string; completeness_score: number }>
  isAdmin?: boolean
}

export function MobileNav({ user, projects, isAdmin }: MobileNavProps) {
  const [open, setOpen] = useState(false)

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger className="inline-flex items-center justify-center rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
        <Menu className="h-5 w-5" />
        <span className="sr-only">Открыть меню</span>
      </SheetTrigger>
      <SheetContent side="left" className="p-0 w-64">
        <Sidebar user={user} projects={projects} isAdmin={isAdmin} />
      </SheetContent>
    </Sheet>
  )
}
