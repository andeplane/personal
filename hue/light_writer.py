"""Shared, cancellation-safe REST light writer with a rolling request budget."""
import asyncio
from collections import deque
from collections.abc import Mapping
from copy import deepcopy
import time


async def _drain(tasks):
    """Wait for every admitted blocking request, even through cancellation."""
    waiter = asyncio.gather(*tasks, return_exceptions=True)
    while not waiter.done():
        try:
            await asyncio.shield(waiter)
        except asyncio.CancelledError:
            continue
    return waiter.result()


class LightWriter:
    def __init__(self, request_callback, clock=time.monotonic,
                 sleep=asyncio.sleep, limit=10):
        if isinstance(limit, bool) or not isinstance(limit, int) or limit <= 0:
            raise ValueError('Light-write limit must be a positive integer')
        self.request = request_callback
        self.clock, self.sleep, self.limit = clock, sleep, limit
        self._admitted = deque()
        self._lock = asyncio.Lock()

    async def _reserve(self):
        waited = 0.0
        while True:
            now = self.clock()
            while self._admitted and now-self._admitted[0] >= 1.0:
                self._admitted.popleft()
            if len(self._admitted) < self.limit:
                self._admitted.append(now)
                return waited
            delay = max(0, self._admitted[0]+1.0-now)
            await self.sleep(delay)
            waited += delay

    def _request(self, identifier, body):
        started = time.perf_counter()
        result = self.request(identifier, body)
        return result, (time.perf_counter()-started)*1000

    async def write(self, states):
        """Write selected states in order, with at most two requests in flight.

        The budget is shared across calls, including failed requests. Concurrent
        calls are serialized, so a later off cannot overtake an older on. If this
        call is canceled, unissued states are discarded and admitted requests
        finish before the lock is released. The caller can then write final off.

        Returns ``results`` and ``request_ms`` mappings keyed by identifier, plus
        cumulative ``wait_ms`` spent waiting for the rolling request budget.
        """
        if not isinstance(states, Mapping) or any(not isinstance(body, Mapping) for body in states.values()):
            raise ValueError('Expected an identifier-to-state mapping')
        pending = [(identifier, deepcopy(dict(body))) for identifier, body in states.items()]
        result = {'results': {}, 'request_ms': {}, 'wait_ms': 0.0}
        async with self._lock:
            for index in range(0, len(pending), 2):
                tasks, identifiers = [], []
                try:
                    for identifier, body in pending[index:index+2]:
                        result['wait_ms'] += 1000*await self._reserve()
                        identifiers.append(identifier)
                        tasks.append(asyncio.create_task(asyncio.to_thread(self._request, identifier, body)))
                    values = await asyncio.gather(*(asyncio.shield(task) for task in tasks))
                except BaseException:
                    await _drain(tasks)
                    raise
                for identifier, (value, milliseconds) in zip(identifiers, values):
                    result['results'][identifier] = value
                    result['request_ms'][identifier] = milliseconds
        return result
