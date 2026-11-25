"""Bounded on/off edge effects for installations with unreliable streaming output."""
import asyncio
import contextlib
from pathlib import Path
import time

from hue import HueError
from edge_renderer import build_edges, render_edges


async def rest_effect(c, plan_override=None, sound=True):
    from lightning import sequence, lightning_patterns, recorded_patterns, load_soundtracks, STEADY, ANCHOR
    from sonos_audio import play_timeline
    c.busy = True
    c.status(state='starting', phase='preparing', stream_connected=False)
    audio_task = None
    phase_task = None
    acquired = False
    colors = {channel:(0,0,0) for channel in c.settings['channels']}
    mapping = dict(zip(c.settings['channels'],c.settings['lights']))
    white_ack = {}
    final_edge = False

    async def send(changes):
        hold = c.settings.get('rest_minimum_white_hold', .23)
        remaining = max((hold-(time.monotonic()-white_ack[channel])
                         for channel,rgb in changes.items()
                         if rgb != (65535,65535,65535) and channel in white_ack), default=0)
        if remaining > 0:
            await asyncio.sleep(remaining)
        states={}
        started=time.monotonic()
        for channel,rgb in changes.items():
            if channel not in mapping:
                raise HueError('Unselected channel')
            gap = c.settings.get('active_gap_brightness',0) if not any(rgb) and not final_edge else 0
            body={'on':bool(any(rgb) or gap),'transitiontime':0}
            if body['on']:
                body['alert']='none'
                body.update(bri=int(gap) if gap else max(1,min(254,round(max(rgb)/65535*254))),
                            xy=[.313,.329] if any(rgb) and rgb[0]==rgb[1]==rgb[2] else [.50,.42])
            states[mapping[channel]]=body
        result=await c.write_lights(states)
        for channel,rgb in changes.items():
            if rgb==(65535,65535,65535):white_ack[channel]=time.monotonic()
            else:white_ack.pop(channel,None)
        colors.update(changes)
        c.trace('rest_edge',colors=dict(colors),request_ms=(time.monotonic()-started)*1000,
                budget_wait_ms=result['wait_ms'],active_gap_brightness=c.settings.get('active_gap_brightness',0) if not final_edge else 0)

    try:
        if c.settings.get('trace_directory'):
            directory=Path(c.settings['trace_directory']);directory.mkdir(parents=True,exist_ok=True,mode=0o700)
            path=directory/('sequence-'+str(time.time_ns())+'.jsonl')
            with c.trace_lock:
                c.trace_handle=path.open('w');path.chmod(0o600)
            c.trace('starting',renderer='rest_edges')
        group=await asyncio.to_thread(c.bridge.request,'GET','/groups/'+c.settings['group'])
        if set(group['lights'])!=set(c.settings['lights']):
            raise HueError('Room membership changed')
        areas=await c.request('GET','/clip/v2/resource/entertainment_configuration')
        if any(area['status']=='active' for area in areas):
            c.status(state='skipped',reason='another_entertainment_stream')
            return False
        acquired=True
        plan=plan_override if plan_override is not None else sequence()
        channels=c.settings['channels']
        patterns=lightning_patterns(plan,channels)
        tracks={}
        if c.settings.get('thunder_catalog'):
            patterns,tracks=recorded_patterns(plan,channels,load_soundtracks(c.settings['thunder_catalog']))
        edges=build_edges(plan,patterns,channels,STEADY,ANCHOR)
        start=time.monotonic()
        c.trace('plan',plan=plan,patterns=patterns,channels=channels,renderer='rest_edges')
        c.status(state='playing',reason=None,last_error=None,last_trigger_at=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()))
        if sound and c.settings.get('audio_enabled') and tracks:
            audio_task=asyncio.create_task(play_timeline(plan,tracks,start,c.settings.get('audio_lead_seconds',0),c.thunder,time.monotonic))
        async def phases():
            offset=0
            for mode,duration in plan:
                await asyncio.sleep(max(0,start+offset-time.monotonic()))
                c.status(phase=mode)
                c.trace('phase',phase=mode,elapsed=offset)
                offset+=duration
        phase_task=asyncio.create_task(phases())
        def observe(event):
            nonlocal final_edge
            offset, changes = event['elapsed'], event['colors']
            final_edge = offset >= sum(d for _,d in plan)-.001
            colors.update(changes)
            c.trace('frame',elapsed=offset,colors=dict(colors))
        await render_edges(edges,send,start=start,observe=observe)
        return True
    except Exception as error:
        c.trace('failure', error_type=type(error).__name__, error_message=str(error) if isinstance(error, HueError) else type(error).__name__)
        raise
    finally:
        if phase_task:
            phase_task.cancel()
            with contextlib.suppress(asyncio.CancelledError,Exception):await phase_task
        if audio_task:
            audio_task.cancel()
            with contextlib.suppress(asyncio.CancelledError,Exception):await audio_task
        if acquired:
            await c.dark()
        if c.sonos is not None and not c.sound_override:
            with contextlib.suppress(Exception):await c.sonos.close()
        c.busy=False
        c.trace('finished')
        with c.trace_lock:
            if c.trace_handle:
                c.trace_handle.close();c.trace_handle=None
