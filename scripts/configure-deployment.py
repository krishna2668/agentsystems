"""Configure only a disposable, authorized deployment checkout."""
import argparse
import re
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
parser.add_argument('--previous-gateway', type=origin, help='Exact previous origin for a reviewed forward-only cutover migration')
parser.add_argument('--supabase', type=origin, required=True)
parser.add_argument('--android-cert-sha256', help='Reviewed Android signing certificate fingerprint (32 colon-separated hex bytes)')
args = parser.parse_args()
if args.android_cert_sha256 and not re.fullmatch(r'(?:[0-9A-F]{2}:){31}[0-9A-F]{2}', args.android_cert_sha256):
    parser.error('Invalid Android signing certificate SHA-256 fingerprint')
root = Path(__file__).resolve().parent.parent
files = []
for folder in ('permanent-gateway', 'product-src', 'android-app/src/main'):
    for p in (root/folder).rglob('*'):
        if p.is_file() and p.suffix in {'.mjs','.sql','.java','.kt','.xml'} and 'node_modules' not in p.parts and 'bundle' not in p.name and p.name != 'consent-assets.mjs':
            s = p.read_text()
            t = s.replace('https://previous-gateway.example.invalid',args.previous_gateway or args.gateway).replace('https://gateway.example.invalid',args.gateway).replace('https://example.supabase.co',args.supabase)
            if args.android_cert_sha256:
                t = t.replace('ANDROID_CERT_SHA256_UNCONFIGURED', args.android_cert_sha256)
            if p.suffix == '.xml':
                t = t.replace('android:host="gateway.example.invalid"', 'android:host="' + urlsplit(args.gateway).hostname + '"')
            if t != s:
                files.append((p,t))
if not files:
    parser.error('No unconfigured templates found; use a fresh checkout')
for p,t in files:
    p.write_text(t)
print('Configured',len(files),'files. Do not commit this deployment checkout.')
