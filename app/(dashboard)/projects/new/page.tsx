import { ProjectWizard } from '@/components/projects/ProjectWizard'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

export default function NewProjectPage() {
  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild className="h-8 w-8">
          <Link href="/projects">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Новый проект</h1>
          <p className="text-sm text-muted-foreground">Заполните данные о блогере и продуктах</p>
        </div>
      </div>
      <ProjectWizard />
    </div>
  )
}
