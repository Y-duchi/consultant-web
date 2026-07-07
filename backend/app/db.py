import asyncpg

from app.settings import Settings


async def fetch_one(settings: Settings, query: str, *args):
  if not settings.asyncpg_dsn:
    raise RuntimeError("Database is not configured.")

  connection = await asyncpg.connect(dsn=settings.asyncpg_dsn)
  try:
    return await connection.fetchrow(query, *args)
  finally:
    await connection.close()


async def check_database(settings: Settings) -> dict[str, object]:
  row = await fetch_one(settings, "select 1 as ok")
  return {"status": "ok", "ok": row["ok"] == 1}
