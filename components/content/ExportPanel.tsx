'use client'

import { Button } from '@/components/ui/button'
import { FileText, File, Clipboard, CheckCircle } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import type { ContentItem } from '@/types'

interface ExportPanelProps {
  content: ContentItem
}

export function ExportPanel({ content }: ExportPanelProps) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      const { copyToClipboard } = await import('@/lib/utils/export')
      await copyToClipboard(content)
      setCopied(true)
      toast.success('Скопировано в буфер обмена')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Ошибка копирования')
    }
  }

  async function handlePDF() {
    try {
      const { exportToPDF } = await import('@/lib/utils/export')
      await exportToPDF(content)
      toast.success('PDF создан')
    } catch {
      toast.error('Ошибка создания PDF')
    }
  }

  async function handleDOCX() {
    try {
      const { exportToDOCX } = await import('@/lib/utils/export')
      await exportToDOCX(content)
      toast.success('DOCX создан')
    } catch {
      toast.error('Ошибка создания DOCX')
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        className="h-8 border-border text-xs"
        onClick={handleCopy}
      >
        {copied ? (
          <CheckCircle className="mr-1.5 h-3.5 w-3.5 text-green-400" />
        ) : (
          <Clipboard className="mr-1.5 h-3.5 w-3.5" />
        )}
        Копировать
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="h-8 border-border text-xs"
        onClick={handlePDF}
      >
        <File className="mr-1.5 h-3.5 w-3.5" />
        PDF
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="h-8 border-border text-xs"
        onClick={handleDOCX}
      >
        <FileText className="mr-1.5 h-3.5 w-3.5" />
        DOCX
      </Button>
    </div>
  )
}
