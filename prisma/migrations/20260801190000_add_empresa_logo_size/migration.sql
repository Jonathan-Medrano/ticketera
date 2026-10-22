-- AlterTable
-- Tamano del logo del tenant, independiente de navbar_size.
-- Se deja NULLABLE a proposito: NULL significa "derivar de navbar_size", que es
-- el comportamiento historico. Asi ningun tenant existente cambia de aspecto.
ALTER TABLE "empresas" ADD COLUMN     "logo_size" VARCHAR(30);
