-- AlterTable
ALTER TABLE "empresas" ADD COLUMN     "border_radius" VARCHAR(20),
ADD COLUMN     "button_style" VARCHAR(20),
ADD COLUMN     "color_superficie" VARCHAR(20),
ADD COLUMN     "heading_font" VARCHAR(50),
ADD COLUMN     "navbar_blur" BOOLEAN NOT NULL DEFAULT false;
