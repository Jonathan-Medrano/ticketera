-- Índice funcional para acelerar el lookup de código de descuento en el checkout.
-- Las queries del path de pago filtran por (empresa_id AND UPPER(codigo)); el
-- @@unique([empresa_id, codigo]) es un B-tree sobre `codigo` crudo y NO puede servir
-- la expresión UPPER(codigo), así que el lookup degrada a scan filtrado solo por empresa_id.
--
-- NO-UNIQUE a propósito: un índice UNIQUE funcional podría fallar al crearse si existen
-- filas legacy con códigos duplicados por mayúsculas/minúsculas (p.ej. 'VERANO' y 'verano'),
-- y un fallo en migrate deploy bloquearía el arranque del backend (outage). Los códigos
-- nuevos ya se normalizan a mayúsculas al guardar, así que no se acumulan duplicados.
-- El upgrade a UNIQUE queda pendiente de una auditoría de la data de prod.
--
-- Idempotente (IF NOT EXISTS) para que re-aplicar el deploy no falle.
CREATE INDEX IF NOT EXISTS "marketing_codigos_descuento_empresa_upper_codigo_idx"
  ON "marketing_codigos_descuento" ("empresa_id", UPPER("codigo"));
