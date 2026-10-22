# Archive Report: redesign-sitio-venta-editor (abandoned, never implemented)

## Qué pasó

Esta change describe (`proposal.md`, `design.md`, `tasks.md`) una reescritura completa del editor de "sitio de venta" — con archivos como `editor-container.tsx`, `editor-shell.tsx`, `section-primitives.tsx`, `sections/identidad-section.tsx`, `sections/home-section.tsx`, `sections/consumibles-section.tsx`, `sections/soporte-section.tsx`, `preview/runtime-preview.tsx` — y `tasks.md` marca 11/12 tareas como completadas (`[x]`).

**Ninguno de esos archivos existió nunca en el filesystem ni en el historial de git** (verificado con `git log --all --diff-filter=A --name-only` y `git log -S"editor-container"` el 14-jul-2026, cero resultados). `verify-report.md` incluso registra un veredicto `FAIL`, pero la change nunca se completó ni se revirtió — quedó fantasma, referenciada como si fuera arquitectura real desde `frontend-agent.md` y `.agents/skills/sitio-venta-editor/SKILL.md`, desorientando a cualquier sesión posterior que confiara en esos docs.

## Por qué se archiva sin implementar

El 14-jul-2026 se construyó desde cero la v1 real del editor nuevo (pestaña propia, navbar, sidebar de secciones, preview en vivo vía postMessage) siguiendo un diseño distinto y verificado contra el código real — ver `openspec/changes/sitio-venta-editor-plantillas-bloques/` (o el nombre de la change vigente que continúa este trabajo). Esa v1 reemplaza y supera el alcance que esta proposal describía, así que no tiene sentido "retomar" esta — se archiva como registro histórico de que la idea se propuso pero nunca se ejecutó.

## Corrección de documentación relacionada

`frontend-agent.md` y `.agents/skills/sitio-venta-editor/SKILL.md` fueron corregidos aparte para apuntar a los archivos reales (`sitio-venta-editor-shell.tsx`, `use-sitio-venta-editor.ts`, `tenant-provider.tsx`, `app/(empresa)/sitio-venta/editor/`) en vez de los inexistentes que esta change mencionaba.
