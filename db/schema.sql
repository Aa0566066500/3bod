-- Run once in Supabase SQL Editor.
-- Keep service-role credentials server-side only.

create table if not exists public.site_keys (
  key text primary key,
  created_at timestamptz not null default now(),
  disabled boolean not null default false
);

create table if not exists public.scripts (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  content text not null default '',
  owner_key text not null
    references public.site_keys(key),
  revoked boolean not null default false,
  toggle_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.logs (
  id bigint generated always as identity primary key,
  script_name text not null,
  timestamp timestamptz not null default now(),
  ip text,
  user_agent text,
  allowed boolean not null default false,
  reason text
);

create table if not exists public.audit_events (
  id bigint generated always as identity primary key,
  action text not null,
  script_name text,
  actor_key_hint text,
  created_at timestamptz not null default now(),
  details jsonb not null default '{}'::jsonb
);

alter table public.site_keys
  enable row level security;

alter table public.scripts
  enable row level security;

alter table public.logs
  enable row level security;

alter table public.audit_events
  enable row level security;

-- No public policies are created.
-- Access is through Netlify Functions using
-- the server-side service-role key.