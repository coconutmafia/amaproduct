'use client'

import { motion } from 'framer-motion'
import { usePathname } from 'next/navigation'

export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <motion.div
      key={pathname}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      // h-full (not min-h-full) gives a DEFINITE height so full-screen pages
      // (chat) whose root is h-full resolve correctly and don't double-scroll.
      // Taller pages still overflow and scroll <main> as before.
      className="h-full"
    >
      {children}
    </motion.div>
  )
}
