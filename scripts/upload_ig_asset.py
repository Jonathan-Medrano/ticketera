#!/usr/bin/env python3
"""
upload_ig_asset.py — Sube un asset local a Supabase Storage (bucket tenant-images)
y devuelve la URL pública para usarla con ig_graph.py publish.

Uso:
  python scripts/upload_ig_asset.py <ruta-local> <object-path-en-bucket>

Ejemplo:
  python scripts/upload_ig_asset.py instagram/cola-posts/P18-stub-ticket/imagen.png instagram/P18-stub-ticket/imagen.png

Requiere en el entorno (o en backend/.env):
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
  SUPABASE_STORAGE_BUCKET  (default: tenant-images)
"""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request


def _load_env(path):
    try:
        with open(path, encoding="utf-8") as fh:
            for line in fh:
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


# Load from backend/.env if vars not already present
_script_dir = os.path.dirname(os.path.abspath(__file__))
_root = os.path.dirname(_script_dir)
_load_env(os.path.join(_root, "backend", ".env"))
_load_env(os.path.join(_root, "instagram", ".env"))


def main():
    if len(sys.argv) != 3:
        sys.exit("Uso: python scripts/upload_ig_asset.py <ruta-local> <object-path>")

    local_path = sys.argv[1]
    object_path = sys.argv[2]

    supabase_url = os.environ.get("SUPABASE_URL")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    bucket = os.environ.get("SUPABASE_STORAGE_BUCKET", "tenant-images")

    if not supabase_url or not service_key:
        sys.exit("ERROR: faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en el entorno")

    with open(local_path, "rb") as f:
        data = f.read()

    print(f"Subiendo {local_path} ({len(data)} bytes) → {bucket}/{object_path}", file=sys.stderr)

    upload_url = f"{supabase_url}/storage/v1/object/{bucket}/{object_path}"
    req = urllib.request.Request(
        upload_url,
        data=data,
        method="POST",
        headers={
            "Authorization": f"Bearer {service_key}",
            "apikey": service_key,
            "Content-Type": "image/png",
            "x-upsert": "true",
        },
    )
    try:
        with urllib.request.urlopen(req) as r:
            resp = json.loads(r.read().decode())
            pub_url = f"{supabase_url}/storage/v1/object/public/{bucket}/{object_path}"
            print(pub_url)
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        sys.exit(f"HTTP {e.code}: {body}")


if __name__ == "__main__":
    main()
