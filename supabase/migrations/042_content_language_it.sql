-- Итальянский язык контента первым классом (03.09, кастдевы итальянского
-- фотографа — вопрос Кристины). Расширяет check-констрейнт 038: без этого
-- PATCH с content_language='it' проходит валидацию роута и падает на БД.
alter table projects drop constraint if exists projects_content_language_check;
alter table projects add constraint projects_content_language_check
  check (content_language is null or content_language in ('ru', 'en', 'es', 'de', 'it'));
