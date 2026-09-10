-- Cleanup: drops the harmless test table used to verify the GitHub ->
-- Supabase auto-deploy pipeline end-to-end. Served its purpose; confirmed
-- working 2026-09-10.
drop table if exists _deploy_verification;
