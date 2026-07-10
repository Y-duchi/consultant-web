from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

import asyncpg

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.settings import Settings


TABLES = [
  "users",
  "consulting_experts",
  "consulting_bookings",
  "consulting_messages",
  "consulting_message_media",
  "consulting_payments",
  "consulting_summaries",
  "consulting_partner_accounts",
  "analysis_reports",
  "makeup_feedback_reports",
  "media_assets",
]


async def main() -> None:
  settings = Settings()
  connection = await asyncpg.connect(dsn=settings.asyncpg_dsn)
  try:
    rows = await connection.fetch(
      """
      select table_name, column_name, data_type, is_nullable
      from information_schema.columns
      where table_schema = 'public'
        and table_name = any($1::text[])
      order by table_name, ordinal_position
      """,
      TABLES,
    )
  finally:
    await connection.close()

  result: dict[str, list[dict[str, str]]] = {}
  for row in rows:
    result.setdefault(row["table_name"], []).append({
      "column": row["column_name"],
      "type": row["data_type"],
      "nullable": row["is_nullable"],
    })

  print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
  asyncio.run(main())
