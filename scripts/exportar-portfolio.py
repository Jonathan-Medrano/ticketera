"""
exportar-portfolio.py — prepara las capturas para usarlas en otro sitio (el portfolio).

  python scripts/exportar-portfolio.py <carpeta_destino>

- Escritorio: quita la franja del scrollbar, escala a 1600 px y recorta 16:10 desde arriba (WebP).
- Celular: deja el viewport completo a 540 px de ancho (WebP).
- Además genera docs/capturas-web/ (WebP ≤ 1920 px) con todas las capturas.
Requiere Pillow.
"""
import os
import sys

from PIL import Image

Image.MAX_IMAGE_PIXELS = None
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(RAIZ, "docs", "capturas")

ESCRITORIO = [
    ("50-sitio-03-premium", "sitio-premium"),
    ("50-sitio-02-vibrante", "sitio-vibrante"),
    ("50-sitio-04-clara", "sitio-clara"),
    ("50-sitio-06-urbano", "sitio-urbano"),
    ("61b-seleccion-detalle", "compra-seleccion"),
    ("62-checkout", "compra-checkout"),
    ("63-mis-tickets", "compra-mis-tickets"),
    ("64-ticket-qr", "compra-qr"),
    ("15-sitio-venta-editor", "panel-editor"),
    ("10-dashboard", "panel-dashboard"),
    ("11-eventos", "panel-eventos"),
    ("13-ventas", "panel-ventas"),
    ("14-cobros-mercado-pago", "panel-cobros"),
    ("17a-escanear-qr", "panel-escaner"),
    ("16a-consumibles-ventas", "panel-barra"),
    ("21c-marketing-email", "panel-marketing"),
    ("24-revendedores", "panel-revendedores"),
    ("30-super-dashboard", "super-dashboard"),
    ("31-super-empresas", "super-empresas"),
    ("33-super-fee-tiers", "super-fee-tiers"),
]
CELULAR = [
    ("79-home", "movil-home"),
    ("71b-seleccion-detalle", "movil-seleccion"),
    ("73-mis-tickets", "movil-tickets"),
    ("74-ticket-qr", "movil-qr"),
]


def abrir(nombre):
    return Image.open(os.path.join(SRC, nombre + ".png")).convert("RGB")


def exportar(destino):
    os.makedirs(destino, exist_ok=True)
    for origen, salida in ESCRITORIO:
        im = abrir(origen)
        w, h = im.size
        im = im.crop((0, 0, w - 30, h))  # scrollbar
        w, h = im.size
        im = im.resize((1600, round(h * 1600 / w)), Image.LANCZOS)
        im = im.crop((0, 0, 1600, min(im.size[1], 1000)))
        im.save(os.path.join(destino, salida + ".webp"), "WEBP", quality=82, method=6)
    for origen, salida in CELULAR:
        im = abrir(origen)
        w, h = im.size
        im = im.resize((540, round(h * 540 / w)), Image.LANCZOS)
        im.save(os.path.join(destino, salida + ".webp"), "WEBP", quality=82, method=6)
    print("exportadas", len(ESCRITORIO) + len(CELULAR), "imágenes a", destino)


def web_completo():
    destino = os.path.join(RAIZ, "docs", "capturas-web")
    os.makedirs(destino, exist_ok=True)
    for f in sorted(os.listdir(SRC)):
        if not f.endswith(".png"):
            continue
        im = abrir(f[:-4])
        if im.width > 1920:
            im = im.resize((1920, round(im.height * 1920 / im.width)), Image.LANCZOS)
        im.save(os.path.join(destino, f[:-4] + ".webp"), "WEBP", quality=84, method=6)
    print("capturas-web:", len(os.listdir(destino)))


if __name__ == "__main__":
    if len(sys.argv) > 1:
        exportar(sys.argv[1])
    web_completo()
