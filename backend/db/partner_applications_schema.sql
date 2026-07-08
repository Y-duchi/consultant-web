-- AURA partner application schema draft.
-- Do not run this against production RDS until the table names and existing app schema have been reviewed.

create extension if not exists pgcrypto;

create table if not exists businesses (
  id uuid primary key default gen_random_uuid(),
  partner_type text not null check (partner_type in ('business', 'freelancer')),
  name text not null,
  owner_name text not null,
  business_registration_number text,
  phone text not null,
  email text not null,
  introduction text not null default '',
  verification_status text not null default 'submitted',
  exposure_status text not null default 'pending_review',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists experts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  role_label text not null default '',
  email text not null,
  phone text not null,
  specialties text[] not null default '{}',
  categories text[] not null default '{}',
  introduction text not null default '',
  price_30_min integer not null default 0 check (price_30_min >= 0),
  price_60_min integer not null default 0 check (price_60_min >= 0),
  exposure_status text not null default 'pending_review',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists partner_applications (
  id uuid primary key default gen_random_uuid(),
  partner_type text not null check (partner_type in ('business', 'freelancer')),
  business_name text not null,
  owner_name text not null,
  business_registration_number text,
  phone text not null,
  email text not null,
  specialties text[] not null default '{}',
  categories text[] not null default '{}',
  introduction text not null default '',
  price_30_min integer not null default 0 check (price_30_min >= 0),
  price_60_min integer not null default 0 check (price_60_min >= 0),
  status text not null check (status in ('submitted', 'needs_update', 'approved', 'rejected')),
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewer_id uuid,
  reviewer_name text,
  review_memo text,
  business_id uuid references businesses(id),
  generated_account_id uuid,
  unique (email)
);

create table if not exists partner_application_documents (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references partner_applications(id) on delete cascade,
  document_type text not null check (document_type in ('business_registration', 'beauty_license', 'additional_certificate')),
  file_name text not null,
  mime_type text not null default 'application/pdf',
  size_bytes bigint,
  storage_bucket text not null,
  storage_key text not null,
  review_status text not null default 'pending' check (review_status in ('pending', 'verified', 'rejected')),
  note text,
  uploaded_at timestamptz not null default now(),
  unique (storage_bucket, storage_key)
);

create table if not exists partner_accounts (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references partner_applications(id),
  business_id uuid not null references businesses(id),
  expert_id uuid,
  email text not null unique,
  password_hash text,
  temporary_password_issued_at timestamptz,
  role text not null check (role in ('business_manager', 'expert')),
  workspace_scope text not null check (workspace_scope in ('business_operations', 'expert_personal')),
  status text not null default 'invited' check (status in ('invited', 'active', 'suspended')),
  password_change_required boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint partner_accounts_role_scope_check check (
    (
      role = 'business_manager'
      and workspace_scope = 'business_operations'
      and expert_id is null
    )
    or (
      role = 'expert'
      and workspace_scope = 'expert_personal'
      and expert_id is not null
    )
  )
);

create table if not exists business_members (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  account_id uuid not null references partner_accounts(id) on delete cascade,
  expert_id uuid,
  role text not null check (role in ('owner', 'manager', 'expert')),
  workspace_scope text not null check (workspace_scope in ('business_operations', 'expert_personal')),
  status text not null default 'active' check (status in ('active', 'invited', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, account_id),
  constraint business_members_role_scope_check check (
    (
      role in ('owner', 'manager')
      and workspace_scope = 'business_operations'
      and expert_id is null
    )
    or (
      role = 'expert'
      and workspace_scope = 'expert_personal'
      and expert_id is not null
    )
  )
);

create index if not exists idx_business_members_business_status
  on business_members(business_id, status, role);

create index if not exists idx_business_members_expert_id
  on business_members(expert_id)
  where expert_id is not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'partner_accounts_id_business_unique'
  ) then
    alter table partner_accounts
      add constraint partner_accounts_id_business_unique
      unique (id, business_id);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'business_members_account_business_fk'
  ) then
    alter table business_members
      add constraint business_members_account_business_fk
      foreign key (account_id, business_id)
      references partner_accounts(id, business_id)
      on delete cascade;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'partner_applications_generated_account_fk'
  ) then
    alter table partner_applications
      add constraint partner_applications_generated_account_fk
      foreign key (generated_account_id) references partner_accounts(id) deferrable initially deferred;
  end if;
end $$;

