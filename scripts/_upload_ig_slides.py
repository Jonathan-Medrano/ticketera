#!/usr/bin/env python3
"""Upload carousel slides to Supabase Storage and print public URLs.
Reads credentials from backend/.env (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).
Usage: python scripts/_upload_ig_slides.py <carousel-slug>
Example: python scripts/_upload_ig_slides.py 08-quien-paga
"""
import os
import sys
import re
import requests

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# --- load backend/.env (stdlib, no python-dotenv needed) ---
def load_env(path):
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, val = line.partition("=")
                key = key.strip()
                val = val.strip().strip('"').strip("'")
                if key and key not in os.environ:
                    os.environ[key] = val
    except FileNotFoundError:
        pass

load_env(os.path.join(ROOT, "backend", ".env"))

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SERVICE_KEY  = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
BUCKET       = os.environ.get("SUPABASE_STORAGE_BUCKET", "tenant-images")

if not SUPABASE_URL or not SERVICE_KEY:
    sys.exit("ERROR: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not found in backend/.env")

slug = sys.argv[1] if len(sys.argv) > 1 else sys.exit("Usage: _upload_ig_slides.py <slug>")

img_dir = os.path.join(ROOT, "instagram", "carruseles", slug, "img")
if not os.path.isdir(img_dir):
    sys.exit(f"ERROR: img dir not found: {img_dir}")

pngs = sorted(f for f in os.listdir(img_dir) if f.endswith(".png"))
if not pngs:
    sys.exit(f"ERROR: no PNGs in {img_dir}")

public_urls = []
for local_name in pngs:
    remote_name = f"{slug}-{local_name}"
    object_path = f"ig/{remote_name}"
    upload_url  = f"{SUPABASE_URL}/storage/v1/object/{BUCKET}/{object_path}"

    with open(os.path.join(img_dir, local_name), "rb") as fh:
        data = fh.read()

    headers = {
        "Authorization": f"Bearer {SERVICE_KEY}",
        "Content-Type": "image/png",
        "x-upsert": "true",
    }
    r = requests.post(upload_url, headers=headers, data=data)

    if r.status_code in (200, 201):
        pub = f"{SUPABASE_URL}/storage/v1/object/public/{BUCKET}/{object_path}"
        public_urls.append(pub)
        print(f"OK  {remote_name}")
    else:
        print(f"FAIL {remote_name}: {r.status_code} {r.text}", file=sys.stderr)
        sys.exit(1)

print()
print("URLS_CSV=" + ",".join(public_urls))
