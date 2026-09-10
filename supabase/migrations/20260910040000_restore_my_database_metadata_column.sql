-- The original schema (20260909084355_initial_schema) dropped `my_database`
-- entirely, reasoning it was per-user-database metadata that no longer
-- applied. Turns out admin panel.php and reg.php both read/write it directly
-- as a free-text display label for a user (add/edit/list user forms) --
-- unrelated to the actual per-user-database architecture change. Restoring
-- it as plain metadata so that admin CRUD keeps working unmodified.
alter table users add column if not exists my_database varchar(100) default '';
