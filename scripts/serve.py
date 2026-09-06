"""Serve the static web/ directory; no application backend or dependencies."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--port', type=int, default=8000)
parser.add_argument('--host', default='127.0.0.1')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1] / 'web'


class StaticHandler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, '.wasm': 'application/wasm', '.js': 'text/javascript'}

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()


server = ThreadingHTTPServer((args.host, args.port), partial(StaticHandler, directory=str(root)))
print(f'Mandel / Drift: http://{args.host}:{server.server_port}', flush=True)
try:
    server.serve_forever()
except KeyboardInterrupt:
    server.server_close()
