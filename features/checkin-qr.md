# Features — Check-in / QR (puerta y barra)
**Rol:** fuente de verdad · **Última actualización:** 2026-06-23

## Qué es esta zona
Validación en puerta de entradas/addons/tickets físicos y canje de consumibles en barra, ambos por escaneo de QR o tipeo de clave corta. Una sola pantalla (`/dashboard/escanear`) con dos modos (`entradas` / `consumibles`); el canje de barra también vive en `/dashboard/consumibles/canjear`. **El QR de ENTRADA y el QR de CONSUMIBLE son SEPARADOS** (códigos y endpoints distintos).

## Features
| Feature | Estado | Archivos clave | Notas / deuda |
|---|---|---|---|
| Escaneo de entrada en puerta (marcar `usada`) | ✅ | `backend/src/routes/escanear.ts:67-408` · `platea/app/api/escanear/route.ts` | UPDATE atómico con `WHERE estado='valida'` → serializa carreras (doble scan = solo uno gana). Acepta `qr_code` o `clave_corta`. |
| Fallback a tickets físicos preimpresos | ✅ | `escanear.ts:110-220` | Si el código no es `entradas`, intenta `ticket_fisicos` (`disponible`/`vendido` → `usada`). Mismo patrón atómico anti doble-canje. |
| Fallback a addons (parking, meet&greet, merch) | ✅ | `escanear.ts:223-297` | Tercer fallback sobre `evento_addon_ventas` (`valida` → `usada`). |
| Diagnóstico de fallo (ya usada / cancelada / no encontrada) | ✅ | `escanear.ts:301-383` | Devuelve `ok:false` + `motivo`, y para "ya usada" muestra `comprador`, `usada_at`, `used_by_user_name`. |
| Canje de consumibles en barra (preview → confirmar/resolver) | ✅ | `backend/src/routes/canjear.ts` · `backend/src/lib/consumibles-redeem.ts` | Flujo de 2 pasos: `previewConsumiblesRedeem` (valida) → `confirmar` (todo entregado) o `resolver` (entrega/reembolso por unidad). Requiere `barra_id`. |
| Pantalla de escáner unificada (cámara + manual) | ✅ | `platea/components/dashboard/escanear-content.tsx` · `platea/app/(empresa)/dashboard/escanear/page.tsx` | Pasos `seleccion`→`camara`/`manual`. Cámara vía `html5-qrcode` (`facingMode: environment`, fps 10). Modo manual: input de clave corta/QR. |
| Pantalla dedicada de canje de barra | ✅ | `platea/components/dashboard/consumibles-canjear-content.tsx` · `platea/app/(empresa)/dashboard/consumibles/canjear/page.tsx` | Variante enfocada solo en barra, con resolución entregado/reembolsado por unidad. |
| Anti doble-scan (cooldown + lock + dedupe de código) | ✅ | `escanear-content.tsx:65-66,251-259,326-331` · `consumibles-canjear-content.tsx:61-89` | `SCAN_COOLDOWN_MS=2500`, `scanLockedRef`, dedupe del último código; backend igual serializa por SQL. |
| Stats de check-in en vivo (polling) | ✅ | `backend/src/routes/escanear.ts:418-494` (`GET /stats`) · `platea/components/dashboard/escanear-stats-card.tsx` | Polling cada 10s: total, usadas, % check-in, última hora, últimos 5 min. Solo modo entradas. |
| Export del historial de escaneos (XLSX/CSV) | ✅ | `escanear.ts:502-612` (`GET /export`) · `platea/app/api/escanear/export/route.ts` | Requiere permiso `exportar`. Filtros por escaneador/desde/hasta. Máx 20.000 filas. CSV con anti formula-injection. |
| Permisos / roles que escanean | ✅ | `platea/lib/permisos.ts:137-211` · `backend/src/routes/escanear.ts:71` · `canjear.ts:16-17` | Rol **`puerta`** → `escanear:true`. Rol **`barra`** → `canjear_consumibles:true`. `admin` tiene ambos. Backend exige `requirePermissionMiddleware('escanear')` y `requirePermission('canjear_consumibles')`. |
| Auditoría de actividad del empleado | ✅ | `escanear.ts` (`logEmpleadoActividad`, tipos `escaneo`/`escaneo_fallido`) | Registra escaneos OK y fallidos con metadata (evento, código, motivo). |
| Cache "offline" de entradas (solo lectura/display) | ⚠️ | `escanear-content.tsx:125-244,489-511` · `escanear.ts:614-682` (`GET /cache`) · `platea/app/api/escanear/cache/route.ts` | Descarga entradas a `sessionStorage` (máx 5000, rate-limit 5/5min). **Sirve solo para mostrar datos del comprador sin red — NO marca la entrada.** |
| Marcado offline real | ⚠️ deuda/limitación | `escanear-content.tsx:261-273` | **NO EXISTE.** Sin red el escáner devuelve `ok:false` "Sin conexión — el marcado requiere internet". El UPDATE de `usada` necesita backend online. Badge `ConnectivityBadge` muestra Online/Sin conexión. **No sobrevender check-in offline.** |

## Lo que NO hay (anti-alucinación)
- **NO hay marcado/validación offline.** La cache offline es solo de lectura; sin internet no se puede marcar una entrada como usada ni canjear un consumible.
- **NO hay Service Worker ni PWA de escáner.** No hay cola de escaneos pendientes que se sincronice al volver la red.
- **NO hay NFC ni pulseras (wristbands).** El único material de marketing que menciona "pulseras" lo hace para decir que NO se usan (`landing-features.tsx:51`: "sin caja ni pulseras"). No hay código NFC en la app.
- **El QR de entrada y el de consumible NO son el mismo.** Endpoints separados (`/api/escanear` vs `/api/consumibles/canjear`), códigos separados, permisos separados.
- **NO hay hardware lector dedicado.** El escaneo es por cámara del dispositivo (`html5-qrcode`) o tipeo manual.
- **NO hay check-in geolocalizado ni control de aforo en tiempo real que bloquee** (las stats son informativas, no gatean el ingreso).

## Ver también
- `../FEATURES.md`
- `entradas.md` — emisión/estado de `entradas`, `qr_code`, `clave_corta`
- `consumibles-barra.md` — venta de barra y `consumibles-redeem`
- `auth-onboarding.md` — roles `puerta` / `barra` y modelo de permisos
- `../playbook-consumibles-canje.md` — triage de incidentes de canje
