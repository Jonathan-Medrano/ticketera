#!/usr/bin/env python3
"""
ig_graph.py — Helper de la Instagram Graph API (oficial) para TICKETERA.

Lo usan los empleados ticketera-ig-publisher (publicar) y ticketera-ig-analytics (leer insights).

ESTADO: scaffold sin probar. Requiere credenciales reales (ver instagram/AUTOPOST-SETUP.md):
  - IG_USER_ID        : id del usuario de IG Business/Creator
  - IG_ACCESS_TOKEN   : token long-lived con instagram_content_publish + instagram_manage_insights
  - GRAPH_VERSION     : opcional, default v21.0

Solo API oficial. NUNCA usar librerías de scraping/automatización no oficial (ban de cuenta).

Uso:
  python scripts/ig_graph.py insights account
  python scripts/ig_graph.py insights recent --limit 12
  python scripts/ig_graph.py insights media --media-id <ID>
  python scripts/ig_graph.py publish image --image-url <URL_PUBLICA> --caption "texto"
  python scripts/ig_graph.py publish carousel --image-urls <URL1,URL2,...> --caption "texto"
"""
import argparse
import json
import os
import sys
import time
import urllib.parse
import urllib.request


def _load_dotenv():
    """Carga instagram/.env (formato KEY=VALUE, stdlib puro, sin dependencias) si existe.
    NO pisa variables ya presentes en el entorno: el entorno real gana, asi un cron /
    GitHub Action / Fly que inyecte secrets tiene prioridad sobre el archivo local."""
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "instagram", ".env")
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


_load_dotenv()

GRAPH = "https://graph.facebook.com/" + os.environ.get("GRAPH_VERSION", "v21.0")


def _cfg():
    uid = os.environ.get("IG_USER_ID")
    token = os.environ.get("IG_ACCESS_TOKEN")
    if not uid or not token:
        sys.exit("ERROR: faltan IG_USER_ID / IG_ACCESS_TOKEN en el entorno (ver instagram/AUTOPOST-SETUP.md)")
    return uid, token


def _get(path, params):
    url = f"{GRAPH}/{path}?" + urllib.parse.urlencode(params)
    with urllib.request.urlopen(url) as r:
        return json.loads(r.read().decode())


def _post(path, data):
    body = urllib.parse.urlencode(data).encode()
    req = urllib.request.Request(f"{GRAPH}/{path}", data=body, method="POST")
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read().decode())


# ── Insights ──
def insights_account(_):
    uid, token = _cfg()
    out = _get(f"{uid}/insights", {
        "metric": "reach,profile_views,follower_count",
        "period": "day",
        "access_token": token,
    })
    print(json.dumps(out, indent=2, ensure_ascii=False))


def insights_recent(args):
    uid, token = _cfg()
    media = _get(f"{uid}/media", {
        "fields": "id,caption,media_type,timestamp,permalink",
        "limit": args.limit,
        "access_token": token,
    })
    results = []
    for m in media.get("data", []):
        metric = "reach,likes,comments,saved,shares" if m.get("media_type") != "VIDEO" else "reach,likes,comments,saved,shares,plays"
        try:
            ins = _get(f"{m['id']}/insights", {"metric": metric, "access_token": token})
        except Exception as e:  # noqa: BLE001
            ins = {"error": str(e)}
        results.append({"media": m, "insights": ins})
    print(json.dumps(results, indent=2, ensure_ascii=False))


def insights_media(args):
    _, token = _cfg()
    out = _get(f"{args.media_id}/insights", {
        "metric": "reach,likes,comments,saved,shares",
        "access_token": token,
    })
    print(json.dumps(out, indent=2, ensure_ascii=False))


