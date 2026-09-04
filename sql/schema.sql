-- Rosas Nails Art — Booking schema
-- Applied to the dedicated Supabase project "rosasnailart".

create extension if not exists pgcrypto;

create table services (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  duration_minutes integer not null check (duration_minutes > 0),
  price_cents integer not null check (price_cents >= 0),
  deposit_cents integer not null check (deposit_cents >= 0),
  category text not null default 'service' check (category in ('service', 'addon')),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table blocked_dates (
  id uuid primary key default gen_random_uuid(),
  date date not null unique,
  reason text,
  created_at timestamptz not null default now()
);

create table appointments (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references services(id),
  client_name text not null,
  client_phone text not null,
  client_email text not null,
  notes text,
  start_at timestamptz not null,
  end_at timestamptz not null,
  status text not null default 'pending_payment'
    check (status in ('pending_payment', 'confirmed', 'cancelled', 'expired')),
  stripe_session_id text,
  deposit_cents integer not null,
  price_cents integer not null default 0,
  service_label text not null default '',
  created_at timestamptz not null default now(),
  constraint end_after_start check (end_at > start_at)
);

create index appointments_start_at_idx on appointments (start_at);
create index appointments_status_idx on appointments (status);
create index appointments_stripe_session_idx on appointments (stripe_session_id);

-- All access goes through the service-role key from serverless functions only —
-- RLS stays on with no policies, so the anon/public key (if ever exposed) can't read or write anything.
alter table services enable row level security;
alter table blocked_dates enable row level security;
alter table appointments enable row level security;

-- Seed the 6 services currently listed on the landing page.
insert into services (name, duration_minutes, price_cents, deposit_cents, category, sort_order) values
  ('Basic Manicure',       75,  4500, 1000, 'service', 1),
  ('Rosas Spa Pedicure',   90, 12500, 2500, 'service', 2),
  ('Acrylic Extensions',  180, 13000, 3000, 'service', 3),
  ('Gel·X',               120,  9500, 2000, 'service', 4),
  ('Waxing',               45,  1800,  500, 'service', 5),
  ('Nail Art & Diseños',   30,  1500,    0, 'addon',   6);
