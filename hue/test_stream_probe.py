import unittest
from hue_entertainment import HueDtlsStreamer,LightColorCommand
from stream_probe import ObservedStreamer


class FrameSequenceTests(unittest.TestCase):
    def test_zero_sequence_changes_only_optional_plaintext_header_byte(self):
        normal=HueDtlsStreamer();stable=ObservedStreamer(zero_sequence=True)
        for sender in (normal,stable):sender._area_uuid_bytes=b'00000000-0000-0000-0000-000000000000'
        commands=[LightColorCommand(channel_id=0,red=65535,green=65535,blue=65535)]
        for index in range(600):
            before=normal._build_huestream_message(commands)
            after=stable._build_huestream_message(commands)
            self.assertEqual(before[11],index%256)
            self.assertEqual(after[11],0)
            self.assertEqual(before[:11]+before[12:],after[:11]+after[12:])
