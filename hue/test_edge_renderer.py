import asyncio
import unittest
import random
from edge_renderer import BLACK, WHITE, build_edges as build_random_edges, render_edges


def build_edges(*args, **kwargs):
    kwargs.setdefault("randomize_opening", False)
    return build_random_edges(*args, **kwargs)

NORMAL = (23000,15000,2000)
ANCHOR = (46000,30000,4000)


class EdgePlanTests(unittest.TestCase):
    def fixture(self):
        plan=[('normal',2),('dark',.5),('lightning',4),('steady',8),('lightning',4),('steady',12)]
        cues=[(.12,.28,1),(.78,.94,.6),(1.44,1.60,1),(2.10,2.26,.4),(2.76,2.92,1),(3.42,3.58,1)]
        patterns={index:{0:cues,1:[(a+.02,b+.02,p) for a,b,p in cues]} for index in (2,4)}
        return plan,patterns

    def test_opening_anchor_short_white_and_final_darkness(self):
        plan,patterns=self.fixture();edges=build_edges(plan,patterns,[0,1],NORMAL,ANCHOR)
        self.assertEqual(edges[0],(0,{0:NORMAL,1:NORMAL}))
        self.assertEqual(edges[1],(2,{0:BLACK,1:BLACK}))
        self.assertEqual(edges[-1],(sum(d for _,d in plan),{0:BLACK}))
        state={};starts={};widths=[]
        for at,colors in edges:
            for channel,color in colors.items():
                if color==WHITE:starts[channel]=at
                elif state.get(channel)==WHITE:widths.append(at-starts.pop(channel))
                state[channel]=color
            if 6.5<=at<sum(d for _,d in plan):self.assertEqual(state[0],ANCHOR)
        self.assertEqual(len(widths),18)
        self.assertTrue(all(.18<=width<=.22+1e-9 for width in widths))
        self.assertTrue(all(color in (BLACK,WHITE,NORMAL,ANCHOR) for _,colors in edges for color in colors.values()))
        self.assertEqual(state,{0:BLACK,1:BLACK})

    def test_close_cues_are_skipped_without_lengthening_white_hold(self):
        cues=[(.1,.15,1),(.2,.25,1),(.75,.8,1),(1.4,1.5,1)]
        edges=build_edges([('lightning',2)],{0:{0:cues}},[0],NORMAL,ANCHOR)
        on=[at for at,colors in edges if colors.get(0)==WHITE]
        self.assertEqual(on,[.1,.75,1.4])
        self.assertTrue(all(b-a>=.60-1e-9 for a,b in zip(on,on[1:])))

    def test_nearby_source_cues_shift_within_bound_instead_of_disappearing(self):
        starts=[.18,.82,1.36,2.16,2.86,3.42]
        cues=[(at,at+.14,1) for at in starts]
        edges=build_edges([('lightning',4)],{0:{0:cues,1:cues}},[0,1],NORMAL,ANCHOR)
        actual=[at for at,colors in edges if colors.get(0)==WHITE]
        expected=[.18,.82,1.42,2.16,2.86,3.46]
        self.assertEqual(len(actual),6)
        for at,wanted,source in zip(actual,expected,starts):
            self.assertAlmostEqual(at,wanted)
            self.assertLessEqual(at-source,.12)

    def test_two_channel_schedule_respects_rolling_write_budget(self):
        plan,patterns=self.fixture();edges=build_edges(plan,patterns,[0,1],NORMAL,ANCHOR)
        for at,_ in edges:
            writes=sum(len(colors) for when,colors in edges if at-1-1e-9<=when<=at+1e-9)
            self.assertLessEqual(writes,10)
        with self.assertRaises(ValueError):
            build_edges([('normal',.1),('dark',.1)]*5,{},[0,1],NORMAL,ANCHOR)

    def test_merge_cannot_swallow_phase_edge_or_make_long_white_hold(self):
        patterns={0:{0:[(.025,.1,1)],1:[(.005,.1,1)]}}
        edges=build_edges([('lightning',1)],patterns,[0,1],NORMAL,ANCHOR)
        starts={};widths=[];state={}
        for at,colors in edges:
            for channel,color in colors.items():
                if color==WHITE:starts[channel]=at
                elif state.get(channel)==WHITE:widths.append(at-starts[channel])
                state[channel]=color
        self.assertEqual(len(widths),2)
        self.assertTrue(all(.18-1e-9<=width<=.22+1e-9 for width in widths))

    def test_invalid_pulse_and_duplicate_channels_are_rejected(self):
        for kwargs in ({'pulse_width':.5},{'min_pulse_spacing':.1},{'merge_window':.03},{'max_cue_shift':.13}):
            with self.assertRaises(ValueError):build_edges([('dark',1)],{},[0,1],NORMAL,ANCHOR,**kwargs)
        with self.assertRaises(ValueError):build_edges([('dark',1)],{},[0,0],NORMAL,ANCHOR)


