# AGENTE BACKEND — API, CONTRATOS Y LÓGICA DE NEGOCIO

## Propósito
Trabajá con este agente cuando el problema viva principalmente en la API Express, sus endpoints, middlewares, permisos, pagos o flujos de negocio.

## Cuándo usarlo
- errores de contrato API
- endpoints que responden mal o de forma inesperada
- middlewares, auth o authz
- callbacks, webhooks e integraciones externas
- flows tenant o dashboard desde la API
- dudas sobre payloads, responses o side effects de backend

## Cuándo NO usarlo
- si el foco principal es UI, navegación o theming -> usar `../platea/frontend-agent.md`
- si el foco principal es tablas, locks, índices, consistencia o SQL -> usar `db-agent.md`

## Fuentes de verdad
- `../backend.txt`
- `../queries-criticas.txt` si la ruta pega fuerte en producción
- `../database.txt` si la ruta toca invariantes de stock, pagos o sesiones

## Qué cubre

### Superficie técnica
- rutas `/api/*`
- middlewares
- auth y authz
- rate limits
- tenant público B2C
- cobros y Mercado Pago
- contratos request/response
- scripts y testing del backend

### Mapa mental rápido
- Backend Node + Express + TypeScript + PostgreSQL (Supabase) vía Prisma
- monolito modular por routers
- dos superficies principales: dashboard/backoffice interno y tenant público B2C

## Señales rápidas
- error `401` / `403` / `409` del backend
- payload inválido
- middleware roto
- callback OAuth
- endpoint tenant
- response inesperada
- `proxyToBackend` devuelve algo raro y el síntoma parece contrato API

## Hotspots útiles
- `backend/src/index.ts`
- `backend/src/routes/index.ts`
- `backend/src/middleware/auth.ts`
- `backend/src/lib/authz.ts`
- `backend/src/routes/tenant.ts`
- `backend/src/routes/eventos.ts`
- `backend/src/routes/vender.ts`
- `backend/src/lib/password-reset.ts`
- `backend/src/routes/cobros.ts`
- `backend/src/lib/payment-accounts.ts`

## Hallazgos críticos
- Casi todo depende de `x-internal-secret`.
- `x-user` NO se confía ciegamente; se rehidrata desde DB.
- Authn/authz vive en `middleware/auth.ts` y `lib/authz.ts`.
- `checkout_sessions` coordina reserva, confirmación y reconciliación.
- Mercado Pago manual está deshabilitado; la conexión moderna es por OAuth.
- Varias rutas sanitizan montos y PII según permisos efectivos.
- El backend está diseñado para vivir detrás de un caller interno confiable.

## Orden sugerido de lectura
1. `../backend.txt`
2. `backend/src/index.ts`
3. `backend/src/routes/index.ts`
4. `backend/src/middleware/auth.ts`
5. `backend/src/lib/authz.ts`
6. el router específico del dominio afectado

## Protocolo de trabajo
1. Identificá el endpoint exacto o la familia de endpoints.
2. Verificá qué guards y middlewares lo protegen.
3. Determiná si el problema es de contrato, permisos o side effects.
4. Si aparece stock, reserva o reconciliación, escalá a `db-agent.md`.
5. Si el síntoma original es UI, navegación o redirect, cruzá con `../platea/frontend-agent.md`.

## Reglas de trabajo
- Verificá primero si el problema es de contrato API o de DB.
- Si el problema real es concurrencia, stock o locks, derivá rápido a `db-agent.md`.
- Si el problema visible es pantalla, redirect o guard frontend, coordiná con `../platea/frontend-agent.md`.
- No asumas que una respuesta `200` implica éxito total: algunas rutas usan `ok:false` para fallas de negocio.
- No asumas que el payload que llega al backend es idéntico al del browser: puede venir transformado por la BFF.

## Checklist antes de concluir
- ¿Qué endpoint exacto participa?
- ¿Qué middleware corta primero la request?
- ¿Qué permiso o `userType` se exige?
- ¿El problema es de contrato, permisos o side effect?
- ¿La respuesta puede ser `200` con error funcional?
- ¿Hay integración externa involucrada?

## Anti-patrones
- NO diagnosticar oversell o stock raro solo leyendo routers: pasar a `db-agent.md`.
- NO culpar al backend si el redirect o guard falla antes en frontend.
- NO leer una sola ruta aislada si el flow real cruza callback, webhook y confirmación.
- NO ignorar `tenant.ts`; muchos problemas visibles terminan ahí.

## Resumen operativo
Usá este agente para entender cómo funciona la API y qué endpoint manda en cada flujo. Si el problema baja a stock, locks o consistencia, cambiá rápido a `db-agent.md`.
