"""Local preview. --fixtures isolates browser QA from the production database."""
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
import argparse,re
ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser();parser.add_argument('--fixtures',action='store_true');parser.add_argument('--port',type=int,default=8765);args=parser.parse_args()
class Handler(SimpleHTTPRequestHandler):
 def __init__(self,*a,**kw):super().__init__(*a,directory=str(ROOT),**kw)
 def do_GET(self):
  path=self.path.split('?')[0]
  if args.fixtures and path=='/js/env.js':
   data=(ROOT/'tests/preview_fixture.js').read_bytes();self.send_response(200);self.send_header('Content-Type','text/javascript');self.end_headers();self.wfile.write(data);return
  if args.fixtures and (path.endswith('.html') or path=='/'):
   file=ROOT/(path.strip('/') or 'index.html')
   if file.exists():
    text=file.read_text();text=re.sub(r'<script src="https://[^\"]+"[^>]*></script>','',text)
    self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8');self.end_headers();self.wfile.write(text.encode());return
  super().do_GET()
print(f'Preview: http://127.0.0.1:{args.port} ({"fixtures" if args.fixtures else "live database"})',flush=True)
ThreadingHTTPServer(('127.0.0.1',args.port),Handler).serve_forever()
