-- Saved treatments: the treatments a person keeps, each with its own page (/s/<id>), private until its owner shares
-- it. Only the itsgiving server reads and writes this table, with the secret key (src/lib/saved/store.ts). Browsers
-- get no grants and no policies, so the Data API refuses the table even to a signed-in user; RLS stays on as a second
-- lock. A treatment holds Qloo data, which may sit in a private server-side store but never in git.
create table public.saved_treatments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  -- The take that was saved, its brief key and build time: the same board saved twice is one row.
  take_key text not null check (char_length(take_key) <= 200),
  -- Enough for a list without loading the treatments themselves.
  title text not null check (char_length(title) between 1 and 200),
  summary text not null default '' check (char_length(summary) <= 300),
  cover text check (char_length(cover) <= 500),
  treatment jsonb not null check (octet_length(treatment::text) <= 300000),
  shared boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, take_key)
);

-- A person's list, newest first.
create index saved_treatments_owner_created on public.saved_treatments (owner_id, created_at desc);

alter table public.saved_treatments enable row level security;

-- New tables aren't exposed to the Data API by default any more; this says so outright for the browser roles, and
-- gives the server's role what it uses.
revoke all on table public.saved_treatments from anon, authenticated;
grant select, insert, update, delete on table public.saved_treatments to service_role;
