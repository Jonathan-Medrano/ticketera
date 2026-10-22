-- Enable pg_trgm extension for fuzzy/similarity search on consumibles
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN indexes on consumibles search columns
CREATE INDEX IF NOT EXISTS idx_consumibles_nombre_trgm
  ON consumibles USING gin (nombre gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_consumibles_descripcion_trgm
  ON consumibles USING gin (descripcion gin_trgm_ops);
