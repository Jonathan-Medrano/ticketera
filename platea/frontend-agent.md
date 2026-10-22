# AGENTE FRONTEND — UI, RUTAS, TENANT, DASHBOARD Y BFF

## Propósito
Trabajá con este agente cuando el problema viva principalmente en el frontend Next.js: superficies visuales, routing, componentes, auth frontend, theming, BFF o manejo de estado.

## Cuándo usarlo
- bugs de navegación o redirects
- errores visuales o de interacción
- problemas en tenant, dashboard, landing, revendedor o super-admin
- dudas sobre componentes, layouts, providers o contextos
- auth frontend, `useSession`, guards o `proxy.ts`
- dudas sobre cómo el browser llega al backend

## Cuándo NO usarlo
- si el foco principal es contrato API Express o middlewares backend -> usar `../backend/backend-agent.md`
- si el foco principal es tablas, locks, stock, queries críticas o consistencia SQL -> usar `../backend/db-agent.md`

## Fuentes de verdad
- `../frontend.txt`
- `../tenant.txt`
- `../dashboard.txt`
- `../landingpage.txt`
- `../auth.txt`
- `../superadmin.txt`
- `../revendedor.txt`
- `../ui-system.txt`
- `../theming.txt`
- `../bff-next-api.txt`
- `../components-map.txt`
- `../rutas-frontend.txt`
- `../estado-y-contextos.txt`

## Qué cubre

### Superficies reales
- marketing público
- tenant público / comprador
- dashboard empresa
- revendedor
- super-admin

### Arquitectura real
- Next.js App Router
- server-first
- SSR directo al backend en varias páginas
- BFF `app/api/*` para browser/client

### Providers principales
- `AppThemeProvider`
- `NextAuthProvider`
- `TenantProvider`
- `LoadingProvider`

## Señales rápidas
- página vacía
- redirect raro
- login no vuelve
- layout roto
- componente incorrecto
- color o theme mal
- contexto faltante
- `app/api/*`
- `proxy.ts`
- `useSession`

## Hotspots útiles
- `app/page.tsx`
- `proxy.ts`
- `app/t/[tenant]/layout.tsx`
- `components/tenant/tenant-provider.tsx`
- `components/dashboard/sidebar.tsx`
- `components/dashboard/sitio-venta-editor-shell.tsx` (contenedor real desde 14-jul-2026: navbar + sidebar + preview en vivo; NO existe `editor-container.tsx`)
- `components/dashboard/sitio-venta/use-sitio-venta-editor.ts` (hook de estado: draft, guardado, nav-guard)
- `components/tenant/tenant-provider.tsx` (motor de theming + listener de preview en vivo por `postMessage`)
- `lib/backend-proxy.ts`
- `lib/format.ts` (formatMoney/formatInt/formatDateTime/formatDate — ARS es-AR; usar SIEMPRE para plata/números/fechas, no formateadores locales)

## Hallazgos críticos
- Hay un gap real en redirects post-login de consumibles tenant.
- El frontend es server-first y no usa un store global cliente pesado.
- Varias páginas pegan al backend directo desde server components.
- Los carritos tenant son efímeros.
- El theming tenant está separado del theme global.
- `dashboard/sitio-venta` es la bisagra entre backoffice y experiencia pública.
- El revendedor no es un `userType`; es un empleado detectado por permisos.

## Orden sugerido de lectura
1. `../rutas-frontend.txt`
2. `../components-map.txt`
3. `../estado-y-contextos.txt`
4. documentación específica de la superficie afectada (`tenant.txt`, `dashboard.txt`, etc.)
5. `../bff-next-api.txt` si hay proxy o integración

## Protocolo de trabajo
1. Identificá la superficie visible del bug.
2. Verificá la ruta canonical y los aliases.
3. Verificá qué layout o provider gobierna esa superficie.
4. Determiná si el estado vive en SSR, contexto, URL o local state.
5. Verificá si la request sale por `app/api/*` o por fetch server-side directo.
6. Recién después bajá a backend o DB si hace falta.

## Reglas de trabajo
- No mezclar tenant con marketing por costumbre: tienen comportamiento distinto.
- No asumir que todo fetch pasa por `app/api/*`; varias páginas pegan directo al backend desde server components.
- No asumir un único sistema visual; hay shared UI, tenant runtime, marketing y super-admin.
- No culpar al frontend por un estado raro sin revisar si la fuente viene inconsistente desde backend o DB.

## Checklist antes de concluir
- ¿Qué superficie estoy tocando?
- ¿La ruta entra por host/subdominio o por path interno?
- ¿Hay redirect o guard en `proxy.ts`, `auth.config.ts` o layout?
- ¿La data viene por SSR o por BFF?
- ¿El estado depende de contexto, URL params o local state?
- ¿Hay theming global, tenant o marketing involucrado?

## Anti-patrones
- NO asumir que un bug visual es “solo CSS”; puede ser un provider, contexto o guard.
- NO asumir que el browser pega directo al backend.
- NO investigar tenant como si fuera marketing o dashboard; son dominios distintos.
- NO olvidar aliases root-level dependientes del host.
- NO cerrar diagnóstico frontend si el síntoma apunta a backend o DB.

## Resumen operativo
Usá este agente para cualquier tarea donde el problema se vea en pantalla, en navegación, en auth frontend, en theming o en la capa BFF. Si el tema baja a contrato API o consistencia de negocio, coordiná con `../backend/backend-agent.md` o `../backend/db-agent.md`.
