'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { motion } from 'framer-motion'
import { LayoutDashboard, FolderKanban, Sparkles, Settings } from 'lucide-react'

export function BottomNav() {
  const pathname = usePathname()

  // Detect current project for deep-linking Generate
  const projectMatch = pathname.match(/\/projects\/([a-zA-Z0-9_-]+)/)
  const projectId = projectMatch?.[1]
  const isSpecialRoute = projectId === 'new'
  const generateHref = projectId && !isSpecialRoute
    ? `/projects/${projectId}/generator`
    : '/projects'

  const tabs = [
    {
      href: '/dashboard',
      icon: LayoutDashboard,
      label: 'Главная',
      isActive: (p: string) => p === '/dashboard',
      accent: false,
    },
    {
      href: '/projects',
      icon: FolderKanban,
      label: 'Проекты',
      isActive: (p: string) => p.startsWith('/projects') && !p.includes('/generator'),
      accent: false,
    },
    {
      href: generateHref,
      icon: Sparkles,
      label: 'Создать',
      isActive: (p: string) => p.includes('/generator'),
      accent: true,
    },
    {
      href: '/settings',
      icon: Settings,
      label: 'Настройки',
      isActive: (p: string) => p.startsWith('/settings'),
      accent: false,
    },
  ]

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 lg:hidden bg-white/95 backdrop-blur-xl border-t border-[#ECECEC]"
      style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}
    >
      <div className="flex items-end justify-around px-4 pt-2 pb-1">
        {tabs.map((tab) => {
          const active = tab.isActive(pathname)
          const Icon = tab.icon

          if (tab.accent) {
            return (
              <Link key={tab.href} href={tab.href}>
                <motion.div
                  whileTap={{ scale: 0.9 }}
                  className="flex flex-col items-center gap-1 -mt-5"
                >
                  <div
                    className="flex h-14 w-14 items-center justify-center rounded-2xl shadow-lg"
                    style={{ background: '#3A8A48', boxShadow: '0 4px 20px rgba(58,138,72,0.45)' }}
                  >
                    <Icon className="h-6 w-6 text-white" />
                  </div>
                  <span className="text-[10px] font-semibold text-[#3A8A48]">{tab.label}</span>
                </motion.div>
              </Link>
            )
          }

          return (
            <Link key={tab.href} href={tab.href}>
              <motion.div
                whileTap={{ scale: 0.88 }}
                className="relative flex flex-col items-center gap-1 px-3 py-1 min-w-[56px]"
              >
                <Icon
                  className="h-[22px] w-[22px] transition-colors"
                  style={{ color: active ? '#3A8A48' : '#B0B0B0' }}
                  strokeWidth={active ? 2.2 : 1.8}
                />
                <span
                  className="text-[10px] font-medium transition-colors"
                  style={{ color: active ? '#3A8A48' : '#B0B0B0' }}
                >
                  {tab.label}
                </span>
                {active && (
                  <motion.div
                    layoutId="bottom-nav-dot"
                    className="absolute -top-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-[#3A8A48]"
                    transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                  />
                )}
              </motion.div>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
