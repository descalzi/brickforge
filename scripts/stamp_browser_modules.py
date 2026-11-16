"""Stamp native module URLs after source/data changes, without a bundler.
Run before publishing; --check verifies the committed release is coherent.
"""
from pathlib import Path
import hashlib
import re
import sys
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
root=Path(__file__).resolve().parents[1]/'docs'
modules=sorted(p for p in (root/'assets').glob('*.js') if p.name!='release-version.js')
pattern=re.compile(r'''(["'])(\.{1,2}/[^"'\s?]+\.(?:js|css|json))(?:\?v=[^"'\s]+)?\1''')
html_links=re.compile(r'''(href=["'])(\./[^"']+\.html(?:\?[^"']*)?(?:\#[^"']*)?)(["'])''')
def normalize(text):
 text=pattern.sub(lambda m:m[1]+m[2]+m[1],text)
 def unversion(m):
  url=urlsplit(m[2]);q=[(k,v) for k,v in parse_qsl(url.query) if k!='v']
  return m[1]+urlunsplit((url.scheme,url.netloc,url.path,urlencode(q),url.fragment))+m[3]
 return html_links.sub(unversion,text)
h=hashlib.sha256()
for p in modules+sorted((root/'assets').glob('*.css'))+sorted(root.glob('*.html'))+sorted((root/'data').rglob('*.json')):
 h.update(p.relative_to(root).as_posix().encode());h.update((normalize(p.read_text()) if p.suffix in ['.js','.css','.html'] else p.read_text()).encode())
version=h.hexdigest()[:12]
writes={root/'assets/release-version.js':f'export const ASSET_VERSION="{version}";\n'}
for p in modules:
 writes[p]=pattern.sub(lambda m:m[1]+m[2]+'?v='+version+m[1],p.read_text())
for p in root.glob('*.html'):
 s=pattern.sub(lambda m:m[1]+m[2]+'?v='+version+m[1],p.read_text())
 def link(m):
  url=urlsplit(m[2]);q=dict(parse_qsl(url.query));q['v']=version
  return m[1]+urlunsplit((url.scheme,url.netloc,url.path,urlencode(q),url.fragment))+m[3]
 s=re.sub(r'''(href=["'])(\./[^"']+\.html(?:\?[^"']*)?(?:\#[^"']*)?)(["'])''',link,s)
 writes[p]=s
changed=[p for p,text in writes.items() if not p.exists() or p.read_text()!=text]
if '--check' in sys.argv:
 if changed:raise SystemExit('Run python scripts/stamp_browser_modules.py: '+', '.join(str(p.relative_to(root)) for p in changed))
else:
 for p,text in writes.items():p.write_text(text)
print('Browser release '+version+'; '+str(len(changed))+' file(s) '+('stale' if '--check' in sys.argv else 'stamped')+'.')
