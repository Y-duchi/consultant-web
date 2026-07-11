alter table consulting_experts
  add column if not exists operating_hours jsonb,
  add column if not exists holiday_dates jsonb,
  add column if not exists temporary_booking_blocks jsonb,
  add column if not exists booking_open_months integer not null default 1;
