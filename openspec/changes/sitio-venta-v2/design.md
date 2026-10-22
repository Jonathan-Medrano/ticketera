# Sitio de venta v2 — diseño y hallazgos

> Estado: **diseño aprobado, implementación parcial.** Maquetas navegables en
> `marca/sitio-venta-v2/` (`board.html`, `escenarios.html`, `detalle.html`, `checkout.html`).
> Assets de La Rosa Disco usados como caso real en `marca/sitio-venta-v2/img/`.

---

## 1. El problema de fondo

Una "plantilla base" del editor (`components/dashboard/sitio-venta/branding-section.tsx`)
solo setea:

```
color_primario · color_fondo · color_texto · border_radius · button_style · font · heading_font
```

**Cero estructura.** Las 9 plantillas renderizan exactamente la misma página con otro
fondo. No falta una plantilla nº10: falta que `plantilla` defina **layout**, no solo color.

---

## 2. Hallazgos verificados en código

| # | Hallazgo | Evidencia | Estado |
|---|----------|-----------|--------|
| H1 | La grilla del home no se adapta a pocos eventos: con 1-2 las cards quedan a la izquierda y el resto en negro | `tenant-home.tsx` — `lg:grid-cols-3` fijo | ✅ **Arreglado** (sin deployar) |
| H2 | El hero del detalle recorta los flyers verticales a una banda: se pierde nombre del show, fecha y precios | `evento-detalle-sections.tsx` — `object-cover` en hero 380px full-width | ✅ **Arreglado** (sin deployar) |
| H3 | Checkout exige nombre+apellido+DNI por **cada** entrada, sin flag por evento ni tenant. 4 entradas = 12 campos obligatorios en 4 acordeones | `checkout-content.tsx:250-262` — loop de validación incondicional | ❌ Pendiente |
| H4 | Los datos del comprador no precargan el titular 1: escribe su propio DNI dos veces | `checkout-content.tsx` | ❌ Pendiente |
| H5 | **No hay reloj de reserva.** El código admite que un asiento puede ser tomado por otro comprador mientras se completa el form; el usuario llena todo y recibe 409 | `checkout-content.tsx:102-104` (comentario) + `checkout_sessions` ya tiene expiración en DB | ❌ Pendiente |
| H6 | **No existe compartir/reenviar una entrada.** Sin WhatsApp, sin share, sin transferencia | `mis-tickets-content.tsx` (grep vacío) + backend sin ruta | ❌ Pendiente |
| H7 | Contraste: con un `color_primario` claro (ej. `#c6ff00`) el título del hero en blanco queda ilegible | Escenario 5 de `escenarios.html` | ❌ Pendiente |
| H8 | Mobile: columnas `auto` de grid no achican en 390px y tiran el stepper y el total fuera de pantalla | Detectado maquetando `cliente.html` | ⚠️ Aplica al render nuevo, no al actual |
| H9 | **El QR se puede scrollear fuera de vista** justo cuando lo están escaneando | `mis-tickets-content.tsx:972` — `Dialog` con `max-h-[85vh] overflow-y-auto` | ❌ Pendiente |
| H10 | QR de tamaño fijo, no crece con la pantalla | `mis-tickets-content.tsx:988` — `size={200}` | ❌ Pendiente |
| H11 | Sin `wakeLock`: la pantalla se apaga haciendo la cola | grep vacío en `mis-tickets-content.tsx` | ❌ Pendiente |
| H12 | La pantalla más usada en mobile no es mobile-first: 20 `sm:` y 1 `md:` en 1.184 líneas | `mis-tickets-content.tsx` | ❌ Pendiente |

---

## 3. Layouts de home (aprobados)

`eventos_layout` — **columna ya existente y sin uso** en la migración inicial, reutilizada
para no requerir migración en prod.

| Valor | Nombre | Para quién | Regla clave |
|-------|--------|-----------|-------------|
| `""` / `clasico` | Clásico | **Default histórico.** Tenants ya publicados NO deben mutar solos | Grilla de cards, como hoy |
| `cartelera` | Cartelera | Boliches y productoras con pocas fechas | **Con 1 evento NO renderiza grilla secundaria**: la portada es la página |
| `agenda` | Agenda | Quien tiene agenda cargada | Filas densas; único que no se rompe ni con 1 ni con 40 |

**Reglas que salieron de los escenarios:**
1. Cartelera con 1 evento omite el bloque "resto" entero.
2. Hace falta **póster de fallback** para eventos sin imagen: color del tenant + nombre en display. Nunca un hueco gris.
3. **Cero blancos hardcodeados**: bordes, chips y texto secundario derivan de `color_texto` con alpha (si no, se rompe en tenants claros).
4. Agenda necesita estados: agotado, últimas unidades, por confirmar.
5. El radio sale de `border_radius` del tenant.

---

