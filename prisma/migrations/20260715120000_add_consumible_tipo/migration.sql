-- CreateEnum
CREATE TYPE "ConsumibleTipoEnum" AS ENUM ('bebida_alcoholica', 'bebida_sin_alcohol', 'comida', 'otro');

-- AlterTable
ALTER TABLE "consumibles" ADD COLUMN     "tipo" "ConsumibleTipoEnum" NOT NULL DEFAULT 'otro';

-- Backfill best-effort por palabras clave — reemplaza la heurística client-side
-- que vivía en tenant-consumibles-evento.tsx (clasificarItem), sumando deteccion
-- de alcohol que esa heurística nunca tuvo (solo distinguía comida/bebidas).
-- NO es exacto: es un punto de partida razonable, no una clasificación garantizada.
-- Verificar contra datos reales de catálogo antes de aplicar en producción — lo
-- que no matchee ninguna palabra clave queda en 'otro' (no se fuerza un guess).

-- Comida: mismas palabras clave que la heurística original.
UPDATE "consumibles" SET "tipo" = 'comida'
WHERE "tipo" = 'otro' AND (
  nombre ILIKE '%burger%' OR nombre ILIKE '%hamburguesa%' OR nombre ILIKE '%papas%' OR
  nombre ILIKE '%pizza%' OR nombre ILIKE '%pancho%' OR nombre ILIKE '%nacho%' OR
  nombre ILIKE '%sandwich%' OR nombre ILIKE '%sánd%' OR nombre ILIKE '%empanada%' OR
  nombre ILIKE '%comida%' OR
  descripcion ILIKE '%burger%' OR descripcion ILIKE '%hamburguesa%' OR descripcion ILIKE '%papas%' OR
  descripcion ILIKE '%pizza%' OR descripcion ILIKE '%pancho%' OR descripcion ILIKE '%nacho%' OR
  descripcion ILIKE '%sandwich%' OR descripcion ILIKE '%sánd%' OR descripcion ILIKE '%empanada%'
);

-- Bebida alcohólica: "%ron %" (con espacio) para no matchear "corona" u otras
-- palabras que contienen la subcadena "ron".
UPDATE "consumibles" SET "tipo" = 'bebida_alcoholica'
WHERE "tipo" = 'otro' AND (
  nombre ILIKE '%cerveza%' OR nombre ILIKE '%birra%' OR nombre ILIKE '%vino%' OR nombre ILIKE '%fernet%' OR
  nombre ILIKE '%whisky%' OR nombre ILIKE '%whiskey%' OR nombre ILIKE '%vodka%' OR nombre ILIKE '%gin%' OR
  nombre ILIKE '%ron %' OR nombre ILIKE '%tequila%' OR nombre ILIKE '%champagne%' OR nombre ILIKE '%sidra%' OR
  nombre ILIKE '%trago%' OR nombre ILIKE '%cocktail%' OR nombre ILIKE '%coctel%' OR nombre ILIKE '%aperitivo%'
);

-- Bebida sin alcohol: solo términos inequívocos.
UPDATE "consumibles" SET "tipo" = 'bebida_sin_alcohol'
WHERE "tipo" = 'otro' AND (
  nombre ILIKE '%agua%' OR nombre ILIKE '%gaseosa%' OR nombre ILIKE '%coca%' OR nombre ILIKE '%sprite%' OR
  nombre ILIKE '%fanta%' OR nombre ILIKE '%jugo%' OR nombre ILIKE '%soda%' OR nombre ILIKE '%energizante%'
);
