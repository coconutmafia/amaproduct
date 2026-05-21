import type { SupabaseClient } from '@supabase/supabase-js'

interface MaterialUpsert {
  project_id:        string
  title:             string
  material_type:     string
  raw_content:       string
  processing_status: string
}

/**
 * Upsert a project material keyed on (project_id, material_type, title).
 *
 * The project_materials table has NO unique constraint on that triple, so
 * `.upsert(..., { onConflict: 'project_id,material_type,title' })` fails with
 * "there is no unique or exclusion constraint matching the ON CONFLICT
 * specification". This helper does a manual select → update-or-insert instead,
 * which needs no DB constraint.
 */
export async function upsertProjectMaterial(
  supabase: SupabaseClient,
  m: MaterialUpsert,
): Promise<{ error: { message: string } | null }> {
  const { data: existing } = await supabase
    .from('project_materials')
    .select('id')
    .eq('project_id', m.project_id)
    .eq('material_type', m.material_type)
    .eq('title', m.title)
    .maybeSingle()

  if (existing?.id) {
    const { error } = await supabase
      .from('project_materials')
      .update({ raw_content: m.raw_content, processing_status: m.processing_status })
      .eq('id', existing.id)
    return { error: error ? { message: error.message } : null }
  }

  const { error } = await supabase.from('project_materials').insert(m)
  return { error: error ? { message: error.message } : null }
}
