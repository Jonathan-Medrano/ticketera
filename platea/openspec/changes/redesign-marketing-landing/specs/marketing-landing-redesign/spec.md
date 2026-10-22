# marketing-landing-redesign Specification

## Purpose

Define the required outcome for the active Platea marketing homepage so it stops mixing legacy composition with newer marketing primitives and becomes the canonical B2B entry point for ticketing and live operations.

## Requirements

### Requirement: Consolidated marketing architecture

The system MUST use the existing marketing primitives and CSS marketing tokens as the structural base of the homepage. Acceptance MUST reject a homepage that keeps the new primitives as disconnected alternatives while the active page continues with duplicated legacy composition.

#### Scenario: Homepage uses the consolidated foundation

- GIVEN the active homepage is reviewed against the available marketing primitives and tokens
- WHEN its main hero, sections, and CTA surfaces are evaluated
- THEN the page is composed from the consolidated marketing architecture
- AND the primitives are not left as unused or secondary-only artifacts

### Requirement: Clear B2B value proposition

The system MUST state within the first viewport that Platea is for businesses running ticket sales and live event operations. The narrative MUST describe selling, managing, and operational control in concrete event-oriented terms and MUST NOT rely on generic SaaS productivity language.

#### Scenario: First-screen message identifies the product category

- GIVEN a first-time visitor lands on the homepage
- WHEN they read the hero headline, support copy, and adjacent cues
- THEN they can infer that Platea is a B2B platform for ticketing and event operations
- AND the message references operational realities rather than abstract innovation claims

### Requirement: Single dominant primary action

The system MUST present one dominant primary CTA across the homepage. Secondary actions MAY exist, but they MUST be visually subordinate, must support the same narrative path, and MUST NOT compete equally with the primary action.

#### Scenario: CTA hierarchy is unmistakable

- GIVEN the homepage exposes more than one CTA
- WHEN prominence, placement, and styling are reviewed
- THEN one action is clearly primary in the hero and reinforced at the closing CTA area
- AND secondary actions remain available without matching the primary emphasis

### Requirement: Valid and coherent navigation targets

Every homepage CTA and support link MUST resolve to an existing, intended destination for the current user state. Acceptance MUST reject broken, placeholder, or contradictory targets, including routes that do not exist.

#### Scenario: Anonymous visitor CTA targets are valid

- GIVEN an anonymous visitor reviews hero and closing actions
- WHEN each CTA and footer/support link target is checked
- THEN every target resolves to an existing route, section, or valid external destination
- AND no CTA points to a missing route such as an undefined demo page

### Requirement: Reduced duplication and narrative confusion

The system MUST remove repeated blocks, repeated CTA systems, and overlapping messages that flatten hierarchy or create uncertainty about the intended next step. Each major section MUST contribute a distinct role in the reading flow.

#### Scenario: Sections have distinct purpose

- GIVEN the homepage is read from hero to footer
- WHEN the sequence of sections and action surfaces is reviewed
- THEN each section advances the story with a unique purpose
- AND duplicated UI patterns or repeated messages do not create confusion about value or action

### Requirement: Responsive and accessible baseline

The system MUST preserve a coherent experience across mobile and desktop layouts. It MUST maintain readable text, visible interactive affordances, basic keyboard accessibility, and sufficient semantic clarity for primary content and actions.

#### Scenario: Responsive hierarchy survives layout changes

- GIVEN the homepage is reviewed on mobile and desktop widths
- WHEN layout, spacing, and CTA order are compared
- THEN the same primary message and CTA hierarchy remain clear in both contexts
- AND no essential content or action becomes hidden, ambiguous, or unusable

#### Scenario: Basic accessibility checks pass

- GIVEN the homepage is reviewed for baseline accessibility
- WHEN headings, buttons, links, and text contrast are inspected
- THEN primary actions are perceivable and operable with standard focus/navigation behavior
- AND the page does not depend only on visual flourish to communicate meaning
