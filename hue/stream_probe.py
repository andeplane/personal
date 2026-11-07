"""Observe actual DTLS writes without changing the Hue sender or packet contents."""
import time
from hue_entertainment import HueDtlsStreamer


class ObservedStreamer(HueDtlsStreamer):
    def __init__(self, observe=None, *, zero_sequence=False):
        super().__init__()
        self.observe = observe
        self.zero_sequence = zero_sequence

    def _build_huestream_message(self, commands):
        packet = super()._build_huestream_message(commands)
        if self.zero_sequence:
            # HueStream's optional sequence byte is independent of the DTLS
            # anti-replay record counter. Leave every cryptographic byte alone.
            packet = packet[:11] + b'\x00' + packet[12:]
        return packet

    def _sender_loop(self, connection):
        observer = self.observe
        queue = self._send_queue
        class ObservedConnection:
            def send(self, packet):
                before = time.monotonic()
                connection.send(packet)
                after = time.monotonic()
                if observer and packet[:9] == b'HueStream' and len(packet) >= 52 and (len(packet)-52) % 7 == 0:
                    colors = {}
                    for index in range(52, len(packet), 7):
                        colors[packet[index]] = [int.from_bytes(packet[index+n:index+n+2], 'big') for n in (1,3,5)]
                    observer('wire', sequence=packet[11], colors=colors,
                             send_ms=(after-before)*1000, queue_depth=queue.qsize())
            def close(self):connection.close()
        super()._sender_loop(ObservedConnection())
