"""One owned, prewarmed Entertainment connection shared by effects and dark idle."""
import asyncio
import contextlib
import time


async def _drain(task):
    """Wait through cancellation until a blocking connection attempt really ends."""
    while not task.done():
        try:
            await asyncio.shield(task)
        except asyncio.CancelledError:
            continue
        except Exception:
            break
    # Retrieve any exception so canceled callers never leave an unobserved task.
    with contextlib.suppress(asyncio.CancelledError, Exception):
        task.result()


class WarmSession:
    def __init__(self, streamer, acquire, release, connect, black_frame,
                 busy=lambda: False, verify=None, *, warmup=15.0,
                 warmup_hz=50.0, idle_hz=25.0, verify_interval=2.0):
        if warmup < 0 or min(warmup_hz, idle_hz, verify_interval) <= 0:
            raise ValueError('Invalid streaming timing')
        self.streamer = streamer
        self.acquire, self.release, self.connect = acquire, release, connect
        self.black_frame, self.busy, self.verify = black_frame, busy, verify
        self.warmup, self.warmup_hz = warmup, warmup_hz
        self.idle_hz, self.verify_interval = idle_hz, verify_interval
        self.ready = self.owned = False
        self.last_error = None
        self._connection_started = False
        self._lock = asyncio.Lock()
        self._prepare_task = None
        self._generation = 0

    async def _cleanup(self):
        self.ready = False
        owned, connected = self.owned, self._connection_started
        self.owned = self._connection_started = False
        try:
            if connected:
                task = asyncio.create_task(asyncio.to_thread(self.streamer.disconnect))
                try:
                    await asyncio.shield(task)
                except asyncio.CancelledError:
                    await _drain(task)
                    raise
        finally:
            if owned:
                # The caller must check ownership before stopping the Bridge area.
                task = asyncio.create_task(self.release())
                try:
                    await asyncio.shield(task)
                except asyncio.CancelledError:
                    await _drain(task)
                    raise

    async def _prepare(self, generation):
        try:
            acquiring = asyncio.create_task(self.acquire())
            try:
                self.owned = bool(await asyncio.shield(acquiring))
            except asyncio.CancelledError:
                # Starting the Bridge area is also a side effect: learn whether
                # it succeeded before deciding if ownership needs releasing.
                await _drain(acquiring)
                if not acquiring.cancelled() and acquiring.exception() is None:
                    self.owned = bool(acquiring.result())
                raise
            if not self.owned:
                return False
            if generation != self._generation:
                raise asyncio.CancelledError
            self._connection_started = True
            connection = asyncio.create_task(asyncio.to_thread(self.connect))
            try:
                await asyncio.shield(connection)
            except asyncio.CancelledError:
                # to_thread cancellation cannot stop the underlying DTLS handshake.
                # Drain it before cleanup so it cannot create a sender afterward.
                await _drain(connection)
                raise
            deadline = time.monotonic() + self.warmup
            while time.monotonic() < deadline:
                if generation != self._generation:
                    raise asyncio.CancelledError
                if not self.streamer.is_connected:
                    raise ConnectionError('Entertainment sender disconnected during warmup')
                self.streamer.send_colors(self.black_frame())
                await asyncio.sleep(min(1 / self.warmup_hz, max(0, deadline-time.monotonic())))
            if self.verify:
                await self.verify()
            if generation != self._generation or not self.streamer.is_connected:
                raise ConnectionError('Entertainment connection is no longer ready')
            self.ready = True
            self.last_error = None
            return True
        except BaseException:
            await self._cleanup()
            raise

    async def ensure(self):
        """Prepare once, or reuse the owned session; False means another owner won."""
        async with self._lock:
            if self.ready:
                try:
                    if not self.streamer.is_connected:
                        raise ConnectionError('Entertainment sender disconnected')
                    if self.verify:
                        await self.verify()
                    return True
                except BaseException:
                    await self._cleanup()
                    raise
            task = self._prepare_task = asyncio.create_task(self._prepare(self._generation))
            try:
                return await asyncio.shield(task)
            except asyncio.CancelledError:
                task.cancel()
                await _drain(task)
                raise
            finally:
                self._prepare_task = None

    async def stop(self):
        """Cancel preparation, drain any connection worker, and release our session."""
        self._generation += 1
        task = self._prepare_task
        if task and not task.done():
            task.cancel()
            await _drain(task)
        async with self._lock:
            await self._cleanup()

    async def loop(self):
        """Keep idle lights black and validate transport; failed sessions need ensure()."""
        checked_at = 0.0
        try:
            while True:
                try:
                    async with self._lock:
                        if self.ready:
                            if not self.streamer.is_connected:
                                raise ConnectionError('Entertainment sender disconnected')
                            if self.verify and time.monotonic()-checked_at >= self.verify_interval:
                                await self.verify()
                                checked_at = time.monotonic()
                            if not self.busy():
                                self.streamer.send_colors(self.black_frame())
                except Exception as error:
                    self.last_error = error
                    async with self._lock:
                        await self._cleanup()
                await asyncio.sleep(1 / self.idle_hz)
        finally:
            await self.stop()
