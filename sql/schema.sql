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
  -- Which Stripe account actually processed the charge (platform vs
  -- Maribel's connected Stripe Connect account) — null before she connects.
  stripe_account_id text,
  deposit_cents integer not null,
  price_cents integer not null default 0,
  service_label text not null default '',
  created_at timestamptz not null default now(),
  constraint end_after_start check (end_at > start_at)
);

create index appointments_start_at_idx on appointments (start_at);
create index appointments_status_idx on appointments (status);
create index appointments_stripe_session_idx on appointments (stripe_session_id);

-- open_slots: explicit windows Maribel opens for a future date. availability.js
-- reads these instead of a fixed schedule — a date with no rows is closed.
create table open_slots (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  start_time time not null,
  end_time time not null,
  created_at timestamptz not null default now(),
  constraint end_after_start check (end_time > start_time)
);

create index open_slots_date_idx on open_slots (date);

-- Singleton row holding the business's connected Stripe account (Standard
-- Connect OAuth) — only one row ever exists (id is always true).
create table business_settings (
  id boolean primary key default true check (id),
  stripe_account_id text,
  stripe_connected_at timestamptz
);
insert into business_settings (id) values (true);

-- All access goes through the service-role key from serverless functions only —
-- RLS stays on with no policies, so the anon/public key (if ever exposed) can't read or write anything.
alter table services enable row level security;
alter table blocked_dates enable row level security;
alter table appointments enable row level security;
alter table open_slots enable row level security;
alter table business_settings enable row level security;

-- Seed the real catalog from Maribel's answers (Respuestas_Maribel.pdf).
-- Deposit is a flat $45 per appointment (Maribel's policy) — see
-- lib/business-hours.js DEPOSIT_CENTS, which is what appointments.js actually
-- charges; the deposit_cents column here is kept for reference only.
-- Acrylic Extensions is split into 3 selectable sizes (Short/Medium/Extra
-- Long) since her pricing varies by length, not by a single "starting at".
insert into services (name, duration_minutes, price_cents, deposit_cents, category, sort_order) values
  ('Basic Manicure',                  75,  4500, 4500, 'service',  1),
  ('Builder Gel Manicure',           150, 12000, 4500, 'service',  2),
  ('Acrylic Extensions — Short',      180, 12500, 4500, 'service',  3),
  ('Acrylic Extensions — Medium',     180, 13500, 4500, 'service',  4),
  ('Acrylic Extensions — Extra Long', 180, 17000, 4500, 'service',  5),
  ('Classic Pedicure',                60,  8500, 4500, 'service',  6),
  ('Rosas Spa Pedicure',              90, 12500, 4500, 'service',  7),
  ('Gel Manicure + Pedicure Combo',  120, 12500, 4500, 'service',  8),
  ('Nail Art & Diseños',              30,  1000, 4500, 'addon',    9),
  ('Removal',                         15,  1500, 4500, 'addon',   10),
  ('Rosas Hand Spa',                  10,  2500, 4500, 'addon',   11),
  ('Paraffin Treatment',              10,   800, 4500, 'addon',   12);
