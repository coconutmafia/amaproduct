-- 038: язык контента блога — явная настройка проекта.
--
-- ЗАЧЕМ: клиенты ведут блоги не только на русском (Darina Komorowski — английский,
-- Katia Ustina — испанский; решение Матвея 13.08: поддерживаем en/es/de). До этой
-- миграции язык генерации «плавал»: он выводился из языка Tone of Voice («Язык
-- ответа: тот, на котором написан TOV»), а материалы у клиентов смешанные
-- (кастдевы русские, блог английский) — язык контента прыгал.
--
-- NULL = поведение как раньше (язык TOV, иначе русский) — ни один существующий
-- проект не меняет поведения от наката этой миграции.
alter table public.projects
  add column if not exists content_language text
  constraint projects_content_language_check
  check (content_language in ('ru', 'en', 'es', 'de'));

comment on column public.projects.content_language is
  'Язык контента блога: ru/en/es/de. NULL = как раньше (язык TOV, иначе русский). Расширение списка — новая миграция.';
