-- Local/hosted parity grants.
-- Hosted Supabase applies these automatically; local supabase start does not.
grant usage on schema public to service_role, authenticated;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
