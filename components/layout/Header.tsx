'use client'

import { Moon, Sun, Bell, Search } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MobileNav } from './MobileNav'

interface HeaderProps {
  title?: string
  user?: {
    name: string
    email: string
    avatar?: string
    role: string
  }
  projects?: Array<{ id: string; name: string; completeness_score: number }>
  isAdmin?: boolean
  actions?: React.ReactNode
}

export function Header({ title, user, projects, isAdmin, actions }: HeaderProps) {
  const { theme, setTheme } = useTheme()

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-4 border-b border-border bg-background/80 backdrop-blur-sm px-4 lg:px-6">
      {/* Mobile nav toggle */}
      <div className="lg:hidden">
        <MobileNav user={user} projects={projects} isAdmin={isAdmin} />
      </div>

      {/* Title */}
      {title && (
        <h1 className="text-sm font-semibold text-foreground hidden sm:block">{title}</h1>
      )}

      {/* Search */}
      <div className="relative flex-1 max-w-sm hidden md:block">
        <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          placeholder="Поиск..."
          className="pl-8 h-8 text-sm bg-secondary border-border"
        />
      </div>

      <div className="ml-auto flex items-center gap-2">
        {actions}

        {/* Theme toggle */}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        >
          <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          <span className="sr-only">Переключить тему</span>
        </Button>

        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
          <Bell className="h-4 w-4" />
        </Button>
      </div>
    </header>
  )
}
