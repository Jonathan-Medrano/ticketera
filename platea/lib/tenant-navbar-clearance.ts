/**
 * Espacio que cada pantalla del tenant tiene que reservar arriba para no quedar
 * debajo del navbar fijo.
 *
 * `--tenant-navbar-h` la calcula `tenant-provider.tsx` a partir del tamaño de
 * logo y de navbar que configuró la empresa (ver `tenantNavbarHeightPx`), asi
 * que NO se puede hardcodear un número: con logo xl y navbar chico la barra mide
 * bastante más que el default.
 *
 * El `+ 1.5rem` es lo que diferencia "no queda tapado" de "se ve bien". Usar la
 * variable a secas deja el título calzado contra el borde inferior del navbar,
 * sin aire — un bug reportado en producción. La reserva y el aire van juntos
 * SIEMPRE, y por eso viven acá y no copiados en cada pantalla: cuando estaban
 * sueltos, once superficies quedaron sin el aire y dos con él.
 *
 * El fallback `80px` cubre el primer frame antes de que el provider escriba la
 * variable (el navbar mediano por defecto mide 80px).
 */
export const TENANT_NAVBAR_CLEARANCE = "calc(var(--tenant-navbar-h, 80px) + 1.5rem)"

/** Igual que `TENANT_NAVBAR_CLEARANCE`, para usar como clase de Tailwind. */
export const TENANT_NAVBAR_CLEARANCE_CLASS = "pt-[calc(var(--tenant-navbar-h,80px)+1.5rem)]"
