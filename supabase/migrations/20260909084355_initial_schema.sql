-- ═══════════════════════════════════════════════════════════════════════════
-- Proximity: MySQL -> Postgres/Supabase migration
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ARCHITECTURE CHANGE FROM THE ORIGINAL APP:
--
-- The MySQL version isolated tenants by creating a whole separate physical
-- database per user (config/config.php: createDatabase(), USER_DB_PREFIX).
-- Postgres/Supabase doesn't support that pattern the same way (one Supabase
-- project = one Postgres database), so per your direction this migration
-- moves to the standard Supabase pattern instead:
--
--   - ONE shared schema/database
--   - every tenant-owned table gets a `user_id` column
--   - Row Level Security (RLS) enforces isolation at the database layer,
--     not just in app-level WHERE clauses
--
-- IMPORTANT SIDE EFFECT: in the old design, `employees.qr_code` and
-- `code.qr_code` were UNIQUE *within a user's own database*, so two
-- different users could each have their own code "A1B2C3" with zero
-- conflict — the databases never touched. Now that everyone shares one
-- table, a bare UNIQUE(qr_code) would be wrong: User B would get an error
-- reassigning a code number User A also happens to use. So those uniques
-- become composite: UNIQUE (user_id, qr_code). Same scoping applies to
-- user_groups.group_number/group_name, which were global before and stay
-- global here (that table was never per-tenant to begin with).
--
-- AUTH NOTE: this app does its own username/password auth in `users` and
-- does not use Supabase Auth. RLS policies below key off a Postgres session
-- variable, `app.current_user_id`, which the PHP connection layer must set
-- with `SET LOCAL app.current_user_id = '<id>'` at the start of every
-- authenticated request's transaction. Until that connection-layer change
-- ships, RLS will correctly deny all rows (fail closed) rather than allow
-- all rows — safe default, but the app won't work until that's wired up.
--
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- Helper: read the current app-level user id set by the PHP connection layer
-- ───────────────────────────────────────────────────────────────────────────
create or replace function app_current_user_id() returns integer
language sql stable as $$
  select nullif(current_setting('app.current_user_id', true), '')::integer;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- Helper: generic "touch updated_at" trigger, replacing MySQL's
-- `ON UPDATE CURRENT_TIMESTAMP` column option (Postgres has no equivalent).
-- ───────────────────────────────────────────────────────────────────────────
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- TENANT / ACCOUNT TABLES  (formerly the "main" database)
-- ═══════════════════════════════════════════════════════════════════════════

