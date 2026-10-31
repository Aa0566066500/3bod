create table if not exists public.site_keys (
  id bigint generated always as identity primary key,
  owner_key_hash text not null unique,
  created_at timestamptz not null default now(),
  disabled boolean not null default false
);

create table if not exists public.scripts (
  id bigint generated always as identity primary key,
  owner_key_hash text not null,
  slug text not null unique,
  title text not null,
  content text not null default '',
  enabled boolean not null default true,
  last_toggle_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.scripts
  add column if not exists last_toggle_at timestamptz;

create table if not exists public.audit_events (
  id bigint generated always as identity primary key,
  owner_key_hash text,
  event_type text not null,
  script_slug text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.audit_events
  add column if not exists owner_key_hash text;

alter table public.audit_events
  add column if not exists details jsonb not null default '{}'::jsonb;

alter table public.site_keys enable row level security;
alter table public.scripts enable row level security;
alter table public.audit_events enable row level security;

create index if not exists scripts_owner_idx
  on public.scripts(owner_key_hash);

create index if not exists audit_owner_created_idx
  on public.audit_events(owner_key_hash, created_at desc);