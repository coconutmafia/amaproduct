-- Связь материала product_description с продуктом (жалоба Ланы 03.09: продукты
-- нельзя менять после заведения проекта). До этого синк шёл по title — у двух
-- одноимённых продуктов правка/архив попадали бы не в тот материал. Код живёт
-- и без колонки (best-effort update + фолбэк по title) — миграция догоняет.
alter table project_materials
  add column if not exists source_product_id uuid references products(id) on delete set null;
create index if not exists idx_project_materials_source_product
  on project_materials(source_product_id) where source_product_id is not null;
