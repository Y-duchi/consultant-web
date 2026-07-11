# Backend Environment

This folder is reserved for the future FastAPI backend. Put local backend secrets in `backend/.env`.

Do not commit real secrets.

## Local files

- `../.env.local`: frontend-only values. Only `VITE_` values should go here.
- `backend/.env`: backend secrets for local development. Ignored by Git.
- `backend/.env.example`: safe template that can be committed.

## Recommended local values

Use split database variables instead of a single `DATABASE_URL` so rotated passwords and hosts are easier to update.

```env
ENVIRONMENT=local
DATABASE_SECRET_ID=
DB_HOST=
DB_PORT=5432
DB_NAME=
DB_SSLMODE=require
AWS_REGION=ap-northeast-2
AWS_USE_IAM_ROLE=true
S3_BUCKET_NAME=
CORS_ENABLED=true
CORS_ALLOW_ORIGINS=http://127.0.0.1:5173
OPENAI_API_KEY=
OPENAI_SUMMARY_MODEL=
```

For local fallback without Secrets Manager:

```env
DATABASE_URL=
DB_USER=
DB_PASSWORD=
AWS_PROFILE_NAME=aura-dev
AWS_USE_IAM_ROLE=false
S3_BUCKET_NAME=
CORS_ENABLED=true
CORS_ALLOW_ORIGINS=http://127.0.0.1:5173
```

The backend can build `DATABASE_URL` from those values at runtime.

For S3, share one bucket if needed, but keep object prefixes separated:

```text
user-reports/
chat-attachments/
expert-profiles/
business-verifications/
credentials/
```

Business registration certificates and credentials should stay private and be accessed only through presigned URLs.

## Partner application workflow

The backend exposes FastAPI endpoints for partner onboarding and partner workspace operations. Applications are persisted in `consulting_partner_applications`; approval creates the `consulting_experts` profile, duration prices, and `consulting_partner_accounts` credential in one transaction. The web compatibility routes under `/api/consulting/partner/*` read those live consulting tables directly.

```text
POST /api/partner-applications
GET  /api/partner-applications/{application_id}/status
```

The route split also exposes production-shaped admin and partner API prefixes:

```text
GET  /api/admin/dashboard
GET  /api/admin/partner-applications
POST /api/admin/partner-applications/{application_id}/needs-update
POST /api/admin/partner-applications/{application_id}/reject
POST /api/admin/partner-applications/{application_id}/approve
POST /api/admin/partner-applications/documents/{document_id}/access
GET  /api/admin/businesses
GET  /api/admin/bookings
GET  /api/admin/summary-jobs

GET  /api/partner/me
POST /api/partner/me/password
GET  /api/partner/dashboard
GET  /api/partner/bookings
GET  /api/partner/customers
GET  /api/partner/customers/{customer_id}
GET  /api/partner/chats
GET  /api/partner/consultations/{booking_id}/summary
POST /api/partner/consultations/{booking_id}/summary/generate
GET  /api/partner/events
GET  /api/partner/events/snapshot

# Web compatibility status actions (POST is supported for hosted proxies that
# reject PATCH; the legacy PATCH route remains available.)
POST /api/consulting/partner/bookings/{booking_id}/status
PATCH /api/consulting/partner/bookings/{booking_id}/status

GET  /api/consulting/bookings/{booking_id}/summary
```

The admin API requires `X-Admin-Id` plus `X-Aura-Role: admin|operator`. Partner application list/detail/decision/document-access routes are admin-only; applicants only get the restricted status response and do not receive private document storage keys, review logs, or generated account details. The web compatibility partner API verifies an opaque bearer session stored as a SHA-256 hash in `consulting_partner_sessions`. Bookings, customers, chats, summaries, and reports are filtered server-side from that account's `expert_id` scope.

Run the contract smoke check without installing FastAPI locally:

```bash
python3 backend/scripts/smoke_partner_contract.py
```

It verifies admin route role guards, partner principal guards, join-derived booking business scope, business tenant isolation, expert personal scope, scoped booking create/update events, transactional approval rollback, AI summary generation, and customer-app visibility filtering.
The AI summary endpoint stores a `consulting_summaries` row and marks the booking completed after the video-consultation transcript is submitted.
Partner booking, summary, review, refund, and unread-chat events should be persisted through `partner_event_outbox` with a monotonically increasing `sequence`. SSE responses emit event `id:` fields, and clients can replay scoped events by `Last-Event-ID` or `afterId` cursor. React Query fallback refetch covers missing or expired cursors.
The frontend fallback refetch roots are centralized in `partnerEventRules` so disconnect recovery covers dashboard, bookings, completion candidates, chat threads, reviews, and summary jobs.

The intended production flow is:

```text
partner applicant = unapproved business/expert
submit application + private PDF documents
admin reviews documents
admin requests update, rejects, or approves
approval creates business, expert, partner account, business member, verified documents, and review logs in one transaction
failure rolls back partial business/expert/account/document/log mutations
partner account is created with password_change_required=true
partner logs in and is forced through first-password setup
```

Frontend route guards send password-change-required partner accounts to `/workspace/password` before allowing workspace operations.
The partner password endpoint verifies the current partner principal owns the account before setting `password_change_required=false` and `status=active`.
The schema draft mirrors this by enforcing account/member role and workspace scope combinations with check constraints, and by tying `business_members(account_id, business_id)` back to the same `partner_accounts(id, business_id)` pair.

## RDS schema draft

The draft SQL is in:

```text
backend/db/partner_applications_schema.sql
```

Do not apply it to the shared RDS database until these checks are done:

1. Compare table names with the existing mobile app backend schema.
2. Decide whether `businesses` and `experts` should reuse existing app tables or stay web-managed.
3. Confirm S3 object prefixes for private documents.
4. Confirm account/password policy before creating real partner accounts.
5. Run the SQL against a disposable database first.

PDF documents should be stored as private S3 objects. Store only `storage_bucket` and `storage_key` in RDS. Generate short-lived presigned URLs only when an authorized admin opens the document.

AI summary generation should write to `consulting_summaries` plus `consultation_summary_jobs`. Store transcript, internal memo, customer-visible summary, recommendations, model name, status, and `visible_to_customer` separately so the mobile app and web read the same saved result. Customer app reads should use `customer_visible_consulting_summaries` or the equivalent `visible_to_customer=true` plus completed booking join.

Partner customer lookup should use `partner_booking_customers` or the equivalent join instead of copying app customers into a partner-owned table.
App booking creation/update should emit `booking.created`/`booking.updated` events after deriving `business_id` from `consulting_experts`, not from client input.
Chat messages continue to use the consulting conversation WebSocket, while booking/summary/review/refund dashboard updates use the separate partner event stream backed by `partner_event_outbox`.