create table users (
  id             integer generated always as identity primary key,
  username       varchar(50)  not null unique,
  email          varchar(100) not null unique,
  password       varchar(255) not null,
  first_name     varchar(50)  not null,
  last_name      varchar(50)  not null,
  phone          varchar(20),
  user_group     varchar(50)  not null default '',
  session_token  varchar(255),
  last_login     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index idx_users_username on users (username);
create index idx_users_email    on users (email);
create index idx_users_session_token on users (session_token);
create trigger trg_users_updated_at before update on users
  for each row execute function set_updated_at();

-- NOTE: dropped the old `my_database` column entirely — it was metadata
-- pointing at a per-user MySQL database name, which no longer exists as a
-- concept under the shared-schema design. `users.id` IS the tenant id now.

create table user_sessions (
  id             integer generated always as identity primary key,
  user_id        integer not null references users(id) on delete cascade,
  session_token  varchar(255) not null unique,
  ip_address     varchar(45),
  user_agent     text,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  last_activity  timestamptz not null default now(),
  expires_at     timestamptz not null default now()
);
create index idx_user_sessions_user_id on user_sessions (user_id);
create index idx_user_sessions_token   on user_sessions (session_token);
create trigger trg_user_sessions_touch before update on user_sessions
  for each row execute function set_updated_at();
-- (touches last_activity via app code, not this trigger; trigger targets
--  any future `updated_at`-style column — harmless no-op if absent. If you
--  don't add such a column, drop this trigger.)

create table system_logs (
  id          integer generated always as identity primary key,
  user_id     integer references users(id) on delete set null,
  action      varchar(100) not null,
  details     text,
  ip_address  varchar(45),
  user_agent  text,
  created_at  timestamptz not null default now()
);
create index idx_system_logs_user_id    on system_logs (user_id);
create index idx_system_logs_action     on system_logs (action);
create index idx_system_logs_created_at on system_logs (created_at);

-- Global (not per-tenant) role/permission catalog — unchanged in scope.
create table user_groups (
  id            integer generated always as identity primary key,
  group_number  varchar(64)  not null unique,
  group_name    varchar(100) not null unique,
  description   varchar(255),
  is_enabled    boolean not null default true,
  permissions   jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz
);
create trigger trg_user_groups_updated_at before update on user_groups
  for each row execute function set_updated_at();


-- ═══════════════════════════════════════════════════════════════════════════
-- TENANT-SCOPED OPERATIONAL TABLES  (formerly one-per-user database)
-- ═══════════════════════════════════════════════════════════════════════════

create table employees (
  id          integer generated always as identity primary key,
  user_id     integer not null references users(id) on delete cascade,
  fullname    varchar(100) not null,
  position    varchar(50)  not null,
  brand       varchar(50)  not null,
  gender      varchar(10)  check (gender in ('Male', 'Female')),
  birth       date,
  hired       date,
  status      varchar(10) not null default 'Active'
                check (status in ('Active', 'Inactive')),
  shift       varchar(20) not null
                check (shift in ('Day Shift', 'Night Shift', 'Graveyard Shift')),
  violation   text,
  image       varchar(255),
  qr_code     varchar(100) not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint uq_employees_user_qr unique (user_id, qr_code)  -- was a bare global UNIQUE
);
create index idx_employees_user_id on employees (user_id);
create index idx_employees_qr_code on employees (qr_code);
create trigger trg_employees_updated_at before update on employees
  for each row execute function set_updated_at();

create table code (
  id            integer generated always as identity primary key,
  user_id       integer not null references users(id) on delete cascade,
  is_active     boolean not null default true,
  qr_code       varchar(100),
  reserved_by   varchar(64),
  reserved_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint uq_code_user_qr unique (user_id, qr_code)  -- was a bare global UNIQUE
);
create index idx_code_user_id on code (user_id);
create trigger trg_code_updated_at before update on code
  for each row execute function set_updated_at();

create table violations (
  id                      integer generated always as identity primary key,
  user_id                 integer not null references users(id) on delete cascade,
  employee_id             integer not null references employees(id) on delete cascade,
  violation_type          varchar(100),
  violation_description   text,
  violation_date          date,
  created_at              timestamptz not null default now()
);
create index idx_violations_user_id     on violations (user_id);
create index idx_violations_employee_id on violations (employee_id);

create table status_history (
  id             integer generated always as identity primary key,
  user_id        integer not null references users(id) on delete cascade,
  employee_id    integer not null references employees(id) on delete cascade,
  old_status     varchar(20),
  new_status     varchar(20),
  changed_by     varchar(100),
  change_reason  text,
  created_at     timestamptz not null default now()
);
create index idx_status_history_user_id     on status_history (user_id);
create index idx_status_history_employee_id on status_history (employee_id);

-- violations/status_history didn't carry user_id in the old design (they
-- didn't need to — isolation came from living in a separate database).
-- Rather than rely on every INSERT in app code to remember to set it
-- correctly, derive it automatically from the referenced employee. This is
-- the same "don't trust every call site to get it right" principle behind
-- the qr_code conflict fix we did earlier in proxcode_backend.php.
create or replace function derive_user_id_from_employee() returns trigger
language plpgsql as $$
begin
  if new.user_id is null then
    select user_id into new.user_id from employees where id = new.employee_id;
  end if;
  return new;
end;
$$;
create trigger trg_violations_derive_user_id before insert on violations
  for each row execute function derive_user_id_from_employee();
create trigger trg_status_history_derive_user_id before insert on status_history
  for each row execute function derive_user_id_from_employee();

create table search_queries (
  id                  integer generated always as identity primary key,
  user_id             integer not null references users(id) on delete cascade,
  query_type          varchar(50) not null,
  search_term         varchar(255),
  search_parameters   jsonb,
  results_count       integer default 0,
  results_data        jsonb,
  ip_address          varchar(45),
  user_agent          text,
  query_timestamp     timestamptz not null default now(),
  execution_time_ms   numeric(10, 3),
  success             boolean default false,
  error_message       text
);
create index idx_search_queries_user_id     on search_queries (user_id);
create index idx_search_queries_query_type  on search_queries (query_type);
create index idx_search_queries_timestamp   on search_queries (query_timestamp);
create index idx_search_queries_success     on search_queries (success);

create table employee_access_log (
  id                integer generated always as identity primary key,
  user_id           integer references users(id) on delete cascade,
  employee_id       integer,
  fullname          varchar(100),
  position          varchar(50),
  brand             varchar(50),
  status            varchar(10) check (status in ('Active', 'Inactive')),
  shift             varchar(20) check (shift in ('Day Shift', 'Night Shift', 'Graveyard Shift')),
  violation         text,
  image             varchar(255),
  qr_code           varchar(100),
  access_type       varchar(50),
  ip_address        varchar(45),
  user_agent        text,
  check_status      varchar(3) check (check_status in ('IN', 'OUT')),
  access_timestamp  timestamptz not null default now()
);
create index idx_eal_employee_id      on employee_access_log (employee_id);
create index idx_eal_qr_code          on employee_access_log (qr_code);
create index idx_eal_access_timestamp on employee_access_log (access_timestamp);
create index idx_eal_access_type      on employee_access_log (access_type);
create index idx_eal_user_id          on employee_access_log (user_id);

create table employee_attendance_log (
  id                integer generated always as identity primary key,
  user_id           integer references users(id) on delete cascade,
  employee_id       integer,
  fullname          varchar(100),
  position          varchar(50),
  brand             varchar(50),
  status            varchar(10) check (status in ('Active', 'Inactive')),
  shift             varchar(20) check (shift in ('Day Shift', 'Night Shift', 'Graveyard Shift')),
  violation         text,
  image             varchar(255),
  qr_code           varchar(100),
  access_type       varchar(50),
  ip_address        varchar(45),
  user_agent        text,
  access_timestamp  timestamptz not null default now()
);
create index idx_eatl_employee_id      on employee_attendance_log (employee_id);
create index idx_eatl_qr_code          on employee_attendance_log (qr_code);
create index idx_eatl_access_timestamp on employee_attendance_log (access_timestamp);
create index idx_eatl_access_type      on employee_attendance_log (access_type);
create index idx_eatl_user_id          on employee_attendance_log (user_id);

create table check_in_out (
  id               integer generated always as identity primary key,
  user_id          integer references users(id) on delete cascade,
  employee_id      integer not null,
  qr_code          varchar(255) not null,
  fullname         varchar(255) not null,
  check_type       varchar(3) not null check (check_type in ('IN', 'OUT')),
  scan_timestamp   timestamptz not null default now(),
  ip_address       varchar(45),
  user_agent       text
);
create index idx_cio_employee_id      on check_in_out (employee_id);
create index idx_cio_qr_code          on check_in_out (qr_code);
create index idx_cio_timestamp        on check_in_out (scan_timestamp);
create index idx_cio_employee_scan    on check_in_out (employee_id, scan_timestamp);
create index idx_cio_user_id          on check_in_out (user_id);

create table user_audio_settings (
  id                       integer generated always as identity primary key,
  user_id                  integer not null unique references users(id) on delete cascade,
  success_audio_path       varchar(512),
  not_found_audio_path     varchar(512),
  inactive_audio_path      varchar(512),
  violations_audio_path    varchar(512),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create trigger trg_user_audio_settings_updated_at before update on user_audio_settings
  for each row execute function set_updated_at();


-- ═══════════════════════════════════════════════════════════════════════════
-- GLOBAL (NOT PER-TENANT) SINGLETON / LOOKUP TABLES
-- ═══════════════════════════════════════════════════════════════════════════
-- These were already app-wide in the old design (one row / one row per
-- fixed audio_type, shared by everyone) — no user_id, no RLS by tenant.
-- Access to them should instead be gated by an admin check in app code,
-- same as today.

create table global_company_settings (
  id            integer generated always as identity primary key,
  company_name  varchar(255) default '',
  company_logo  text default '',   -- MEDIUMTEXT -> text (Postgres has no length-tiered text types)
  updated_at    timestamptz not null default now()
);
create trigger trg_global_company_settings_updated_at before update on global_company_settings
  for each row execute function set_updated_at();

create table global_audio_settings (
  id            integer generated always as identity primary key,
  audio_type    varchar(50) not null unique,
  audio_data    text default '',
  audio_mime    varchar(50) default '',
  updated_at    timestamptz not null default now()
);
create trigger trg_global_audio_settings_updated_at before update on global_audio_settings
  for each row execute function set_updated_at();


-- ═══════════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ═══════════════════════════════════════════════════════════════════════════
-- Every tenant-scoped table: enable RLS, and only allow a row through when
-- its user_id matches the session's app_current_user_id(). FORCE ROW LEVEL
-- SECURITY additionally applies this even to the table owner, so a bug that
-- accidentally connects as the owning/migration role doesn't silently
-- bypass isolation.

do $$
declare
  t text;
begin
  foreach t in array array[
    'employees', 'code', 'violations', 'status_history', 'search_queries',
    'employee_access_log', 'employee_attendance_log', 'check_in_out',
    'user_audio_settings'
  ]
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy tenant_isolation on %I
         using (user_id = app_current_user_id())
         with check (user_id = app_current_user_id())',
      t
    );
  end loop;
end $$;

-- `users` itself: a user should only ever see/update their own row (admin
-- tooling should use the Postgres service_role key, which bypasses RLS
-- entirely, for cross-user administration).
alter table users enable row level security;
alter table users force row level security;
create policy self_only on users
  using (id = app_current_user_id())
  with check (id = app_current_user_id());

-- user_sessions and system_logs: scoped to the owning user_id the same way.
alter table user_sessions enable row level security;
alter table user_sessions force row level security;
create policy tenant_isolation on user_sessions
  using (user_id = app_current_user_id())
  with check (user_id = app_current_user_id());

alter table system_logs enable row level security;
alter table system_logs force row level security;
create policy tenant_isolation on system_logs
  using (user_id = app_current_user_id())
  with check (user_id = app_current_user_id());

-- user_groups, global_company_settings, global_audio_settings: intentionally
-- NOT tenant-scoped (see comments above). Leave RLS off; app code continues
-- to gate write access with its existing requireAdmin()-style checks.
