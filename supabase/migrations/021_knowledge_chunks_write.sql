-- CRITICAL: knowledge_chunks had ONLY a SELECT policy (001:261). With RLS on and
-- no INSERT policy, every write from the admin upload (which runs under the admin
-- USER session, not service_role) was silently denied → the system methodology
-- vault was NEVER chunked/embedded. knowledge_chunks stayed empty, so the moat's
-- foundation layer (systemKnowledge in rag.ts) never reached generation. This has
-- been broken since the initial schema. Add an admin write policy so admin uploads
-- actually vectorize. The existing "Authenticated can read" SELECT policy stays
-- (RAG read), and multiple policies are OR'd, so reads are unaffected.
DROP POLICY IF EXISTS "Admin manages knowledge chunks" ON knowledge_chunks;
CREATE POLICY "Admin manages knowledge chunks" ON knowledge_chunks
  FOR ALL
  USING      (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
