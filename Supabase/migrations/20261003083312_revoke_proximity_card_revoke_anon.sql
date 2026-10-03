-- 20261003060125_revoke_card_employee_status recreated revoke_proximity_card()
-- and revoked PUBLIC, but Supabase's default privileges also grant EXECUTE to
-- anon directly, which REVOKE ... FROM PUBLIC does not remove. The function's
-- own admin/manager check already rejects anonymous callers; this removes the
-- endpoint from anon entirely (defense in depth).
--
-- Applied live as migration version 20261003083312.
REVOKE ALL ON FUNCTION public.revoke_proximity_card(uuid, text, text) FROM anon;
