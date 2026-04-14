'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import CharacterCount from '@tiptap/extension-character-count'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  Bold, Italic, Underline as UnderlineIcon, List, Quote,
  Heading2, Minus, AlignLeft, Code
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface ContentEditorProps {
  content: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}

export function ContentEditor({ content, onChange, placeholder, className }: ContentEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: placeholder || 'Начните писать или вставьте текст...' }),
      CharacterCount,
    ],
    content,
    onUpdate: ({ editor }) => {
      onChange(editor.getText())
    },
    editorProps: {
      attributes: {
        class: 'tiptap-editor min-h-[200px] p-4 focus:outline-none text-sm text-foreground leading-relaxed',
      },
    },
  })

  if (!editor) return null

  const toolbarButtons = [
    {
      icon: Bold,
      action: () => editor.chain().focus().toggleBold().run(),
      active: editor.isActive('bold'),
      title: 'Жирный',
    },
    {
      icon: Italic,
      action: () => editor.chain().focus().toggleItalic().run(),
      active: editor.isActive('italic'),
      title: 'Курсив',
    },
    {
      icon: Heading2,
      action: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
      active: editor.isActive('heading', { level: 2 }),
      title: 'Заголовок',
    },
    {
      icon: List,
      action: () => editor.chain().focus().toggleBulletList().run(),
      active: editor.isActive('bulletList'),
      title: 'Список',
    },
    {
      icon: Quote,
      action: () => editor.chain().focus().toggleBlockquote().run(),
      active: editor.isActive('blockquote'),
      title: 'Цитата',
    },
    {
      icon: Code,
      action: () => editor.chain().focus().toggleCode().run(),
      active: editor.isActive('code'),
      title: 'Код',
    },
    {
      icon: Minus,
      action: () => editor.chain().focus().setHorizontalRule().run(),
      active: false,
      title: 'Разделитель',
    },
  ]

  const charCount = editor.storage.characterCount?.characters?.() || 0

  return (
    <div className={cn('rounded-xl border border-border overflow-hidden bg-card', className)}>
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-border bg-secondary/30">
        {toolbarButtons.map(({ icon: Icon, action, active, title }) => (
          <Button
            key={title}
            variant="ghost"
            size="icon"
            onClick={action}
            title={title}
            className={cn(
              'h-7 w-7 rounded-md',
              active ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Icon className="h-3.5 w-3.5" />
          </Button>
        ))}
        <Separator orientation="vertical" className="mx-1 h-5" />
        <span className="ml-auto text-xs text-muted-foreground">{charCount} симв.</span>
      </div>

      {/* Editor */}
      <EditorContent editor={editor} className="tiptap-editor" />
    </div>
  )
}
