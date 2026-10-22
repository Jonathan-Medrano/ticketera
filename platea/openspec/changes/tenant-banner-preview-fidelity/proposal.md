# Proposal: Tenant Banner Preview Fidelity

## Intent

Mejorar la fidelidad del preview del dashboard para que represente con más precisión el hero/banner público del tenant. El preview YA existe en `HomeSettingsPreview`; este cambio NO crea un preview desde cero, sino que corrige la brecha entre edición interna y render final público.

## Scope

### In Scope
- Alinear layout, overlays y jerarquía visual del preview con `components/tenant/tenant-home.tsx` para `banner_variant: blurred | full`.
- Definir qué datos del preview deben reflejar comportamiento real del hero público y cuáles pueden seguir siendo placeholders editoriales.
- Documentar expectativas para consistencia visual entre dashboard y tenant home.

### Out of Scope
- Crear un sistema de preview nuevo o una pantalla de preview separada.
- Rediseñar el hero público más allá de lo necesario para igualar fidelidad.
- Cambios generales de branding fuera del banner/hero home.

## Capabilities

### New Capabilities
- `tenant-banner-preview-fidelity`: Fidelidad y consistencia entre el preview del dashboard y el hero/banner público del tenant.

### Modified Capabilities
- None.

## Approach

Tomar `components/tenant/tenant-home.tsx` como referencia canónica del hero público y ajustar `HomeSettingsPreview` para replicar variantes, overlays, badges, spacing y estados relevantes. La propuesta prioriza parity visual razonable sobre pixel-perfect absoluto cuando el editor use datos simulados.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `openspec/changes/tenant-banner-preview-fidelity/proposal.md` | New | Define alcance y contrato del cambio. |
| `components/dashboard/sitio-venta/section-primitives.tsx` | Modified | Preview del dashboard a alinear con hero público. |
| `components/tenant/tenant-home.tsx` | Referenced | Fuente de verdad visual para variantes del banner. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Intentar pixel-perfect y acoplar demasiado preview y UI pública | Med | Acordar parity funcional/visual, no clon exacto de implementación. |
| Confundir contenido simulado con comportamiento productivo real | Low | Documentar explícitamente placeholders permitidos en preview. |

## Rollback Plan

Revertir los ajustes del preview en dashboard y mantener la UI pública intacta; el comportamiento público del tenant no depende del preview.

## Dependencies

- Comportamiento actual de `banner_variant` (`blurred` | `full`) ya disponible en dashboard y tenant home.

## Success Criteria

- [ ] El cambio deja explícito que el preview ya existía y que el objetivo es mejorar fidelidad, no introducirlo.
- [ ] El futuro spec puede validar consistencia visible entre dashboard preview y hero público para `blurred` y `full`.
- [ ] Queda delimitado qué parte del trabajo afecta preview editorial versus render público real.
