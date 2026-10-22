# Spec — Comisiones por volumen (fee tiers)

Palabras clave según RFC 2119: **MUST / MUST NOT / SHALL / SHOULD / MAY**.

---

## R1 — Escalera de tiers configurable

**R1.1** El sistema **MUST** persistir la escalera de tiers en la tabla
`platform_fee_tiers`, con al menos: `nombre`, `min_entradas_90d`,
`pct_entradas`, `pct_consumibles`, `activo`.

**R1.2** La escalera **MUST NOT** estar hardcodeada en el código de la
aplicación. Un cambio de umbral o de porcentaje **MUST** ser aplicable sin
deploy.

**R1.3** `min_entradas_90d` **MUST** ser único entre los tiers activos. Dos
tiers activos con el mismo umbral son una configuración inválida y el sistema
**MUST** rechazar el guardado.

**R1.4** La escalera **MUST** contener un tier base con `min_entradas_90d = 0`,
que actúa como piso. El sistema **MUST NOT** permitir desactivar o eliminar el
último tier con umbral 0.

**R1.5** Los porcentajes **MUST** estar en el rango `0 <= pct <= 100` y **MUST**
persistirse con precisión `Decimal(5,2)`.

**R1.6** Un tier con umbral mayor **SHOULD** tener porcentajes menores o iguales
que el tier inmediatamente inferior. Si no se cumple, el sistema **MUST**
advertirlo al guardar, pero **MAY** permitirlo (escenario de promoción temporal).

### Escenarios

```gherkin
Escenario: Guardar un tier válido
  Dado que soy un admin con la capability platform.fees.defaults.edit
  Cuando guardo un tier "Pro" con umbral 2000, entradas 3.50 y consumibles 2.50
  Entonces el tier queda persistido y activo
  Y la próxima corrida del job lo considera al resolver

Escenario: Rechazar umbral duplicado
  Dado que existe un tier activo con min_entradas_90d = 2000
  Cuando intento guardar otro tier activo con min_entradas_90d = 2000
  Entonces el sistema rechaza el guardado con un error explícito
  Y ningún tier es modificado

Escenario: Proteger el tier base
  Dado que el único tier con umbral 0 es "Base"
  Cuando intento desactivarlo
  Entonces el sistema rechaza la operación
  Y "Base" sigue activo
```

---

## R2 — Cálculo del volumen

**R2.1** El volumen de una empresa **MUST** definirse como la cantidad de filas
en `entradas` que cumplan **todas** estas condiciones:

- pertenecen a un evento de esa empresa (`entradas.evento_id → eventos.empresa_id`);
- `medio_pago_presencial IS NULL` (venta online, no POS presencial);
- `estado <> 'cancelada'` (no reembolsada);
- `created_at >= now() - interval '90 days'`.

**R2.2** El sistema **MUST NOT** usar montos en ARS como métrica de volumen.

**R2.3** El conteo **MUST** registrarse junto con cada decisión de tier, para
que toda evaluación sea reproducible y auditable a posteriori.

**R2.4** El job **MUST** evaluar únicamente empresas activas, y **MUST** excluir
las marcadas como `es_prueba`.

### Escenarios

```gherkin
Escenario: Las ventas de puerta no cuentan
  Dada una empresa con 5.000 entradas vendidas en POS presencial en 90 días
  Y 100 entradas vendidas online en el mismo período
  Cuando el job calcula su volumen
  Entonces el volumen es 100
  Y la empresa permanece en el tier Base

Escenario: Las entradas reembolsadas no cuentan
  Dada una empresa con 2.100 entradas online en 90 días
  Y 200 de ellas en estado 'cancelada'
  Cuando el job calcula su volumen
  Entonces el volumen es 1.900
  Y la empresa NO califica para el tier Pro (umbral 2.000)

Escenario: La ventana es móvil
  Dada una empresa con 3.000 entradas online vendidas hace 120 días
  Y 50 entradas en los últimos 90 días
  Cuando el job calcula su volumen
  Entonces el volumen es 50
```