class RandomOpeningTests(unittest.TestCase):
    def fixture(self):
        return EdgePlanTests().fixture()

    def test_openings_vary_with_clusters_and_longer_pauses(self):
        plan,patterns=self.fixture()
        signatures=[]
        for seed in range(60):
            edges=build_random_edges(plan,patterns,[0,1],NORMAL,ANCHOR,rng=random.Random(seed))
            starts=[at-2.5 for at,colors in edges if 2.5<=at<6.5 and colors.get(0)==WHITE]
            self.assertAlmostEqual(starts[0],.12)
            self.assertTrue(4<=len(starts)<=6)
            gaps=[b-a for a,b in zip(starts,starts[1:])]
            self.assertGreaterEqual(min(gaps),.55-1e-9)
            self.assertLessEqual(min(gaps),.68+1e-9)
            self.assertGreaterEqual(max(gaps),.90-1e-9)
            self.assertGreater(max(gaps)-min(gaps),.20)
            signatures.append(tuple(round(at,4) for at in starts))
            for at,_ in edges:
                self.assertLessEqual(sum(len(colors) for when,colors in edges if at-1-1e-9<=when<=at+1e-9),10)
        self.assertGreater(len(set(signatures)),50)

    def test_random_opening_preserves_later_bursts_and_pulse_widths(self):
        plan,patterns=self.fixture()
        fixed=build_edges(plan,patterns,[0,1],NORMAL,ANCHOR)
        for seed in range(20):
            edges=build_random_edges(plan,patterns,[0,1],NORMAL,ANCHOR,rng=random.Random(seed))
            self.assertEqual([edge for edge in edges if edge[0]>=6.5],
                             [edge for edge in fixed if edge[0]>=6.5])
            state={};on={}
            for at,colors in edges:
                for channel,color in colors.items():
                    if color==WHITE:on[channel]=at
                    elif state.get(channel)==WHITE:
                        self.assertTrue(.18-1e-9<=at-on[channel]<=.22+1e-9)
                    state[channel]=color
            self.assertEqual(state,{0:BLACK,1:BLACK})

    def test_manual_flash_randomizes_but_small_patterns_fall_back(self):
        cues=[(.12,.28,1),(.78,.94,1),(1.44,1.6,1),(2.1,2.26,1),(2.76,2.92,1),(3.42,3.58,1)]
        signatures=set()
        for seed in range(20):
            edges=build_random_edges([('lightning',4)],{0:{0:cues,1:cues}},[0,1],NORMAL,ANCHOR,rng=random.Random(seed))
            signatures.add(tuple(at for at,colors in edges if colors.get(0)==WHITE))
            self.assertEqual(edges[-1][1],{0:BLACK,1:BLACK})
        self.assertGreater(len(signatures),15)
        short={0:{0:[(.1,.2,1)]}}
        self.assertEqual(build_random_edges([('lightning',1)],short,[0],NORMAL,ANCHOR),
                         build_edges([('lightning',1)],short,[0],NORMAL,ANCHOR))


