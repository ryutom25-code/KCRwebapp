"""Local preview. --fixtures isolates browser QA from the production database."""
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
import argparse,re
from urllib.parse import unquote, urlsplit
ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser();parser.add_argument('--fixtures',action='store_true',required=True);parser.add_argument('--port',type=int,default=8765);args=parser.parse_args()
class Handler(SimpleHTTPRequestHandler):
 def __init__(self,*a,**kw):super().__init__(*a,directory=str(ROOT),**kw)
 def do_HEAD(self):
  self.send_error(405)
 def do_GET(self):
  path=unquote(urlsplit(self.path).path)
  file=ROOT/(path.strip('/') or 'index.html')
  if not file.resolve().is_relative_to(ROOT) or any(part.startswith('.') for part in Path(path).parts):
   self.send_error(404);return
  if not file.is_file() or file.suffix not in {'.html','.js','.css','.png','.svg','.json'} or file.name in {'package.json'}:
   self.send_error(404);return
  if path=='/js/env.js':
   data=(ROOT/'tests/preview_fixture.js').read_bytes();self.send_response(200);self.send_header('Content-Type','text/javascript');self.end_headers();self.wfile.write(data);return
  if file.suffix=='.html':
   text=file.read_text();text=re.sub(r'<script src="https://[^\"]+"[^>]*></script>','',text)
   self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8');self.end_headers();self.wfile.write(text.encode());return
  super().do_GET()
print(f'Preview: http://127.0.0.1:{args.port} (fixtures)',flush=True)
ThreadingHTTPServer(('127.0.0.1',args.port),Handler).serve_forever()
