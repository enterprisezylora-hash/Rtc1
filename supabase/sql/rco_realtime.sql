-- Enable Supabase Realtime stream for RCO tables
-- Run after rco_schema.sql

begin;

alter publication supabase_realtime add table public.rco_devices;
alter publication supabase_realtime add table public.rco_commands;
alter publication supabase_realtime add table public.rco_command_logs;

commit;