class ThreeChannelTests(unittest.TestCase):
    def fixture(self):
        plan,patterns=EdgePlanTests().fixture()
        patterns={index:{**by_channel,2:list(by_channel[1])} for index,by_channel in patterns.items()}
        return plan,patterns

    def test_shared_opening_is_sparse_and_later_flashers_are_independent(self):
        plan,patterns=self.fixture()
        edges=build_random_edges(plan,patterns,[0,1,2],NORMAL,ANCHOR,rng=random.Random(2))
        opening={channel:[at for at,colors in edges if 2.5<=at<6.5 and colors.get(channel)==WHITE]
                 for channel in (0,1,2)}
        self.assertEqual(opening[0],opening[1])
        self.assertEqual(opening[1],opening[2])
        self.assertTrue(3<=len(opening[0])<=4)
        self.assertTrue(all(b-a>=.88-1e-9 for a,b in zip(opening[0],opening[0][1:])))
        late={channel:[at for at,colors in edges if at>=6.5 and colors.get(channel)==WHITE]
              for channel in (0,1,2)}
        self.assertEqual(late[0],[])
        self.assertTrue(late[1]);self.assertTrue(late[2])
        self.assertNotEqual(late[1],late[2])
        state={};starts={}
        for at,colors in edges:
            for channel,color in colors.items():
                if color==WHITE:starts[channel]=at
                elif state.get(channel)==WHITE:
                    self.assertTrue(.18-1e-9<=at-starts[channel]<=.22+1e-9)
                state[channel]=color
            if 6.5<=at<sum(d for _,d in plan):self.assertEqual(state[0],ANCHOR)
            self.assertLessEqual(sum(len(change) for when,change in edges if at-1-1e-9<=when<=at+1e-9),10)
        self.assertEqual(state,{0:BLACK,1:BLACK,2:BLACK})

    def test_three_channel_profile_does_not_mutate_input_patterns(self):
        import copy
        plan,patterns=self.fixture();original=copy.deepcopy(patterns)
        first=build_edges(plan,patterns,[0,1,2],NORMAL,ANCHOR)
        second=build_edges(plan,patterns,[0,1,2],NORMAL,ANCHOR)
        self.assertEqual(first,second)
        self.assertEqual(patterns,original)

    def test_three_channel_manual_flash_is_bounded_and_ends_dark(self):
        cues=[(.12,.28,1),(.78,.94,1),(1.44,1.6,1),(2.1,2.26,1),(2.76,2.92,1),(3.42,3.58,1)]
        for seed in range(25):
            edges=build_random_edges([('lightning',4)],{0:{channel:cues for channel in (0,1,2)}},
                                     [0,1,2],NORMAL,ANCHOR,rng=random.Random(seed))
            self.assertLessEqual(edges[-1][0],4)
            self.assertEqual(edges[-1][1],{0:BLACK,1:BLACK,2:BLACK})
            for at,_ in edges:
                self.assertLessEqual(sum(len(change) for when,change in edges if at-1-1e-9<=when<=at+1e-9),10)


class EdgeRenderTests(unittest.IsolatedAsyncioTestCase):
    async def test_absolute_timing_and_changed_channels_only(self):
        now=100.0;writes=[];observations=[]
        async def sleep(delay):
            nonlocal now
            now+=delay
        async def send(colors):writes.append((round(now,3),colors))
        edges=[(0,{0:NORMAL,1:NORMAL}),(2,{0:BLACK,1:BLACK}),(2.5,{1:WHITE}),(2.7,{1:BLACK}),(4,{0:BLACK,1:BLACK})]
        stats=await render_edges(edges,send,clock=lambda:now,sleep=sleep,observe=observations.append)
        self.assertEqual([at for at,_ in writes],[100,102,102.5,102.7])
        self.assertEqual(writes[-1][1],{1:BLACK})
        self.assertEqual(stats['sends'],4)
        self.assertEqual(stats['channel_writes'],6)
        self.assertEqual(stats['elapsed'],4)
        self.assertEqual(len(observations),4)

    async def test_slow_writer_does_not_replay_expired_white_pulses(self):
        now=0.;writes=[]
        async def sleep(delay):
            nonlocal now
            now+=delay
        async def send(colors):
            nonlocal now
            writes.append((round(now,2),colors));now+=1.5
        edges=[(0,{0:BLACK}),(.1,{0:WHITE}),(.3,{0:BLACK}),(.8,{0:WHITE}),(1,{0:BLACK}),(2,{0:WHITE}),(2.2,{0:BLACK})]
        stats=await render_edges(edges,send,clock=lambda:now,sleep=sleep)
        self.assertEqual(writes,[(0.,{0:BLACK}),(2.,{0:WHITE}),(3.5,{0:BLACK})])
        self.assertGreater(stats['collapsed_edges'],0)

    async def test_cancellation_drains_late_on_before_final_off(self):
        entered=asyncio.Event();release=asyncio.Event();writes=[]
        async def send(colors):
            if colors.get(0)==WHITE:
                entered.set();await release.wait()
            writes.append(colors)
        task=asyncio.create_task(render_edges([(0,{0:WHITE}),(1,{0:BLACK})],send))
        await entered.wait();task.cancel();await asyncio.sleep(0)
        self.assertFalse(task.done())
        release.set()
        with self.assertRaises(asyncio.CancelledError):await task
        self.assertEqual(writes,[{0:WHITE},{0:BLACK}])
