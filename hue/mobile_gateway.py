"""Authenticated TLS gateway from the private iPhone app to the local controller.

Private settings, certificate and bearer token live outside the repository.
The gateway exposes only the small control surface needed by the mobile app.
"""
import asyncio
import hmac
import json
from pathlib import Path
import ssl
from datetime import datetime, timezone

from aiohttp import web


def validate_command(body):
    if not isinstance(body, dict):
        raise ValueError('Expected a command')
    action = body.get('action')
    if action in ('status', 'library', 'start', 'stop'):
        return {'action': action}
    if action == 'arm' and isinstance(body.get('enabled'), bool):
        return {'action': action, 'enabled': body['enabled']}
    if action == 'events':
        before = body.get('before')
        if before is None:
            return {'action': action}
        if isinstance(before, int) and not isinstance(before, bool) and 0 < before < 2**63:
            return {'action': action, 'before': before}
    raise ValueError('Unsupported command')


async def controller_command(socket_path, command):
    writer = None
    try:
        async with asyncio.timeout(5):
            reader, writer = await asyncio.open_unix_connection(socket_path, limit=65536)
            writer.write((json.dumps(command)+'\n').encode())
            await writer.drain()
            return json.loads(await reader.readline())
    finally:
        if writer:
            writer.close()
            await writer.wait_closed()


def create_app(settings, forward=controller_command):
    token = settings['token']
    if not isinstance(token, str) or len(token) < 32:
        raise ValueError('A strong private token is required')

    async def control(request):
        if not hmac.compare_digest(request.headers.get('Authorization', '').encode(), ('Bearer '+token).encode()):
            return web.json_response({'ok': False, 'message': 'Unauthorized'}, status=401)
        try:
            command = validate_command(await request.json())
        except (ValueError, TypeError, UnicodeError):
            return web.json_response({'ok': False, 'message': 'Invalid command'}, status=400)
        try:
            result = await forward(settings['socket'], command)
        except (OSError, TimeoutError, ValueError):
            return web.json_response({'ok': False, 'message': 'Hue controller unavailable. Retrying…'}, status=503)
        if settings.get('health_file'):
            try:
                path = Path(settings['health_file'])
                temp = path.with_suffix('.tmp')
                temp.write_text(json.dumps({'at':datetime.now(timezone.utc).isoformat(),
                                            'action':command['action'], 'ok':result.get('ok'),
                                            'client':request.headers.get('X-Hue-Client', '')[:40],
                                            'remote':request.remote}))
                temp.chmod(0o600)
                temp.replace(path)
            except OSError:
                pass
        return web.json_response(result, headers={'Cache-Control': 'no-store'})

    app = web.Application(client_max_size=8192)
    app.router.add_post('/control', control)
    return app


def main():
    root = Path.home()/'.config/hue-halloween-mobile'
    settings = json.loads((root/'gateway.json').read_text())
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    context.load_cert_chain(settings['certificate'], settings['key'])
    web.run_app(create_app(settings), host=settings.get('listen', '0.0.0.0'),
                port=settings.get('port', 8767), ssl_context=context,
                access_log=None, print=None)


if __name__ == '__main__':
    main()
