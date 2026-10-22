# Ticketera

Plataforma multi-empresa de venta de entradas y consumibles para eventos: sitio de venta propio por empresa (con plantillas), checkout con Mercado Pago, entradas con QR, control de acceso, punto de venta, marketing, revendedores y una consola de plataforma para el dueño.

> Proyecto de portfolio: un sistema de venta de entradas multi-empresa, construido de punta a punta para practicar un producto real con dinero de por medio. **No está en producción ni tiene clientes.** No hay credenciales, cuentas ni datos reales en el repo; todo lo que se ve en las capturas es **dato simulado** generado por los seeds.

## Qué incluye

| Área | Qué hace |
|---|---|
| **Sitio público por empresa (tenant)** | Home de eventos, página de evento, selección de entradas, carrito, checkout, "mis tickets" con QR, consumibles. 8 plantillas base (Nocturna, Clara, Vibrante, Premium, Tech, Urbano, Under, Pastel) + editor de marca |
| **Panel de la empresa** | Eventos (crear/editar/preimpresos/lista de espera), ventas, compradores, revendedores, equipo y roles, comisiones, reembolsos, reconciliación, marketing (promos, segmentos, email), barra y consumibles, POS, escáner QR |
| **Cobros** | Conexión de cuenta Mercado Pago por OAuth, comisión marketplace, readiness comercial |
| **Superadmin (consola de plataforma)** | Dashboard de ganancias y reparto, empresas, usuarios, comisiones y fee-tiers por volumen, configuración, auditoría, rendimiento, analítica |

## Capturas

Versiones optimizadas en [`docs/capturas-web/`](docs/capturas-web) (WebP ≤ 1920 px). Los PNG originales a 2x no se versionan por tamaño: se regeneran con `scripts/capturas.mjs`.

### Sitio de venta con plantillas
| | |
|---|---|
| ![Premium](docs/capturas-web/50-sitio-03-premium.webp) | ![Vibrante](docs/capturas-web/50-sitio-02-vibrante.webp) |
| ![Clara](docs/capturas-web/50-sitio-04-clara.webp) | ![Urbano](docs/capturas-web/50-sitio-06-urbano.webp) |

Más: `50-sitio-01-nocturna`, `05-tech`, `07-under`, `08-pastel`; móvil: `55-sitio-movil-premium`, `55-sitio-movil-vibrante`.

### Flujo del comprador
Evento → selección → checkout → mis tickets → QR de acceso → consumibles → pago.

| | |
|---|---|
| ![Evento](docs/capturas-web/61b-seleccion-detalle.webp) | ![Checkout](docs/capturas-web/62-checkout.webp) |
| ![Mis tickets](docs/capturas-web/63-mis-tickets.webp) | ![QR](docs/capturas-web/64-ticket-qr.webp) |

Versión móvil del flujo completo: `70`–`78-*`.

### Panel de la empresa
![Dashboard](docs/capturas-web/10-dashboard.webp)

| | |
|---|---|
| ![Eventos](docs/capturas-web/11-eventos.webp) | ![Ventas](docs/capturas-web/13-ventas.webp) |
| ![Cobros Mercado Pago](docs/capturas-web/14-cobros-mercado-pago.webp) | ![Editor del sitio](docs/capturas-web/15-sitio-venta-editor.webp) |
| ![POS](docs/capturas-web/17-pos.webp) | ![Escáner QR](docs/capturas-web/17a-escanear-qr.webp) |
| ![Barra y consumibles](docs/capturas-web/16a-consumibles-ventas.webp) | ![Marketing](docs/capturas-web/21c-marketing-email.webp) |
| ![Revendedores](docs/capturas-web/24-revendedores.webp) | ![Equipo](docs/capturas-web/18-equipo.webp) |

### Consola de plataforma (superadmin)
![Superadmin](docs/capturas-web/30-super-dashboard.webp)

| | |
|---|---|
| ![Empresas](docs/capturas-web/31-super-empresas.webp) | ![Fee tiers](docs/capturas-web/33-super-fee-tiers.webp) |

## Estructura

- `backend/` — API Express + TypeScript (Prisma, Postgres)
- `platea/` — frontend Next.js (BFF + sitio por tenant + paneles)
- `prisma/` — esquema y migraciones de referencia
- `tests/`, `openspec/`, `sdd/`, `features/` — pruebas y especificaciones
- `scripts/capturas.mjs` — genera todas las capturas con Playwright

## Correrlo en local (sin servicios externos)

No hace falta ninguna cuenta: la base es un Postgres embebido y Mercado Pago queda "conectado" con una cuenta ficticia.

```bash
# 1) dependencias
cd backend && npm install && npm install --no-save embedded-postgres pg
cd ../platea && npm install

# 2) variables: copiar los .env.example y completar con secretos generados al azar
#    (backend/.env.example -> backend/.env, platea/.env.example -> platea/.env.local)

# 3) base local persistente (puerto 5434) y migraciones
cd backend && node scripts/dev-pg.mjs         # dejar corriendo
npx prisma migrate deploy

# 4) datos simulados
SUPERADMIN_PASSWORD='<elegí-una-de-12+-caracteres>' npx prisma db seed
npm run seed:demo
npx tsx scripts/seed-portfolio.ts
npx tsx scripts/seed-portfolio-extras.ts
npx tsx scripts/seed-portfolio-sitio.ts premium

# 5) apps
npm run dev                                    # API :3001
cd ../platea && npx next dev -p 3000           # web :3000
```

Los seeds crean usuarios de **demo local** (`demo@demo.ticketera.test`, `comprador@demo.ticketera.test`, `Demo1234!`) y el superadmin usa la contraseña que pasés en `SUPERADMIN_PASSWORD`. Son solo para la base local descartable.

### Regenerar las capturas
Con ambas apps y la base sembrada corriendo, cargá el `.env` del backend en la shell, exportá `SUPERADMIN_PASSWORD` y ejecutá:
```bash
node scripts/capturas.mjs               # todo (≈25 min)
node scripts/capturas.mjs sitio         # solo plantillas del sitio
node scripts/capturas.mjs comprador     # solo flujo del comprador
```

## Notas

- Se corrigieron 3 problemas encontrados al levantarlo: fechas `DATE` mal formateadas en los reportes de plataforma (gráfico vacío), `preload` + `priority` simultáneos en el carrusel del sitio (error de Next 16) y altura colapsada del gráfico de ganancias del superadmin.
- Subida de imágenes (almacenamiento externo), email transaccional y OAuth de Mercado Pago/Google requieren credenciales propias y están desactivados en esta plantilla.