---

## R3 — Ascenso automático (la comisión baja)

**R3.1** Cuando el volumen de una empresa la califica para un tier con
porcentajes **menores** que los vigentes, el sistema **MUST** aplicar el cambio
automáticamente, sin intervención humana.

**R3.2** La aplicación **MUST** hacerse vía UPSERT sobre
`empresa_marketplace_fee_overrides`, para los flows `entradas` y `consumibles`,
con `mode = 'percentage'`.

**R3.3** El sistema **MUST** registrar una fila en `empresa_fee_tier_events` con
el porcentaje anterior, el nuevo, el tier resuelto, el conteo de la ventana y el
origen (`'system'`).

**R3.4** El sistema **MUST** crear un `platform_messages` dirigido a esa empresa
(`target_type = 'empresa'`, `target_empresa_id`) informando la nueva comisión.

**R3.5** El sistema **MUST NOT** modificar retroactivamente ninguna venta,
entrada, sesión de checkout ni comisión ya cobrada.

### Escenarios

```gherkin
Escenario: Ascenso aplicado solo
  Dada una empresa en tier Base (4,00% / 3,00%)
  Y un volumen de 2.400 entradas online en 90 días
  Y un tier Pro activo con umbral 2.000 (3,50% / 2,50%)
  Cuando corre el job de evaluación
  Entonces empresa_marketplace_fee_overrides queda en 3,50% para 'entradas'
  Y en 2,50% para 'consumibles'
  Y se registra un evento de auditoría con origen 'system'
  Y la empresa recibe un mensaje in-app

Escenario: Las ventas ya cobradas no se tocan
  Dada una empresa que asciende a tier Pro
  Y una entrada vendida ayer con comision calculada al 4,00%
  Cuando corre el job de evaluación
  Entonces esa entrada conserva su comision original
  Y solo las sesiones de checkout creadas después usan 3,50%
```

---

## R4 — Descenso asistido (la comisión sube)

**R4.1** Cuando el volumen califica a una empresa para un tier con porcentajes
**mayores** que los vigentes, el sistema **MUST NOT** aplicar el cambio
automáticamente.

**R4.2** El sistema **MUST** registrar la intención en
`empresa_fee_tier_state` (`pending_downgrade_tier_id`, `pending_desde`) y
exponerla en una cola de revisión en super-admin.

**R4.3** Un descenso **MUST** requerir la capability
`platform.companies.overrides.edit` para ser aplicado.

**R4.4** Al aplicarse un descenso, el sistema **MUST** registrar el evento de
auditoría con origen `'admin'` y el id del admin que lo aprobó.

**R4.5** Si el volumen de la empresa vuelve a subir antes de que el descenso sea
aprobado, el sistema **MUST** cancelar el descenso pendiente.

### Escenarios

```gherkin
Escenario: El descenso no se aplica solo
  Dada una empresa en tier Pro (3,50% / 2,50%)
  Y un volumen que cae a 800 entradas en 90 días
  Cuando corre el job de evaluación
  Entonces la comisión vigente SIGUE siendo 3,50% / 2,50%
  Y se marca un pending_downgrade hacia el tier Base
  Y la empresa aparece en la cola de revisión de super-admin

Escenario: El descenso se cancela si el volumen se recupera
  Dada una empresa con un pending_downgrade hacia Base
  Y un volumen que vuelve a 2.500 entradas en 90 días
  Cuando corre el job de evaluación
  Entonces el pending_downgrade se cancela
  Y la empresa desaparece de la cola de revisión
  Y su comisión nunca cambió

Escenario: Un admin aplica el descenso
  Dada una empresa con pending_downgrade hacia Base
  Y un admin con la capability platform.companies.overrides.edit
  Cuando el admin aprueba el descenso
  Entonces la comisión pasa a 4,00% / 3,00%
  Y se registra un evento con origen 'admin' y el id del admin
```

---

## R5 — Respeto de comisiones negociadas a mano (`pinned`)

