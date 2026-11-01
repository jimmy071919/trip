#!/bin/sh
set -e

# Wait for the database (compose healthcheck normally guarantees this; this is a safety net)
python - <<'PY'
import sys, time
from sqlalchemy import create_engine, text
from app.config import get_settings
url = get_settings().database_url
for i in range(60):
    try:
        with create_engine(url).connect() as c:
            c.execute(text("SELECT 1"))
        break
    except Exception as e:
        print(f"waiting for database ({i+1}/60): {e.__class__.__name__}", flush=True)
        time.sleep(2)
else:
    sys.exit("database not reachable")
PY

echo "running migrations"
alembic upgrade head

exec uvicorn app.main:app --host 0.0.0.0 --port 8000 \
  --proxy-headers --forwarded-allow-ips="*" --no-server-header
