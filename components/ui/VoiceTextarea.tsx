'use client'

import { useRef } from 'react'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { VoiceRecordButton } from '@/components/ui/VoiceRecordButton'

interface VoiceTextareaProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  rows?: number
  className?: string
}

// Textarea with a reliable "record → Whisper" voice button (works in iOS Safari
// and in-app webviews, unlike the browser Web Speech API).
export function VoiceTextarea({ value, onChange, placeholder, rows = 3, className }: VoiceTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const appendText = (t: string) => {
    onChange(value ? `${value} ${t}` : t)
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (el) { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 280)}px` }
    })
  }

  return (
    <div className="space-y-1.5">
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className={cn(className)}
      />
      <VoiceRecordButton
        onText={appendText}
        label
        className="w-full h-9 gap-2 text-xs font-medium !rounded-lg bg-secondary border-border text-muted-foreground hover:text-foreground"
        size={14}
      />
    </div>
  )
}
