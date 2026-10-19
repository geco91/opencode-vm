"""Checkpoint credentials from the pinned V2 schema without printing secrets.

Called after runtime writers stop, including crash recovery. The native DB and
session history stay unchanged; snapshots remain in this project's namespace.
"""
import json
import os
from pathlib import Path
import sqlite3
import stat
import sys
import tempfile


def checkpoint(database, destinations):
    database = Path(database)
    info = database.lstat()
    if not stat.S_ISREG(info.st_mode) or database.resolve() != database:
        raise ValueError("V2_CREDENTIAL_DATABASE_UNSAFE")
    connection = sqlite3.connect(database.as_uri() + "?mode=ro", uri=True)
    try:
        connection.execute("PRAGMA query_only=ON")
        rows = connection.execute(
            "SELECT id, integration_id, label, active, value FROM credential "
            "WHERE integration_id IS NOT NULL ORDER BY time_created, id LIMIT 10001"
        ).fetchall()
    finally:
        connection.close()
    if len(rows) > 10000:
        raise ValueError("V2_CREDENTIAL_LIMIT")
    data = []
    for identifier, integration, label, active, raw in rows:
        value = json.loads(raw)
        if not isinstance(value, dict) or value.get("type") not in ("key", "oauth", "external"):
            raise ValueError("V2_CREDENTIAL_SCHEMA_UNSUPPORTED")
        data.append(dict(id=identifier, integrationID=integration, label=label,
                         active=bool(active), value=value))
    encoded = json.dumps(dict(version="2.0.32", data=data)).encode()
    if len(encoded) > 1024 * 1024:
        raise ValueError("V2_CREDENTIAL_LIMIT")
    for destination in destinations:
        target = Path(destination)
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        if target.parent.resolve() != target.parent or target.is_symlink():
            raise ValueError("V2_CREDENTIAL_SNAPSHOT_UNSAFE")
        if target.exists() and not target.is_file():
            raise ValueError("V2_CREDENTIAL_SNAPSHOT_UNSAFE")
        descriptor, name = tempfile.mkstemp(dir=target.parent, prefix=".credentials-v2-")
        try:
            with os.fdopen(descriptor, "wb") as output:
                output.write(encoded)
                output.flush()
                os.fsync(output.fileno())
            os.replace(name, target)
        finally:
            if os.path.exists(name):
                os.unlink(name)


if __name__ == "__main__":
    try:
        checkpoint(sys.argv[1], sys.argv[2:])
    except Exception:
        sys.exit("V2 credential checkpoint failed; retain the VM/database for recovery.")
