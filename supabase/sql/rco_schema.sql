-- RCO schema for Supabase Postgres
-- Apply in Supabase SQL Editor or via migration.

begin;

create extension if not exists pgcrypto;

-- Device registry for Remote Control Operations (RCO).
create table if not exists public.rco_devices (
  id uuid primary key default gen_random_uuid(),
  external_device_id text not null unique,
  display_name text not null,
  platform text not null default 'android',
  is_online boolean not null default false,
  last_seen_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Command queue sent from admin panel to devices.
create table if not exists public.rco_commands (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.rco_devices(id) on delete cascade,
  command_type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'sent', 'acked', 'failed', 'expired')),
  requested_by text,
  requested_at timestamptz not null default now(),
  sent_at timestamptz,
  acked_at timestamptz,
  expires_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Optional execution logs for command lifecycle.
create table if not exists public.rco_command_logs (
  id bigserial primary key,
  command_id uuid not null references public.rco_commands(id) on delete cascade,
  device_id uuid not null references public.rco_devices(id) on delete cascade,
  event_type text not null,
  event_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_rco_devices_external_device_id on public.rco_devices(external_device_id);
create index if not exists idx_rco_devices_last_seen_at on public.rco_devices(last_seen_at desc);

create index if not exists idx_rco_commands_device_status on public.rco_commands(device_id, status);
create index if not exists idx_rco_commands_requested_at on public.rco_commands(requested_at desc);
create index if not exists idx_rco_commands_status_requested_at on public.rco_commands(status, requested_at desc);

create index if not exists idx_rco_command_logs_command_id on public.rco_command_logs(command_id);
create index if not exists idx_rco_command_logs_device_id_created_at on public.rco_command_logs(device_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_rco_devices_updated_at on public.rco_devices;
create trigger trg_rco_devices_updated_at
before update on public.rco_devices
for each row execute function public.set_updated_at();

drop trigger if exists trg_rco_commands_updated_at on public.rco_commands;
create trigger trg_rco_commands_updated_at
before update on public.rco_commands
for each row execute function public.set_updated_at();

alter table public.rco_devices enable row level security;
alter table public.rco_commands enable row level security;
alter table public.rco_command_logs enable row level security;

-- Strict default: block direct access from anon/authenticated until app auth model is finalized.
revoke all on public.rco_devices from anon, authenticated;
revoke all on public.rco_commands from anon, authenticated;
revoke all on public.rco_command_logs from anon, authenticated;

-- Optional admin policies. Enable only if your JWT includes role=admin.
drop policy if exists rco_devices_admin_all on public.rco_devices;
create policy rco_devices_admin_all on public.rco_devices
for all to authenticated
using ((auth.jwt() ->> 'role') = 'admin')
with check ((auth.jwt() ->> 'role') = 'admin');

drop policy if exists rco_commands_admin_all on public.rco_commands;
create policy rco_commands_admin_all on public.rco_commands
for all to authenticated
using ((auth.jwt() ->> 'role') = 'admin')
with check ((auth.jwt() ->> 'role') = 'admin');

drop policy if exists rco_command_logs_admin_all on public.rco_command_logs;
create policy rco_command_logs_admin_all on public.rco_command_logs
for all to authenticated
using ((auth.jwt() ->> 'role') = 'admin')
with check ((auth.jwt() ->> 'role') = 'admin');

-- Helper function for worker/device polling next queued command.
create or replace function public.rco_claim_next_command(p_device_external_id text)
returns public.rco_commands
language plpgsql
security invoker
as $$
declare
  v_cmd public.rco_commands;
begin
  update public.rco_commands c
  set status = 'sent',
      sent_at = now(),
      updated_at = now()
  where c.id = (
    select c2.id
    from public.rco_commands c2
    join public.rco_devices d on d.id = c2.device_id
    where d.external_device_id = p_device_external_id
      and c2.status = 'queued'
      and (c2.expires_at is null or c2.expires_at > now())
    order by c2.requested_at asc
    limit 1
    for update skip locked
  )
  returning c.* into v_cmd;

  return v_cmd;
end;
$$;

revoke all on function public.rco_claim_next_command(text) from public;
grant execute on function public.rco_claim_next_command(text) to authenticated;

commit;
