# tenant-banner-preview-fidelity Specification

## Purpose

Definir la fidelidad esperada del preview existente del dashboard para que represente de forma confiable el hero/banner público del tenant sin convertir este cambio en una iniciativa de preview nueva.

## Requirements

### Requirement: Continuidad del preview existente

The system MUST treat this change as an improvement of the existing dashboard preview, not as the introduction of preview capability from zero. The editable home settings surface MUST continue exposing a visible preview state for the tenant hero area while fidelity is improved.

#### Scenario: Cambio de alcance explícito

- GIVEN the dashboard home settings already render `HomeSettingsPreview`
- WHEN this change is specified or implemented
- THEN acceptance MUST evaluate fidelity and consistency of that existing preview
- AND it MUST NOT describe the feature as creating preview from scratch

### Requirement: Fidelidad por variante del banner

The system MUST render the dashboard preview in a variant-aware way for `banner_variant` values `blurred` and `full`. Each variant MUST preserve representative differences in hero emphasis, overlay treatment, and content hierarchy consistent with the public tenant hero, while allowing reasonable non-pixel-perfect editorial approximation.

#### Scenario: Variante blurred

- GIVEN a tenant configuration with `banner_variant = "blurred"`
- WHEN the dashboard preview is shown
- THEN the preview reflects the more text-forward blurred hero treatment
- AND it remains visually consistent with the public blurred variant

#### Scenario: Variante full

- GIVEN a tenant configuration with `banner_variant = "full"`
- WHEN the dashboard preview is shown
- THEN the preview reflects the more image-forward full hero treatment
- AND it remains visually consistent with the public full variant

### Requirement: Fallback representativo sin ausencia falsa

The system MUST provide a representative hero preview even when no usable banner image is available or a preview image cannot be rendered. Fallback behavior MUST preserve the presence of the hero area with tenant styling and editorial content cues, and MUST NOT create a false impression that no preview exists.

#### Scenario: Tenant sin banner usable

- GIVEN the tenant has no valid banner image configured
- WHEN the dashboard preview is rendered
- THEN a representative fallback hero is still shown
- AND the user can understand the intended banner variant and content hierarchy

#### Scenario: Falla de imagen remota

- GIVEN a banner image source exists but cannot be rendered in preview
- WHEN the preview falls back
- THEN the hero area remains visible with representative styling
- AND the preview does not collapse into an empty or absent state

### Requirement: Paridad editorial razonable con el hero público

The system SHOULD mirror the public tenant hero's editorial structure at a reasonable level, including primary heading, optional supporting copy, and contextual badges or chips when relevant to the selected variant. The preview MAY use representative placeholder data when production content is unavailable, but placeholder use MUST remain consistent with the public hero's intended structure rather than inventing unrelated states.

#### Scenario: Datos editoriales incompletos

- GIVEN some public-facing content is missing or mocked in the editor
- WHEN the dashboard preview is rendered
- THEN the preview may use representative placeholder content
- AND the resulting composition still matches the public hero's intended structure
