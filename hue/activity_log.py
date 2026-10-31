"""Private, persistent activity history for motion and scene diagnostics."""
import os
from contextlib import closing
from pathlib import Path
import sqlite3
from datetime import datetime, timezone


class ActivityLog:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        fd = os.open(self.path, os.O_CREAT | os.O_APPEND | os.O_WRONLY, 0o600)
        os.close(fd)
        os.chmod(self.path, 0o600)
        with closing(sqlite3.connect(self.path, timeout=2)) as db:
            db.execute('CREATE TABLE IF NOT EXISTS activity (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, kind TEXT NOT NULL, message TEXT NOT NULL, source TEXT, dedup TEXT UNIQUE)')
            db.commit()
        self.last_unstamped = None

    def add(self, kind, message, *, source=None, at=None, dedup=None):
        timestamp = at or datetime.now(timezone.utc).isoformat()
        with closing(sqlite3.connect(self.path, timeout=2)) as db:
            db.execute('INSERT OR IGNORE INTO activity(at,kind,message,source,dedup) VALUES (?,?,?,?,?)',
                       (timestamp, kind, message, source, dedup))
            db.commit()

    def motion(self, present, stamp, source, detail):
        if stamp is None:
            if self.last_unstamped == present:
                return
            self.last_unstamped = present
            timestamp, key = None, None
        else:
            self.last_unstamped = present
            timestamp = datetime.fromtimestamp(stamp, timezone.utc).isoformat()
            key = f'motion:{stamp:.6f}:{int(present)}'
        self.add('motion', detail, source=source, at=timestamp, dedup=key)

    def page(self, before=None, limit=100):
        if before is not None and (isinstance(before, bool) or not isinstance(before, int) or before <= 0):
            raise ValueError('Invalid activity cursor')
        with closing(sqlite3.connect(self.path, timeout=2)) as db:
            db.row_factory = sqlite3.Row
            rows = db.execute('SELECT id,at,kind,message,source FROM activity WHERE (? IS NULL OR id < ?) ORDER BY id DESC LIMIT ?',
                              (before, before, limit+1)).fetchall()
        return {'activity': [dict(row) for row in rows[:limit]], 'activity_more': len(rows) > limit}
