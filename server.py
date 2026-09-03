import asyncio
import base64
import hashlib
import json
import os
import struct
import threading
import uuid
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.parse import quote, parse_qs, urlparse
from urllib.request import Request, urlopen

rooms = {}
rooms_lock = threading.Lock()


def viewer_names(room):
    return [client['name'] for client in room['clients']]


def youtube_search(query):
    api_key = os.environ.get('YOUTUBE_API_KEY')
    if not api_key:
        return None
    params = f'part=snippet&type=video&maxResults=8&q={quote(query)}&key={quote(api_key)}'
    request = Request(f'https://www.googleapis.com/youtube/v3/search?{params}')
    with urlopen(request, timeout=8) as response:
        payload = json.loads(response.read().decode('utf-8'))
    return [{'id': item['id']['videoId'], 'title': item['snippet']['title'], 'channel': item['snippet']['channelTitle']} for item in payload.get('items', [])]


def youtube_video(video_id):
    request = Request(f'https://www.youtube.com/oembed?url={quote("https://www.youtube.com/watch?v=" + video_id)}&format=json')
    with urlopen(request, timeout=8) as response:
        payload = json.loads(response.read().decode('utf-8'))
    return {'id': video_id, 'title': payload.get('title', 'YouTube video'), 'channel': payload.get('author_name', 'YouTube')}


class RameinRequestHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == '/api/search':
            query = parse_qs(parsed.query).get('q', [''])[0].strip()[:100]
            if not query:
                self.send_json(400, {'error': 'Search query is required'})
                return
            try:
                results = youtube_search(query)
                if results is None:
                    self.send_json(503, {'error': 'YOUTUBE_API_KEY is not configured'})
                else:
                    self.send_json(200, {'items': results})
            except (HTTPError, URLError, TimeoutError, ValueError, KeyError) as error:
                print(f'YouTube API error: {error}')
                self.send_json(502, {'error': 'YouTube search is temporarily unavailable'})
            return
        if parsed.path == '/api/video':
            video_id = parse_qs(parsed.query).get('id', [''])[0].strip()[:20]
            if not video_id:
                self.send_json(400, {'error': 'Video id is required'})
                return
            try:
                self.send_json(200, youtube_video(video_id))
            except (HTTPError, URLError, TimeoutError, ValueError, KeyError) as error:
                print(f'YouTube metadata error: {error}')
                self.send_json(502, {'error': 'YouTube metadata is temporarily unavailable'})
            return
        super().do_GET()

    def send_json(self, status, payload):
        body = json.dumps(payload).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def new_code():
    while True:
        code = uuid.uuid4().hex[:4].upper()
        with rooms_lock:
            if code not in rooms:
                rooms[code] = {'clients': [], 'playing': False, 'position': 0, 'queue': [], 'currentVideoId': None}
                return code


def get_or_create_room(code):
    with rooms_lock:
        if code not in rooms:
            rooms[code] = {'clients': [], 'playing': False, 'position': 0, 'queue': [], 'currentVideoId': None}
        return rooms[code]


async def send_frame(writer, payload):
    data = payload.encode('utf-8')
    length = len(data)
    if length < 126:
        header = bytes([0x81, length])
    elif length < 65536:
        header = bytes([0x81, 126]) + struct.pack('>H', length)
    else:
        header = bytes([0x81, 127]) + struct.pack('>Q', length)
    writer.write(header + data)
    await writer.drain()


async def read_frame(reader):
    header = await reader.readexactly(2)
    opcode = header[0] & 0x0F
    masked = header[1] & 0x80
    length = header[1] & 0x7F
    if length == 126:
        length = struct.unpack('>H', await reader.readexactly(2))[0]
    elif length == 127:
        length = struct.unpack('>Q', await reader.readexactly(8))[0]
    mask = await reader.readexactly(4) if masked else b''
    payload = bytearray(await reader.readexactly(length))
    if masked:
        for index in range(length):
            payload[index] ^= mask[index % 4]
    if opcode == 8:
        return None
    if opcode == 9:
        return ''
    return payload.decode('utf-8')


async def broadcast(room, message):
    payload = json.dumps(message)
    clients = list(room['clients'])
    results = await asyncio.gather(*(send_frame(client['writer'], payload) for client in clients), return_exceptions=True)
    for client, result in zip(clients, results):
        if isinstance(result, Exception):
            if client in room['clients']:
                room['clients'].remove(client)


