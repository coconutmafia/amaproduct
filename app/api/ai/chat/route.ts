import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { anthropic, MODEL } from '@/lib/ai/client'
import { buildRAGContext, type RAGContext } from '@/lib/ai/rag'
import { buildSystemPrompt } from '@/lib/ai/prompts/system'
import type { Message } from '@/types'

// Required for AI responses — Claude can take 30-60 seconds
export const maxDuration = 60

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { messages, projectId, conversationType }: {
      messages: Message[]
      projectId: string
      conversationType: string
    } = await request.json()

    const { data: project } = await supabase
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .eq('owner_id', user.id)
      .single()

    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    const lastMessage = messages[messages.length - 1]?.content || ''
    let ragContext: RAGContext = { systemKnowledge: [], projectContext: [], styleExamples: [] }
    try {
      ragContext = await buildRAGContext(lastMessage, projectId)
    } catch {
      // RAG unavailable
    }

    const systemPrompt = buildSystemPrompt(ragContext, project)

    const stream = await anthropic.messages.stream({
      model: MODEL,
      max_tokens: 3000,
      system: systemPrompt,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    })

    const encoder = new TextEncoder()
    const readable = new ReadableStream({
      async start(controller) {
        for await (const chunk of stream) {
          if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
            controller.enqueue(encoder.encode(chunk.delta.text))
          }
        }
        controller.close()
      },
    })

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
      },
    })
  } catch (error) {
    console.error('Chat error:', error)
    const msg = error instanceof Error ? error.message : String(error)
    // Surface the real error to help diagnose (API key, model, etc.)
    return NextResponse.json({ error: msg || 'Chat failed' }, { status: 500 })
  }
}
