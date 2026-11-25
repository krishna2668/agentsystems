"""Configure only a disposable, authorized deployment checkout."""
import argparse
from pathlib import Path
from urllib.parse import urlsplit

def origin(value):
    p = urlsplit(value)
    if p.scheme != 'https' or not p.hostname or p.username or p.password or p.path or p.query or p.fragment or p.port:
        raise argparse.ArgumentTypeError('Expected an HTTPS origin without a path, credentials or port')
    if any(c not in 'abcdefghijklmnopqrstuvwxyz0123456789.-' for c in p.hostname):
        raise argparse.ArgumentTypeError('Invalid hostname')
    return value

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--gateway', type=origin, required=True)
parser.add_argument('--supabase', type=origin, required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
files = []
for folder in ('permanent-gateway', 'product-src'):
    for p in (root/folder).rglob('*'):
        if p.is_file() and p.suffix in {'.mjs','.sql','.java'} and 'node_modules' not in p.parts and 'bundle' not in p.name and p.name != 'consent-assets.mjs':
            s = p.read_text()
            t = s.replace('https://gateway.example.invalid',args.gateway).replace('https://example.supabase.co',args.supabase)
            if t != s:
                files.append((p,t))
if not files:
    parser.error('No unconfigured templates found; use a fresh checkout')
for p,t in files:
    p.write_text(t)
print('Configured',len(files),'files. Do not commit this deployment checkout.')