## 4. Detalle de evento (aprobado)

- Flyer **completo** sobre copia desenfocada de sí mismo (H2).
- **Selector de cantidad por categoría** + total en vivo (aside sticky en desktop, barra fija en mobile).
- Stock real por categoría: "QUEDAN 214" / "ÚLTIMAS 12" / "AGOTADO".
- Bloque de **barra/consumibles** — es el diferencial del producto y hoy no aparece donde se compra.
- Mostrar tanda activa ("Tanda 2 · cierra en 3 días"): el dato ya existe.
- **Precio final siempre.** Mostrar precio sin cargo y sorprender en el checkout es la queja nº1 contra las ticketeras y el argumento de venta de TICKETERA.

---

## 5. Checkout y reparto de entradas (aprobado)

- Atajo **"poner todas a mi nombre"**, tildado por defecto → de 12 campos a 4. Soporta caso **mixto** (una a mi nombre, otra a nombre de un tercero).
- Nuevo flag por evento `requiere_titular_por_entrada`, **apagado por defecto**. El DNI por entrada es una feature real de anti-reventa: no se saca, se vuelve opcional.
- **Reloj de reserva visible** con barra de progreso, leyendo la expiración de `checkout_sessions`.
- Post-compra: **cada entrada se reparte por WhatsApp**.

### Contrato de seguridad del reparto (decisión, no detalle)

Cada entrada se comparte con **su propio link** `/t/<tenant>/entrada/<token>`:

- El receptor ve **solo su entrada** — no el resto del grupo ni los datos del comprador.
- El token es **opaco**, revocable y reemitible si se filtra.
- **NO se manda la imagen del QR.** Una imagen reenviada de chat en chat es exactamente
  el vector de reventa que el producto dice combatir; mandarla sería habilitarla nosotros.
- El canje sigue siendo de un solo uso, validado server-side como hoy.

---

## 6. Mis entradas y QR — la pantalla de la puerta (aprobado)

Contexto de uso real: **parado en la puerta, de noche, con la red del lugar saturada y
gente esperando atrás**. Si falla, la persona no entra y el que queda mal es el boliche.

- **Pase a pantalla completa**, no un modal scrolleable (H9). El QR no se puede ir de vista.
- **QR responsive**: `min(78vw, 340px)` en lugar de `size={200}` (H10).
- **Wake lock acotado** (H11): solo con el pase abierto; liberado al cerrar, al perder foco
  y por timeout de inactividad (~90 s). No "pantalla prendida toda la noche".
- **Caché offline** de las entradas: la red saturada es el modo de falla más común.
- Swipe entre entradas del grupo; el titular arriba de todo para cotejar contra el DNI.

### Decisión revisada: tarjeta blanca, NO pantalla blanca

Una primera versión proponía fondo blanco full-screen + un cartel "Brillo al máximo".
**Ambas cosas estaban mal:**

1. **No existe API web para cambiar el brillo del sistema.** El cartel prometía algo que
   no hacemos.
2. En **OLED** (la mayoría de los equipos) el blanco a pantalla completa es el contenido
   que **más batería consume**: prende todos los subpíxeles. Con el equipo al 4% eso es un
   modo de falla, no una molestia.

**Lo correcto:** el lector de QR necesita **contraste dentro del QR**, no luminancia de
toda la pantalla. Tarjeta blanca con QR negro sobre fondo oscuro → mismo resultado para el
lector, una fracción del consumo.

**Y el respaldo real ya existe:** `escanear-content.tsx` tiene modo manual
(`Paso = "camara" | "manual"`) indexado por `clave_corta`. Aunque el celular se muera, la
persona entra. Por eso el diseño lidera con la **clave corta grande**, no con la luz.

> **Regla general que sale de acá:** antes de blindar un caso quemando batería o red,
> verificar si el fallback humano ya existe en el producto. Acá existía.

---

## 7. Estado de implementación

**Hecho y compilando** (`tsc --noEmit` limpio en backend y front):

- H1 y H2 arreglados en `tenant-home.tsx` y `evento-detalle-sections.tsx`.
- Plomería completa de `eventos_layout`: schema + allowlist server-side
  (`sitio-venta.ts`) + lectura pública (`tenant.ts`) + 5 capas de tipos en el front
  + fixtures de test.

**Falta:**

1. `tenant-home-layouts.tsx` con `CarteleraLayout` y `AgendaLayout` (+ póster de fallback).
2. Selector de layout en el editor, con miniaturas del render real (hoy son wireframes grises).
3. Detalle de evento v2 (selector de cantidad, total sticky, bloque de barra).
4. Checkout: atajo de titulares, `requiere_titular_por_entrada`, reloj de reserva.
5. Reparto por WhatsApp: token de entrada + ruta pública + pantalla.
6. Guard de contraste (H7).
7. Deploy de front y back — nada de lo hecho está en producción.
