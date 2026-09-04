-- Core schema for Screen Media Control on Supabase
-- Includes users, clients, media, activity, schedules tables.

begin;

create extension if not exists pgcrypto;

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  password_hash text not null,
  role text not null default 'admin',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null,
  online boolean not null default true,
  screen_on boolean not null default true,
  current_media jsonb,
  last_command text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.media (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  path text not null,
  mime_type text not null,
  size bigint not null default 0,
  url text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.activity (
  id uuid primary key default gen_random_uuid(),
  level text not null,
  message text not null,
  payload jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.schedules (
  id uuid primary key default gen_random_uuid(),
  target_id uuid references public.clients(id) on delete set null,
  media_id uuid not null references public.media(id) on delete cascade,
  start_at timestamptz not null,
  next_run_at timestamptz not null,
  repeat_mode text not null default 'once' check (repeat_mode in ('once', 'daily')),
  enabled boolean not null default true,
  loop boolean not null default false,
  volume integer not null default 70,
  status text not null default 'scheduled' check (status in ('scheduled', 'failed', 'completed', 'disabled')),
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_clients_name on public.clients(name);
create index if not exists idx_media_created_at on public.media(created_at desc);
create index if not exists idx_activity_created_at on public.activity(created_at desc);
create index if not exists idx_schedules_next_run on public.schedules(next_run_at) where enabled = true;
create index if not exists idx_schedules_media_id on public.schedules(media_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_users_updated_at on public.users;
create trigger trg_users_updated_at
before update on public.users
for each row execute function public.set_updated_at();

drop trigger if exists trg_clients_updated_at on public.clients;
create trigger trg_clients_updated_at
before update on public.clients
for each row execute function public.set_updated_at();

drop trigger if exists trg_media_updated_at on public.media;
create trigger trg_media_updated_at
before update on public.media
for each row execute function public.set_updated_at();

drop trigger if exists trg_schedules_updated_at on public.schedules;
create trigger trg_schedules_updated_at
before update on public.schedules
for each row execute function public.set_updated_at();

alter table public.users enable row level security;
alter table public.clients enable row level security;
alter table public.media enable row level security;
alter table public.activity enable row level security;
alter table public.schedules enable row level security;

revoke all on public.users from anon, authenticated;
revoke all on public.clients from anon, authenticated;
revoke all on public.media from anon, authenticated;
revoke all on public.activity from anon, authenticated;
revoke all on public.schedules from anon, authenticated;

commit;