# ── Publish ──
def _wait_until_ready(container_id, token, timeout=120, poll=5):
    """Poll container status until FINISHED or ERROR. Raises on ERROR/EXPIRED/timeout."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        data = _get(container_id, {"fields": "status_code", "access_token": token})
        code = data.get("status_code", "")
        if code == "FINISHED":
            return
        if code in ("ERROR", "EXPIRED"):
            sys.exit(f"ERROR: container {container_id} status={code}")
        print(f"  container {container_id}: {code or 'IN_PROGRESS'} — waiting {poll}s...", file=sys.stderr)
        time.sleep(poll)
    sys.exit(f"ERROR: timeout waiting for container {container_id}")


def _publish_container(uid, token, creation_id):
    return _post(f"{uid}/media_publish", {"creation_id": creation_id, "access_token": token})


def publish_image(args):
    uid, token = _cfg()
    cont = _post(f"{uid}/media", {"image_url": args.image_url, "caption": args.caption or "", "access_token": token})
    _wait_until_ready(cont["id"], token)
    res = _publish_container(uid, token, cont["id"])
    print(json.dumps(res, indent=2, ensure_ascii=False))


def publish_carousel(args):
    uid, token = _cfg()
    urls = [u.strip() for u in args.image_urls.split(",") if u.strip()]
    if not 2 <= len(urls) <= 10:
        sys.exit("ERROR: un carrusel necesita entre 2 y 10 imágenes")
    children = []
    for i, u in enumerate(urls, 1):
        print(f"  creating child container {i}/{len(urls)}: {u}", file=sys.stderr)
        c = _post(f"{uid}/media", {"image_url": u, "is_carousel_item": "true", "access_token": token})
        _wait_until_ready(c["id"], token)
        children.append(c["id"])
    print(f"  creating carousel parent with {len(children)} children...", file=sys.stderr)
    parent = _post(f"{uid}/media", {
        "media_type": "CAROUSEL",
        "children": ",".join(children),
        "caption": args.caption or "",
        "access_token": token,
    })
    _wait_until_ready(parent["id"], token)
    res = _publish_container(uid, token, parent["id"])
    print(json.dumps(res, indent=2, ensure_ascii=False))


def publish_story(args):
    # Historia (imagen estática). NOTA: la Content Publishing API NO permite
    # agregar stickers (encuesta/quiz/link) ni texto encima — eso es manual en la app.
    uid, token = _cfg()
    cont = _post(f"{uid}/media", {"image_url": args.image_url, "media_type": "STORIES", "access_token": token})
    _wait_until_ready(cont["id"], token)
    res = _publish_container(uid, token, cont["id"])
    print(json.dumps(res, indent=2, ensure_ascii=False))


def publish_reel(args):
    # REEL (video). Diferencias reales con las imágenes, que es donde se rompe:
    #   - el contenedor tarda: Meta descarga y transcodifica el MP4, así que el
    #     polling necesita mucho más margen que el de una imagen
    #   - share_to_feed=true hace que además aparezca en la grilla del perfil;
    #     sin esto el reel vive solo en la pestaña de Reels
    #   - el AUDIO EN TENDENCIA no se puede setear por API. Va a mano desde la
    #     app después de publicar, y sin eso el reel pierde alcance.
    uid, token = _cfg()
    payload = {
        "video_url": args.video_url,
        "media_type": "REELS",
        "caption": args.caption or "",
        "share_to_feed": "true" if args.share_to_feed else "false",
        "access_token": token,
    }
    if args.cover_url:
        payload["cover_url"] = args.cover_url
    cont = _post(f"{uid}/media", payload)
    _wait_until_ready(cont["id"], token, timeout=args.timeout, poll=5)
    res = _publish_container(uid, token, cont["id"])
    print(json.dumps(res, indent=2, ensure_ascii=False))


def main():
    p = argparse.ArgumentParser(description="Instagram Graph API helper (TICKETERA)")
    sub = p.add_subparsers(dest="cmd", required=True)

    ins = sub.add_parser("insights").add_subparsers(dest="kind", required=True)
    ins.add_parser("account").set_defaults(func=insights_account)
    r = ins.add_parser("recent"); r.add_argument("--limit", type=int, default=12); r.set_defaults(func=insights_recent)
    m = ins.add_parser("media"); m.add_argument("--media-id", required=True); m.set_defaults(func=insights_media)

    pub = sub.add_parser("publish").add_subparsers(dest="kind", required=True)
    pi = pub.add_parser("image"); pi.add_argument("--image-url", required=True); pi.add_argument("--caption", default=""); pi.set_defaults(func=publish_image)
    pc = pub.add_parser("carousel"); pc.add_argument("--image-urls", required=True); pc.add_argument("--caption", default=""); pc.set_defaults(func=publish_carousel)
    ps = pub.add_parser("story"); ps.add_argument("--image-url", required=True); ps.set_defaults(func=publish_story)
    pr = pub.add_parser("reel")
    pr.add_argument("--video-url", required=True)
    pr.add_argument("--caption", default="")
    pr.add_argument("--cover-url", default="")
    pr.add_argument("--timeout", type=int, default=420, help="segundos de espera al transcodificado de Meta")
    pr.add_argument("--no-share-to-feed", dest="share_to_feed", action="store_false")
    pr.set_defaults(func=publish_reel, share_to_feed=True)

    args = p.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
