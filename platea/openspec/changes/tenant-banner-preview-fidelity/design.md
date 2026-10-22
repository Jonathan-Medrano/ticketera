# Design: Tenant Banner Preview Fidelity

## Technical Approach

Improve the existing `HomeSettingsPreview` so its hero portion follows the public tenant hero in `components/tenant/tenant-home.tsx` as the visual source of truth. The implementation should mirror variant-driven structure, image treatment, overlays, and badge hierarchy for `blurred` and `full`, while keeping editor-only placeholder content for missing runtime data and avoiding a hard pixel-perfect clone.

## Architecture Decisions

### Decision: Use the public hero as a behavioral reference, not a reused component

| Option | Tradeoff | Decision |
|---|---|---|
| Reuse `TenantHome` directly | Too coupled to tenant runtime concerns (slider, navbar, cart, session, routing) | Rejected |
| Duplicate JSX independently in preview | Fast, but drifts again | Rejected |
| Extract small shared hero-presentational rules | Keeps parity on variant semantics without coupling runtime logic | Chosen |

Rationale: the preview only needs the hero contract, not the full public page. Shared presentational rules reduce drift without making the editor depend on public page internals.

### Decision: Prefer representative fallback over empty state

| Option | Tradeoff | Decision |
|---|---|---|
| Hide hero when banner image fails/missing | Misleads users into thinking preview is absent | Rejected |
| Always show stylized fallback hero shell | Less realistic than a real image, but preserves layout intent | Chosen |

Rationale: the spec requires the hero area to remain visible and understandable even with invalid or missing remote media.

## Data Flow

`SitioVentaContent` form state  
→ `HomeSettingsPreview` derives hero view-model  
→ shared variant rules choose height, overlays, chips, text hierarchy, and image source  
→ preview renders hero shell  
→ preview event card remains editorial-only below the hero.

Image source priority in preview: first usable `banners[]` item → representative gradient fallback. `imagen_hero` is out of contract; the public hero and the preview both rely on `tenant.banners`.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `openspec/changes/tenant-banner-preview-fidelity/design.md` | Create | Technical design for this change. |
| `components/dashboard/sitio-venta/section-primitives.tsx` | Modify | Refactor `HomeSettingsPreview` to follow the public hero structure and fallback rules. |
| `components/tenant/tenant-home.tsx` | Modify | Optionally extract or consume shared hero-presentational constants if needed to avoid drift. |
| `components/dashboard/remote-preview-image.tsx` | Optional Modify | Keep fallback rendering stable for remote image failure states if current API is insufficient. |
| `components/tenant/tenant-hero-presentational.tsx` or `lib/tenant-hero-preview.ts` | Create | Small shared source for variant tokens/view-model helpers; no runtime-only dependencies. |

## Interfaces / Contracts

The shared contract should stay minimal and presentational, for example:

```ts
type TenantHeroVariant = "blurred" | "full"

type TenantHeroPreviewModel = {
  variant: TenantHeroVariant
  imageUrl?: string
  showDescription: boolean
  title: string
  description?: string
  showPremiumChip: boolean
}
```

Important contract: preview title/description should reflect the public hero structure (`nombre` + optional `descripcion`) rather than inventing unrelated banner copy. The existing event-section title, subtitle, and CTA stay in the lower editorial card.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | Variant mapping and fallback selection | Add pure helper coverage if shared helper is extracted. |
| Integration | `HomeSettingsPreview` renders blurred/full with representative chips, overlays, and fallback hero | Component-level verification once test infra exists; otherwise reviewer-driven manual QA. |
| E2E | Dashboard preview matches public hero semantics after saving | Manual compare between dashboard and tenant public page for both variants and broken/missing image cases. |

Current repo has linting but no visible automated test runner, so rollout should rely on focused manual verification first.

## Migration / Rollout

No migration required. Rollout is low risk because the public tenant experience remains the canonical baseline and the preview is editorial-only. Main concern is future drift, mitigated by keeping shared variant rules in one small presentational module instead of duplicating styling constants.

## Open Questions

- [ ] None blocking.
