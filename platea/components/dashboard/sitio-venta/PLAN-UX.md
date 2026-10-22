# Plan UI/UX — Sitio de Venta Configurator

## Estado: en ejecución

---

## Fase 1 — Branding + Home (✅ DONE)

| Item | Estado |
|------|--------|
| Font picker: 2×9 botones → grilla 3×3 compacta con "Ag" renderizado | ✅ |
| Colores: 4 inputs apilados → grid 2×2 | ✅ |
| BrandingVisualSection: SubSections con separadores (Identidad / Plantillas / Colores / Estilo / Tipografía / Navbar) | ✅ |
| Template cards: preview de 52px → 68px con mock de botón activo | ✅ |
| PresentacionHomeSection: `<input checkbox>` nativo → `<Switch>` shadcn | ✅ |
| EventCardsSection: 4 Select → selectores visuales con íconos | ✅ |
| shared-ui: `SubSection` + `compact` prop en `ColorInput` | ✅ |

---

## Fase 2 — Secciones restantes (PENDIENTE)

### 2.1 Announcement section
**Problema actual:** los campos quedan activos visualmente aunque el toggle esté apagado — confunde al usuario.

**Fix:** aplicar `opacity-60 pointer-events-none` al bloque de campos cuando `!bar.enabled`. Feedback inmediato sin cambiar lógica.

### 2.2 Social links section
**Problema actual:**
- 5 inputs de texto sin diferenciación visual por plataforma
- No hay indicador de "campo vacío vs lleno" — al guardar no sabés cuáles quedaron activos
- Sin validación inline de URL

**Fix:**
- Agregar ícono de cada plataforma (lucide: `Instagram`, `Facebook`, `Youtube`, `Twitter`, custom para TikTok)
- Punto de estado colorido por campo: verde si hay URL, gris si vacío
- Layout: ícono | input | dot-status (eliminamos el label redundante)

### 2.3 FAQ section
**Problema actual:**
- Acción row en mobile: Badge + 2 botones anchos → se rompe en stacked layout
- Cards de FAQ tienen mucho padding en mobile (p-4 todo)
- `addFaq` hardcodea `Date.now()` como ID (funciona pero no es declarativo)

**Fix:**
- Acción row: [grip] [título + estado mini-badge] — flex-1 — [EyeIcon] [TrashIcon] (solo íconos, tooltip)
- `p-3` en mobile, `p-4` en sm+
- Descripción: nota aclaratoria de que es el mismo campo que "Descripción del sitio" en Branding

### 2.4 Información section
**Problema actual:**
- Badge siempre "Deshabilitada" para páginas sin contenido
- No hay señal de cuánto contenido tiene cada página
- Texto de ayuda genérico ("Editala en una página dedicada...")

**Fix (tres estados):**
- `page.enabled && page.content.trim()` → badge "Activa" + hint de longitud
- `!page.enabled && page.content.trim()` → badge "Oculta" (tiene contenido pero está desactivada)
- `!page.content.trim()` → badge "Sin contenido" (distingue de "Oculta")

---

## Fase 3 — Contenedor y navegación

### 3.1 Tab icons (sitio-venta-content.tsx)
Agregar iconos a cada tab trigger para mejor scannability:
- Branding → `Palette`
- Home → `Home`
- Información → `FileText`
- Soporte → `LifeBuoy`
- Vista previa → `Eye`

### 3.2 Unsaved changes indicator
El dot indicator actual (azul/gris) está muy pequeño en el footer.
**Fix:** cuando hay cambios, el botón "Guardar cambios" tiene un subtle pulse animation.

---

## Fase 4 — Validación y accesibilidad

### 4.1 Inline URL validation (social links)
Si el campo tiene contenido y no empieza con `https://`, mostrar error inline al blur.
Implementación: state local `urlErrors: Record<string, string>` + onBlur handler.

### 4.2 Font picker accessibility
Los botones del font picker nuevo solo tienen contenido visual.
**Fix:** `aria-label={`Seleccionar fuente ${fontName}`}` + `aria-pressed={active}`.

### 4.3 Color input validation
Si el hex es inválido (no `/^#[0-9a-f]{3,8}$/i`), pintar borde rojo en el input text.
**Fix:** validación en el `onChange` del Input text de `ColorInput`.

### 4.4 Switch aria-labels
Los `<Switch>` en la sección de presentación no tienen `aria-label` independiente (el label es el `<label>` wrapping, pero Switch también necesita `id` para el `htmlFor` del label externo).

---

## Responsive breakpoints — gaps identificados

| Sección | Gap | Fix |
|---------|-----|-----|
| Font picker | 3-col en mobile puede ser muy estrecho (1-2 col debería ser suficiente) | `grid-cols-2 sm:grid-cols-3` |
| Template cards | 1 col en mobile, 3 col en sm — correcto | OK |
| EventCardsSection | `sm:grid-cols-2` para 4 bloques — OK | OK |
| FAQ action row | Buttons full-width en mobile — arreglar | compact icon-only |
| InformacionSection | `lg:grid-cols-2` para 6 páginas | Correcto |

---

## Criterios de completitud

- [x] Announcement: campos dimmed cuando disabled
- [x] Social: monogramas de plataforma + dot de estado
- [x] FAQ: action row compacto icon-only en mobile
- [x] Información: tres estados de badge
- [x] Tabs: íconos
- [x] Font picker: `grid-cols-2 sm:grid-cols-3`
- [x] Font picker buttons: `aria-label` + `aria-pressed`
- [x] ColorInput: validación hex inline
- [x] SocialLinks: URL validation on blur
- [x] Save button: glow ring cuando hay cambios sin guardar
