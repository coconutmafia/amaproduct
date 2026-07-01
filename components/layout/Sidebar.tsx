'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard,
  FolderKanban,
  BookOpen,
  Settings,
  ChevronDown,
  ChevronRight,
  Plus,
  LogOut,
  Sparkles,
  Zap,
  Users,
  TrendingUp,
  BarChart3,
  Film,
  Layers,
  Bookmark,
} from 'lucide-react'
import { useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'

interface SidebarProps {
  user?: {
    name: string
    email: string
    avatar?: string
    role: string
  }
  projects?: Array<{ id: string; name: string; completeness_score: number }>
  isAdmin?: boolean
  onNavigate?: () => void
}

export function Sidebar({ user, projects = [], isAdmin = false, onNavigate }: SidebarProps) {
  const pathname = usePathname()
  const [projectsOpen, setProjectsOpen] = useState(true)

  const handleLogout = useCallback(async () => {
    try {
      const supabase = createClient()
      await supabase.auth.signOut()
    } catch {
      // ignore
    }
    window.location.href = '/'
  }, [])

  const navItems = [
    {
      href: '/dashboard',
      icon: LayoutDashboard,
      label: 'Главная',
    },
    {
      href: '/create',
      icon: Sparkles,
      label: 'Создать',
    },
    {
      href: '/library',
      icon: Bookmark,
      label: 'Готовое',
    },
  ]

  const bottomNavItems = [
    {
      href: '/pricing',
      icon: Zap,
      label: 'Тарифы',
      badge: null as string | null,
    },
    // «Твои бонусы» (/referral) скрыт до пересборки реферальной системы вместе
    // с биллингом — бонусные запросы сейчас ничего не дают. Роут жив.
    {
      href: '/settings',
      icon: Settings,
      label: 'Настройки',
      badge: null as string | null,
    },
  ]

  return (
    <motion.aside
      initial={{ x: -20, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="flex h-full w-64 flex-col border-r border-border bg-sidebar"
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-sidebar-border">
        <motion.div
          whileHover={{ rotate: [0, -10, 10, 0], scale: 1.05 }}
          transition={{ duration: 0.4 }}
          className="flex h-9 w-9 items-center justify-center rounded-xl gradient-accent shadow-lg cursor-default"
        >
          <Sparkles className="h-5 w-5 text-white" />
        </motion.div>
        <div>
          <p className="text-sm font-bold text-sidebar-foreground tracking-wide">AMAproduct</p>
          <p className="text-xs text-muted-foreground">AI-Продюсер</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto min-h-0 px-3 py-4 space-y-1">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => onNavigate?.()}
            className={cn(
              'relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
              pathname === item.href
                ? 'text-[#D44E7E] font-medium'
                : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
            )}
          >
            {pathname === item.href && (
              <motion.div
                layoutId="sidebar-active"
                className="absolute inset-0 rounded-lg bg-[#F5A84A]/15"
                transition={{ type: 'spring', stiffness: 400, damping: 35 }}
              />
            )}
            <item.icon className="h-4 w-4 shrink-0 relative z-10" />
            <span className="relative z-10">{item.label}</span>
          </Link>
        ))}

        {/* Projects collapsible */}
        <Collapsible open={projectsOpen} onOpenChange={setProjectsOpen}>
          <CollapsibleTrigger className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors">
            <span className="flex items-center gap-3">
              <FolderKanban className="h-4 w-4" />
              Проекты
            </span>
            {projectsOpen ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </CollapsibleTrigger>
          <CollapsibleContent className="ml-4 mt-1 space-y-0.5 border-l border-border pl-3">
            {projects.map((project) => (
              <div key={project.id}>
                <Link
                  href={`/projects/${project.id}`}
                  onClick={() => onNavigate?.()}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors',
                    pathname.startsWith(`/projects/${project.id}`)
                      ? 'bg-[#F5A84A]/15 text-[#D44E7E] font-medium'
                      : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
                  )}
                >
                  <span className="truncate">{project.name}</span>
                  <span className="ml-auto text-[10px] text-muted-foreground">
                    {project.completeness_score}%
                  </span>
                </Link>
                {/* Sub-links for active project */}
                {pathname.startsWith(`/projects/${project.id}`) && (
                  <div className="ml-3 mt-0.5 space-y-0.5 border-l border-border/50 pl-2">
                    {[
                      { href: `/projects/${project.id}/assistant`, label: '✦ Создать контент' },
                      { href: `/projects/${project.id}/content-plan`, label: '✦ Контент-план' },
                      { href: `/projects/${project.id}/trends`, label: '✦ Тренды' },
                    ].map((sub) => (
                      <Link
                        key={sub.href}
                        href={sub.href}
                        onClick={() => onNavigate?.()}
                        className={cn(
                          'block rounded px-2 py-1 text-[10px] transition-colors',
                          pathname === sub.href
                            ? 'text-[#D44E7E] font-medium'
                            : 'text-muted-foreground hover:text-foreground'
                        )}
                      >
                        {sub.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            ))}
            <Link
              href="/projects/new"
              onClick={() => onNavigate?.()}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:text-[#D44E7E] transition-colors"
            >
              <Plus className="h-3 w-3" />
              Новый проект
            </Link>
          </CollapsibleContent>
        </Collapsible>

        {/* Admin-only Knowledge Vault */}
        {isAdmin && (
          <Link
            href="/knowledge-vault"
            onClick={() => onNavigate?.()}
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
              pathname === '/knowledge-vault'
                ? 'bg-primary/20 text-primary font-medium'
                : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
            )}
          >
            <BookOpen className="h-4 w-4 shrink-0" />
            База знаний
            <span className="ml-auto text-[10px] bg-[#F5A84A]/20 text-[#D44E7E] px-1.5 py-0.5 rounded-full">
              Admin
            </span>
          </Link>
        )}

        {/* Admin: Users management */}
        {isAdmin && (
          <Link
            href="/admin/users"
            onClick={() => onNavigate?.()}
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
              pathname === '/admin/users'
                ? 'bg-primary/20 text-primary font-medium'
                : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
            )}
          >
            <Users className="h-4 w-4 shrink-0" />
            Пользователи
            <span className="ml-auto text-[10px] bg-[#F5A84A]/20 text-[#D44E7E] px-1.5 py-0.5 rounded-full">
              Admin
            </span>
          </Link>
        )}

        {/* Admin: promo codes */}
        {isAdmin && (
          <Link
            href="/admin/promo"
            onClick={() => onNavigate?.()}
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
              pathname === '/admin/promo'
                ? 'bg-primary/20 text-primary font-medium'
                : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
            )}
          >
            <Zap className="h-4 w-4 shrink-0" />
            Промо-коды
            <span className="ml-auto text-[10px] bg-[#F5A84A]/20 text-[#D44E7E] px-1.5 py-0.5 rounded-full">
              Admin
            </span>
          </Link>
        )}

        {/* Admin: analytics */}
        {isAdmin && (
          <Link
            href="/admin/analytics"
            onClick={() => onNavigate?.()}
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
              pathname === '/admin/analytics'
                ? 'bg-primary/20 text-primary font-medium'
                : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
            )}
          >
            <BarChart3 className="h-4 w-4 shrink-0" />
            Аналитика
            <span className="ml-auto text-[10px] bg-[#F5A84A]/20 text-[#D44E7E] px-1.5 py-0.5 rounded-full">Admin</span>
          </Link>
        )}

        {/* Admin: viral reels */}
        {isAdmin && (
          <Link
            href="/admin/viral-reels"
            onClick={() => onNavigate?.()}
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
              pathname === '/admin/viral-reels'
                ? 'bg-primary/20 text-primary font-medium'
                : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
            )}
          >
            <Film className="h-4 w-4 shrink-0" />
            Виральные рилз
            <span className="ml-auto text-[10px] bg-[#F5A84A]/20 text-[#D44E7E] px-1.5 py-0.5 rounded-full">Admin</span>
          </Link>
        )}

        {/* Admin: content trends */}
        {isAdmin && (
          <Link
            href="/admin/trends"
            onClick={() => onNavigate?.()}
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
              pathname === '/admin/trends'
                ? 'bg-primary/20 text-primary font-medium'
                : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
            )}
          >
            <TrendingUp className="h-4 w-4 shrink-0" />
            Тренды месяца
            <span className="ml-auto text-[10px] bg-[#F5A84A]/20 text-[#D44E7E] px-1.5 py-0.5 rounded-full">
              Admin
            </span>
          </Link>
        )}

        {/* Admin: context inspector — what reaches generation per project */}
        {isAdmin && (
          <Link
            href="/admin/context-inspector"
            onClick={() => onNavigate?.()}
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
              pathname === '/admin/context-inspector'
                ? 'bg-primary/20 text-primary font-medium'
                : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
            )}
          >
            <Layers className="h-4 w-4 shrink-0" />
            Инспектор контекста
            <span className="ml-auto text-[10px] bg-[#F5A84A]/20 text-[#D44E7E] px-1.5 py-0.5 rounded-full">
              Admin
            </span>
          </Link>
        )}

        <div className="pt-2 border-t border-border mt-2">
          {bottomNavItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => onNavigate?.()}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                pathname === item.href
                  ? 'bg-primary/20 text-primary font-medium'
                  : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
              )}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {item.label}
              {'badge' in item && item.badge && (
                <span className="ml-auto text-[10px] bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded-full font-medium">
                  {item.badge}
                </span>
              )}
            </Link>
          ))}
        </div>
      </nav>

      {/* User profile + logout */}
      {user && (
        <div className="border-t border-sidebar-border p-3 space-y-2">
          <div className="flex items-center gap-3 rounded-lg px-2 py-2">
            <Avatar className="h-8 w-8">
              <AvatarImage src={user.avatar} />
              <AvatarFallback className="bg-[#F5A84A]/20 text-[#D44E7E] text-xs font-bold">
                {user.name?.charAt(0)?.toUpperCase() || 'U'}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-foreground truncate">{user.name}</p>
              <p className="text-[10px] text-muted-foreground truncate">{user.email}</p>
            </div>
          </div>
          {/* Prominent logout button */}
          <motion.button
            whileHover={{ x: 3 }}
            whileTap={{ scale: 0.97 }}
            onClick={handleLogout}
            className="flex items-center gap-2 w-full rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors text-left"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            Выйти из аккаунта
          </motion.button>
        </div>
      )}
    </motion.aside>
  )
}
