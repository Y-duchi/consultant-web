from functools import lru_cache
import json
from urllib.parse import quote

import boto3
from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
  app_name: str = "AURA Partner Manager API"
  app_env: str = Field(default="local", validation_alias=AliasChoices("ENVIRONMENT", "APP_ENV"))
  api_host: str = "127.0.0.1"
  api_port: int = 8000

  database_url: str | None = None
  database_secret_id: str | None = None
  db_driver: str = "postgresql"
  db_host: str | None = None
  db_port: int = 5432
  db_name: str | None = None
  db_user: str | None = None
  db_password: str | None = None
  db_sslmode: str | None = Field(default="require", validation_alias=AliasChoices("DB_SSLMODE", "DB_SSL"))

  aws_region: str = "ap-northeast-2"
  aws_profile_name: str | None = Field(default=None, validation_alias=AliasChoices("AWS_PROFILE_NAME", "AWS_PROFILE"))
  aws_access_key_id: str | None = None
  aws_secret_access_key: str | None = None
  aws_session_token: str | None = None
  aws_use_iam_role: bool = False

  s3_bucket_name: str | None = Field(default=None, validation_alias=AliasChoices("S3_BUCKET_NAME", "S3_BUCKET"))
  s3_public_prefix: str = "public/"
  s3_private_prefix: str = "private/"
  s3_user_reports_prefix: str = "user-reports/"
  s3_chat_attachments_prefix: str = "chat-attachments/"
  s3_expert_profiles_prefix: str = "expert-profiles/"
  s3_business_verifications_prefix: str = "business-verifications/"
  s3_credentials_prefix: str = "credentials/"

  frontend_origin: str = "http://127.0.0.1:5173"
  cors_enabled: bool = True
  cors_origins_raw: str = Field(
    default="http://127.0.0.1:5173",
    validation_alias=AliasChoices("CORS_ALLOW_ORIGINS", "CORS_ORIGINS"),
  )

  sms_provider: str | None = None
  chat_provider: str | None = None
  payment_provider: str | None = None
  openai_api_key: str | None = None
  openai_summary_model: str = "OPENAI_SUMMARY_MODEL"

  model_config = SettingsConfigDict(
    env_file=("backend/.env", ".env"),
    env_file_encoding="utf-8",
    extra="ignore",
    populate_by_name=True,
  )

  @property
  def cors_origins(self) -> list[str]:
    return [origin.strip() for origin in self.cors_origins_raw.split(",") if origin.strip()]

  @property
  def db_configured(self) -> bool:
    return bool(
      self.database_url
      or self.database_secret_id
      or (self.db_host and self.db_name and self.db_user and self.db_password)
    )

  @property
  def s3_configured(self) -> bool:
    return bool(self.s3_bucket_name)

  @property
  def asyncpg_dsn(self) -> str | None:
    if self.database_url:
      return self.database_url.replace("postgresql+asyncpg://", "postgresql://", 1)

    if self.database_secret_id:
      secret = self._read_database_secret()
      user = quote(str(secret.get("username") or secret.get("user") or ""), safe="")
      password = quote(str(secret.get("password") or ""), safe="")
      host = secret.get("host") or self.db_host
      port = int(secret.get("port") or self.db_port)
      database = secret.get("dbname") or secret.get("database") or self.db_name
      sslmode = secret.get("sslmode") or self.db_sslmode

      if not user or not password or not host or not database:
        raise RuntimeError("DATABASE_SECRET_ID must provide username, password, host, and dbname/database.")

      ssl_query = f"?ssl={quote(str(sslmode))}" if sslmode else ""
      return f"postgresql://{user}:{password}@{host}:{port}/{database}{ssl_query}"

    if not self.db_configured:
      return None

    user = quote(self.db_user or "", safe="")
    password = quote(self.db_password or "", safe="")
    ssl_query = f"?ssl={quote(self.db_sslmode)}" if self.db_sslmode else ""
    return f"postgresql://{user}:{password}@{self.db_host}:{self.db_port}/{self.db_name}{ssl_query}"

  def _read_database_secret(self) -> dict[str, object]:
    client_kwargs: dict[str, object] = {"region_name": self.aws_region}

    if self.aws_access_key_id and self.aws_secret_access_key and not self.aws_use_iam_role:
      client_kwargs.update(
        {
          "aws_access_key_id": self.aws_access_key_id,
          "aws_secret_access_key": self.aws_secret_access_key,
          "aws_session_token": self.aws_session_token,
        },
      )

    client = boto3.client("secretsmanager", **client_kwargs)
    response = client.get_secret_value(SecretId=self.database_secret_id)
    payload = response.get("SecretString")

    if not payload:
      raise RuntimeError("DATABASE_SECRET_ID did not return SecretString.")

    secret = json.loads(payload)

    if not isinstance(secret, dict):
      raise RuntimeError("DATABASE_SECRET_ID must be a JSON object.")

    return secret

  def public_status(self) -> dict[str, object]:
    return {
      "appEnv": self.app_env,
      "database": {
        "configured": self.db_configured,
        "source": "DATABASE_URL"
        if self.database_url
        else "DATABASE_SECRET_ID"
        if self.database_secret_id
        else "split env"
        if self.db_configured
        else "missing",
        "hostConfigured": bool(self.db_host),
        "nameConfigured": bool(self.db_name),
        "userConfigured": bool(self.db_user),
        "passwordConfigured": bool(self.db_password),
      },
      "aws": {
        "region": self.aws_region,
        "credentialSource": "iam_role"
        if self.aws_use_iam_role
        else "profile"
        if self.aws_profile_name
        else "access_key"
        if self.aws_access_key_id and self.aws_secret_access_key
        else "missing",
      },
      "s3": {
        "configured": self.s3_configured,
        "bucketConfigured": bool(self.s3_bucket_name),
      },
      "corsOrigins": self.cors_origins,
    }


@lru_cache
def get_settings() -> Settings:
  return Settings()
