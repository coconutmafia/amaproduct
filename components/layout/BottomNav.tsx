'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { motion } from 'framer-motion'
import { LayoutDashboard, FolderKanban, Sparkles, Settings } from 'lucide-react'

export function BottomNav() {
  const pathname = usePathname()

  // "Создать" → standalone quick-generation chat (works without a project)
  const generateHref = '/create'

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
      isActive: (p: string) => p === '/create',
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
