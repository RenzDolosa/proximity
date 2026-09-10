-- One-off, harmless table used only to verify that the GitHub -> Supabase
-- integration actually auto-deploys migrations pushed to main. Safe to
-- drop once verified (see companion cleanup migration after confirming).
create table if not exists _deploy_verification (
  id           integer generated always as identity primary key,
  verified_at  timestamptz not null default now(),
  note         text
);

insert into _deploy_verification (note)
values ('GitHub -> Supabase auto-deploy end-to-end test');
