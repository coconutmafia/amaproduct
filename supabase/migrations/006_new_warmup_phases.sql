-- Add new warmup phases: niche, expert, product, objections
-- (in addition to legacy: awareness, trust, desire, close)

ALTER TABLE content_items
  DROP CONSTRAINT IF EXISTS content_items_warmup_phase_check;

ALTER TABLE content_items
  ADD CONSTRAINT content_items_warmup_phase_check
  CHECK (warmup_phase IN ('awareness', 'trust', 'desire', 'close', 'niche', 'expert', 'product', 'objections', 'activation'));
