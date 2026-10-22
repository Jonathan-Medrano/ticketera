# Plan UX/UI Tenant — Mobile-First Overhaul

## Estado: COMPLETO ✓

---

## Diagnóstico

El tenant (storefront público del comprador) es el producto principal de TICKETERA.
Los compradores acceden 80%+ desde mobile. El stack actual funciona pero tiene:
- Bottom nav que roba espacio con una franja de atribución innecesaria
- Navbar apretada en mobile con 4 ítems visibles
- Overlay del hero con 6% de color_fondo → texto no legible en fotos claras
- Cards de evento sin jerarquía visual clara
- Página de detalle sin CTA sticky en mobile

---

## Fase 1 — Mobile crítico (PRIMERA EN IMPLEMENTAR)

### 1.1 Bottom nav — limpieza y legibilidad

**Problema:** Franja "Plataforma de tickets por Ticketera" consume ~32px de pantalla.
Labels `text-[10px]` = 10px → ilegible. Indicador activo poco visible.

**Fix:**
- Eliminar franja de atribución (mover crédito a soporte/info)
- Labels: `text-[10px]` → `text-xs` (12px)
- Indicador activo: pill más visible con `ring-1`
- `safe-area-inset-bottom` como padding-bottom en el flex container

### 1.2 Navbar mobile — descongestión

**Problema:** Con sesión activa hay 4 íconos visibles en mobile.
`TenantThemeToggle` es útil pero no crítico en el navbar.

**Fix:**
- Ocultar `TenantThemeToggle` en mobile (`hidden sm:flex`)
- Resultado: 3 ítems en mobile (carrito + logout/login + info-menu)

### 1.3 Hero overlay — legibilidad texto

**Problema:** `gradient(to top, color_fondo 6%, ...)` — 6% es insuficiente.
En fotos claras el nombre del evento desaparece.

**Fix:** `6%` → `22%` — suficiente para leer el título sin apagar la imagen.

### 1.4 Hero info — posición

**Problema:** El bloque de título/fecha está debajo de la imagen (`mt-6 px-4 pt-6`).
En mobile el usuario tiene que scrollear para ver de qué es el evento.

**Fix:** Superponer el bloque informativo al hero con `absolute bottom-0`.
Estructura: hero imagen + overlay de 60% + `absolute bottom-0 left-0 right-0 p-4` con título, fecha y tanda badge.

---

## Fase 2 — Visual polish

### 2.1 Event cards home — jerarquía y spacing

- Card imagen: `aspect-[4/3]` en lugar de `aspect-square`
- Nombre evento: `font-bold text-[15px]` siempre, nunca `text-sm`
- Badge "Últimas entradas": pill visible con `ring-1 ring-current`
- Mobile lista: imagen fija `h-20 w-20` → `h-24 w-24`, más aire

### 2.2 Detalle de evento — CTA sticky mobile

**Problema:** El botón "Agregar al carrito" está en el medio de la página.
En mobile con evento largo hay que scrollear para comprarlo.

**Fix:** `sticky bottom-[72px]` (encima del bottom nav) con blur backdrop.
Aparece solo cuando hay `selectedItems > 0` o cuando el botón original no está visible.

### 2.3 Checkout mobile

- Resumen precio: sticky al bottom encima del CTA "Pagar"
- Form DNI: expandir por defecto solo el primero, resto collapsado
- Código descuento: mover arriba del resumen

### 2.4 Mis tickets — card mejorada

- Imagen: `aspect-video` con `object-cover` en lugar de `h-24 w-24`
- Nombre evento: `font-bold text-base`, no `text-sm`
- Botones QR/Descargar: bigger tap targets (`h-10`)

---

## Fase 3 — Consistencia

### 3.1 Formularios unified

- `TenantInput` padding: `px-4 py-3` siempre (no `px-2.5`)
- Border: `border-2` en focus (no solo color change)
- Error state: borde rojo + mensaje inline

### 3.2 Empty states

- Mis tickets vacío: ícono grande + CTA "Ver eventos"
- Home sin eventos: ícono + mensaje

### 3.3 Safe area universal

- Todo `fixed bottom-0` debe tener `pb-[env(safe-area-inset-bottom)]`

---

## Criterios de completitud

- [x] Bottom nav: franja Ticketera eliminada, labels 12px, safe-area
- [x] Navbar: theme toggle oculto en mobile
- [x] Hero: overlay 22%
- [x] Hero: info superpuesta a imagen
- [x] Event cards: aspect-ratio 4/3, jerarquía
- [x] Detalle: CTA sticky mobile
- [x] Checkout: sticky summary + order campos (discount inline, first-only accordion)
- [x] Mis tickets: card visual mejorada (aspect-video banner + text-base)
- [x] Formularios: padding estandarizado (py-3, border 20%, focus ring via CSS custom property, error prop)
- [x] Empty states: mis tickets (CTA "Ver eventos") + home
- [x] Safe area: sticky CTA evento-detalle usa `calc(80px + env(safe-area-inset-bottom))` (cubre iPhone notch)