async def websocket_client(reader, writer):
    room = None
    client = None
    try:
        request = await reader.readuntil(b'\r\n\r\n')
        headers = dict(line.split(': ', 1) for line in request.decode().split('\r\n')[1:] if ': ' in line)
        key = headers.get('Sec-WebSocket-Key')
        if not key:
            writer.close()
            return
        accept = base64.b64encode(hashlib.sha1((key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest()).decode()
        writer.write(('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n').encode())
        await writer.drain()

        first = await read_frame(reader)
        hello = json.loads(first)
        if hello.get('type') != 'hello':
            return
        code = str(hello.get('room', '')).upper()[:4]
        name = str(hello.get('name', 'Guest')).strip()[:24] or 'Guest'
        if len(code) != 4:
            return
        room = get_or_create_room(code)
        client = {'writer': writer, 'name': name}
        room['clients'].append(client)
        await send_frame(writer, json.dumps({'type': 'state', 'playing': room['playing'], 'position': room['position'], 'queue': room['queue'], 'currentVideoId': room['currentVideoId'], 'viewers': viewer_names(room), 'viewerCount': len(room['clients'])}))
        await broadcast(room, {'type': 'presence', 'viewers': viewer_names(room), 'viewerCount': len(room['clients'])})

        while True:
            raw = await read_frame(reader)
            if raw is None:
                break
            if not raw:
                continue
            message = json.loads(raw)
            message_type = message.get('type')
            if message_type == 'chat':
                await broadcast(room, {'type': 'chat', 'name': name, 'message': str(message.get('message', ''))[:300]})
            elif message_type == 'reaction':
                await broadcast(room, {'type': 'reaction', 'emoji': message.get('emoji', '✨')})
            elif message_type == 'playback':
                room['playing'] = bool(message.get('playing'))
                room['position'] = int(message.get('position', room['position']))
                await broadcast(room, {'type': 'playback', 'playing': room['playing'], 'position': room['position'], 'name': name})
            elif message_type == 'queue_add':
                video_id = str(message.get('videoId', ''))[:20]
                if video_id and video_id not in room['queue']:
                    room['queue'].append(video_id)
                    await broadcast(room, {'type': 'queue_add', 'videoId': video_id, 'name': name})
            elif message_type == 'queue_clear':
                room['queue'].clear()
                await broadcast(room, {'type': 'queue_clear', 'name': name})
            elif message_type == 'video_select':
                video_id = str(message.get('videoId', ''))[:20]
                if video_id:
                    room['currentVideoId'] = video_id
                    await broadcast(room, {'type': 'video_select', 'videoId': video_id, 'name': name})
    except (asyncio.IncompleteReadError, ConnectionError, json.JSONDecodeError, KeyError):
        pass
    finally:
        if room and client:
            if client in room['clients']:
                room['clients'].remove(client)
            await broadcast(room, {'type': 'presence', 'viewers': viewer_names(room), 'viewerCount': len(room['clients'])})
        writer.close()
        await writer.wait_closed()


async def websocket_server(listen_port=8765):
    server = await asyncio.start_server(websocket_client, '0.0.0.0', listen_port)
    async with server:
        await server.serve_forever()


def run_websocket_server():
    asyncio.run(websocket_server())


def run_http_server(listen_port):
    print(f'Ramein HTTP running on port {listen_port}')
    http_server = ThreadingHTTPServer(('0.0.0.0', listen_port), RameinRequestHandler)
    try:
        http_server.serve_forever()
    except KeyboardInterrupt:
        print('\nStopping Ramein HTTP')
        http_server.shutdown()


if __name__ == '__main__':
    service = os.environ.get('RAMEIN_SERVICE', 'all')
    railway_port = int(os.environ.get('PORT', '4173'))
    if service == 'ws':
        asyncio.run(websocket_server(railway_port))
    elif service == 'http':
        run_http_server(railway_port)
    else:
        websocket_thread = threading.Thread(target=run_websocket_server, daemon=True)
        websocket_thread.start()
        print('Ramein running at http://localhost:4173')
        print('Realtime WebSocket at ws://localhost:8765')
        run_http_server(4173)
