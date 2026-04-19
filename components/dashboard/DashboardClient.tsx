'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { OnboardingSlides } from '@/components/shared/OnboardingSlides'

interface Props {
  userId: string
  onboardingDone: boolean
}

export function DashboardClient({ userId, onboardingDone }: Props) {
  const router = useRouter()
  const [showOnboarding, setShowOnboarding] = useState(!onboardingDone)

  if (!showOnboarding) return null

  return (
    <OnboardingSlides
      userId={userId}
      onComplete={() => {
        setShowOnboarding(false)
        router.refresh()
      }}
    />
  )
}
