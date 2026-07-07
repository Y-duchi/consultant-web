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
