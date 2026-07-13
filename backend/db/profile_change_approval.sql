-- Approved partner profiles remain unchanged until an administrator accepts a request.

create extension if not exists pgcrypto;

alter table consulting_experts
  add column if not exists partner_type text not null default 'freelancer',
  add column if not exists business_registration_number text,
  add column if not exists business_owner_name text,
  add column if not exists business_description text,
  add column if not exists phone text,
  add column if not exists business_address text;

alter table consulting_partner_applications
  add column if not exists profile_image_file_name text,
  add column if not exists profile_image_storage_key text,
  add column if not exists profile_image_content_type text;

create table if not exists consulting_partner_profile_change_requests (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references consulting_partner_accounts(id) on delete cascade,
  expert_id text not null references consulting_experts(id) on delete cascade,
  requester_email text not null,
  target_type text not null check (target_type in ('business', 'expert')),
  current_snapshot jsonb not null,
  proposed_changes jsonb not null,
  avatar_bucket text,
  avatar_object_key text,
  avatar_file_name text,
  avatar_content_type text,
  status text not null default 'submitted'
    check (status in ('submitted', 'needs_update', 'approved', 'rejected')),
  review_memo text,
  reviewer_name text,
  reviewed_at timestamptz,
  last_email_notification_type text,
  last_email_notification_status text,
  last_email_notification_error text,
  last_email_notification_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_partner_profile_change_active_target
  on consulting_partner_profile_change_requests (account_id, expert_id, target_type)
  where status in ('submitted', 'needs_update');

create index if not exists ix_partner_profile_change_status_updated
  on consulting_partner_profile_change_requests (status, updated_at desc);