**R5.1** Si un admin fijó manualmente la comisión de una empresa, esa empresa
**MUST** poder marcarse como `pinned` en `empresa_fee_tier_state`.

**R5.2** El job **MUST NOT** modificar la comisión de una empresa `pinned`, ni
para subir ni para bajar, cualquiera sea su volumen.

**R5.3** El job **SHOULD** seguir calculando y registrando el volumen de las
empresas `pinned`, para que el admin vea qué tier les correspondería.

**R5.4** Quitar el `pinned` **MUST** requerir la capability
`platform.companies.overrides.edit`.

### Escenarios

```gherkin
Escenario: El job respeta un acuerdo comercial
  Dada una empresa con comisión negociada a mano en 2,00% y marcada pinned
  Y un volumen de 50 entradas en 90 días (le correspondería el tier Base)
  Cuando corre el job de evaluación
  Entonces su comisión SIGUE siendo 2,00%
  Y no se genera pending_downgrade
  Y el panel muestra que su tier calculado sería "Base"
```

---

## R6 — Ejecución del job

**R6.1** El job **MUST** correr con un intervalo por defecto de 24 horas.

**R6.2** El job **MUST** tomar `pg_try_advisory_lock(9003)` antes de procesar, y
**MUST** liberarlo en un bloque `finally`. Si no lo obtiene, **MUST** terminar
sin procesar.

**R6.3** El advisory lock **MUST** usar `prismaDirectUrl` (conexión directa,
puerto 5432). **MUST NOT** usar el cliente pooler.

**R6.4** El job **MUST** poder desactivarse por variable de entorno
(`FEE_TIER_EVALUATION_ENABLED=0`) sin requerir deploy de código.

**R6.5** El job **MUST NOT** correr durante los tests salvo opt-in explícito, ni
en modo migración — mismo patrón que los jobs existentes.

**R6.6** Un fallo procesando una empresa **MUST NOT** abortar la corrida
completa: el job **MUST** continuar con las demás y registrar el error.

### Escenarios

```gherkin
Escenario: Dos máquinas Fly, una sola corrida
  Dadas dos instancias del backend arrancando a la vez
  Cuando ambas disparan el job de evaluación
  Entonces solo una obtiene el advisory lock 9003 y procesa
  Y la otra termina sin modificar ninguna comisión

Escenario: Una empresa rota no frena al resto
  Dadas 50 empresas a evaluar
  Y la empresa #12 provoca un error al aplicar su override
  Cuando corre el job
  Entonces las otras 49 se procesan igual
  Y el error de la #12 queda registrado
```

---

## R7 — Auditoría

**R7.1** Todo cambio de comisión originado por esta feature **MUST** producir
una fila en `empresa_fee_tier_events` con: empresa, flow, `pct_anterior`,
`pct_nuevo`, tier resuelto, `entradas_ventana`, origen (`'system' | 'admin'`),
`aplicado_por` (null si es del sistema) y timestamp.

**R7.2** Las filas de auditoría **MUST** ser inmutables: solo INSERT. El sistema
**MUST NOT** exponer UPDATE ni DELETE sobre esta tabla.

**R7.3** El historial de una empresa **MUST** ser consultable desde super-admin.

---

## R8 — Transparencia contractual

**R8.1** Antes de activar la escalera en producción, los Términos y Condiciones
(`platea/app/(marketing)/terminos/page.tsx`) **MUST** declarar:

- la comisión de consumibles online (hoy ausente del texto);
- la existencia del esquema de comisión por volumen;
- que una baja de volumen puede derivar en un ajuste de comisión, con aviso previo.

**R8.2** La página de precios **MAY** exponer la escalera, pero si lo hace
**MUST** reflejar los valores reales de `platform_fee_tiers`, no valores
escritos a mano en el componente.

> Esta es la regla que evita repetir el problema original: la copy prometía un
> tier que el sistema no tenía. Si la escalera se publica, se publica desde la
> fuente de verdad.
