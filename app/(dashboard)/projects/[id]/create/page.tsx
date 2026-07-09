'use client'

import { useParams, useSearchParams } from 'next/navigation'
import { ContentStudio } from '@/components/content/ContentStudio'

type Format = 'post' | 'carousel' | 'stories'

export default function CreateContentPage() {
  const { id } = useParams<{ id: string }>()
  const sp = useSearchParams()
  const fmt = sp.get('format')
  const initialFormat: Format = fmt === 'carousel' || fmt === 'stories' ? fmt : 'post'
  const initialText = sp.get('text') || ''
  return <ContentStudio projectId={id} initialFormat={initialFormat} initialText={initialText} />
}
