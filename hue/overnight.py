"""Bounded, silent, single-controller overnight shows (no catch-up backlog)."""
import asyncio
from datetime import datetime, timezone
import json
from pathlib import Path
import random
import time


def iso(epoch):
    return datetime.fromtimestamp(epoch, timezone.utc).isoformat()


class Overnight:
    def __init__(self, path, clock=time.time, rng=None):
        self.path = Path(path)
        self.clock, self.rng = clock, rng or random.SystemRandom()
        self.data = json.loads(self.path.read_text())
        self.until = datetime.fromisoformat(self.data['until']).timestamp()
        self.next_at = datetime.fromisoformat(self.data['next_at']).timestamp()
        self.enabled = self.data.get('enabled') is True and self.clock() < self.until
        if self.enabled and self.next_at < self.clock():
            self.advance()

    def save(self):
        self.data.update(enabled=self.enabled, next_at=iso(self.next_at))
        temporary = self.path.with_suffix('.tmp')
        temporary.write_text(json.dumps(self.data, indent=2))
        temporary.chmod(0o600)
        temporary.replace(self.path)

    def advance(self):
        self.next_at = self.clock() + self.rng.uniform(18*60, 22*60)
        self.save()

    def stop(self, c, reason='Overnight schedule stopped'):
        self.enabled = False
        self.save()
        c.status(overnight_enabled=False, overnight_next_at=None)
        c.activity('schedule', reason, source='overnight')

    def report(self, c):
        c.status(overnight_enabled=self.enabled, overnight_until=iso(self.until),
                 overnight_next_at=iso(self.next_at) if self.enabled else None,
                 audio_enabled=False)

    async def run(self, c, sleep=asyncio.sleep):
        # A configuration mistake must never turn an overnight show into sound.
        if c.settings.get('audio_enabled') or c.sonos is not None:
            self.stop(c, 'Overnight refused: audio must be disabled')
            return
        self.report(c)
        if not self.enabled:
            return
        c.activity('schedule', 'Silent overnight shows enabled; 18–22 minute intervals', source='overnight')
        owned_task = None
        while self.enabled:
            now = self.clock()
            if now >= self.until:
                self.stop(c, 'Overnight schedule finished; lights off, sound stays disabled')
                if owned_task is c.sequence_task and owned_task and not owned_task.done():
                    await c.stop_sequence()
                await c.dark()
                return
            if now >= self.next_at:
                # Persist the next start before launching; a crash never replays
                # an overdue show or creates a burst of catch-up jobs.
                self.advance()
                self.report(c)
                active = any(task is not None and not task.done() for task in
                             (c.sequence_task, getattr(c, 'control_task', None)))
                if active or c.busy:
                    c.activity('schedule', 'Scheduled show skipped: controls busy', source='overnight')
                else:
                    c.gate.ready_at = float('inf')
                    owned_task = c.sequence_task = asyncio.create_task(
                        c.trigger(c.gate, sound=False, origin='overnight (silent)'))
                    c.activity('schedule', 'Next silent show: ' + iso(self.next_at), source='overnight')
            await sleep(max(0, min(1, self.next_at-self.clock(), self.until-self.clock())))

