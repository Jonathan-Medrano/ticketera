-- Remueve la tabla evento_reviews: feature de reviews de eventos que nunca se implementó
-- (0 rutas backend, 0 UI, tabla siempre vacía). Creada en la migración init y arrastrada como
-- vaporware. Idempotente y segura para el arranque del contenedor.
DROP TABLE IF EXISTS "evento_reviews";