create table if not exists partner_application_review_logs (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references partner_applications(id) on delete cascade,
  actor_id uuid,
  actor_name text not null,
  action text not null check (action in ('submitted', 'needs_update', 'approved', 'rejected', 'account_created')),
  memo text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists idx_partner_applications_status_updated_at
  on partner_applications(status, updated_at desc);

create index if not exists idx_partner_applications_email
  on partner_applications(lower(email));

create index if not exists idx_partner_application_documents_application_id
  on partner_application_documents(application_id);

create index if not exists idx_partner_application_review_logs_application_id
  on partner_application_review_logs(application_id, created_at desc);

-- Existing mobile app tables: additive changes only.
-- The app backend should keep users, consulting_bookings, consulting_experts,
-- consulting_summaries, and consulting_messages as source-of-truth tables.

alter table if exists consulting_experts
  add column if not exists business_id uuid references businesses(id);

do $$
begin
  if to_regclass('public.consulting_experts') is not null then
    if not exists (
      select 1
      from pg_constraint
      where conname = 'partner_accounts_expert_fk'
    ) then
      alter table partner_accounts
        add constraint partner_accounts_expert_fk
        foreign key (expert_id) references consulting_experts(id)
        on delete restrict;
    end if;

    if not exists (
      select 1
      from pg_constraint
      where conname = 'business_members_expert_fk'
    ) then
      alter table business_members
        add constraint business_members_expert_fk
        foreign key (expert_id) references consulting_experts(id)
        on delete restrict;
    end if;
  end if;
end $$;

create index if not exists idx_consulting_experts_business_id
  on consulting_experts(business_id);

create index if not exists idx_consulting_bookings_expert_status
  on consulting_bookings(expert_id, status);

create index if not exists idx_consulting_bookings_customer_expert
  on consulting_bookings(customer_id, expert_id);

create or replace view partner_booking_customers as
select distinct
  b.id as business_id,
  cb.expert_id,
  cb.customer_id,
  u.*
from consulting_bookings cb
join consulting_experts ce on ce.id = cb.expert_id
join businesses b on b.id = ce.business_id
join users u on u.id = cb.customer_id
where b.id is not null;

create index if not exists idx_consulting_bookings_customer_id
  on consulting_bookings(customer_id);

alter table if exists consulting_summaries
  add column if not exists source text not null default 'manual',
  add column if not exists ai_status text not null default 'not_requested',
  add column if not exists ai_model text,
  add column if not exists transcript text,
  add column if not exists internal_memo text,
  add column if not exists customer_summary text,
  add column if not exists recommendations text,
  add column if not exists visible_to_customer boolean not null default true;

create index if not exists idx_consulting_summaries_visible_booking
  on consulting_summaries(booking_id)
  where visible_to_customer = true;

create or replace view customer_visible_consulting_summaries as
select cs.*
from consulting_summaries cs
join consulting_bookings cb on cb.id = cs.booking_id
where cs.visible_to_customer = true
  and cb.status = 'completed';

create table if not exists consultation_summary_jobs (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references consulting_bookings(id) on delete cascade,
  business_id uuid not null references businesses(id),
  expert_id uuid not null references consulting_experts(id),
  requested_by_account_id uuid references partner_accounts(id),
  source text not null check (source in ('phone_transcript', 'manual_memo')),
  status text not null default 'queued' check (status in ('queued', 'processing', 'succeeded', 'failed')),
  ai_model text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_consultation_summary_jobs_business_status
  on consultation_summary_jobs(business_id, status, updated_at desc);

create index if not exists idx_consultation_summary_jobs_booking
  on consultation_summary_jobs(booking_id, updated_at desc);

create table if not exists partner_event_outbox (
  id uuid primary key default gen_random_uuid(),
  sequence bigint generated always as identity unique,
  event_type text not null check (
    event_type in (
      'booking.created',
      'booking.updated',
      'summary.created',
      'summary.failed',
      'review.created',
      'refund.updated',
      'chat.unread'
    )
  ),
  business_id uuid not null references businesses(id),
  expert_id uuid references consulting_experts(id),
  booking_id uuid references consulting_bookings(id) on delete set null,
  customer_id uuid references users(id) on delete set null,
  summary_job_id uuid references consultation_summary_jobs(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  consumed_at timestamptz
);

create index if not exists idx_partner_event_outbox_business_sequence
  on partner_event_outbox(business_id, sequence);

create index if not exists idx_partner_event_outbox_expert_sequence
  on partner_event_outbox(expert_id, sequence)
  where expert_id is not null;

create index if not exists idx_partner_event_outbox_created_at
  on partner_event_outbox(created_at);
