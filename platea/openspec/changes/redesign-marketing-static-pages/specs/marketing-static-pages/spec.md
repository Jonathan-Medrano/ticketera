# marketing-static-pages Specification

## Purpose

Define the required behavior for the public marketing static pages so Términos, Privacidad, Soporte y Contacto feel like part of the same marketing experience, remain readable and accessible, and do not break tenant-specific support behavior.

## Requirements

### Requirement: Shared static-page shell

The system MUST render `/terminos`, `/privacidad`, `/soporte`, and `/contacto` with a shared marketing shell. That shell MUST preserve the active marketing visual language, page-width rhythm, heading hierarchy, and stable navigation back to the marketing site.

#### Scenario: Marketing pages share one visual structure

- GIVEN an anonymous visitor opens any of the four static routes
- WHEN layout, spacing, and top-level navigation are reviewed
- THEN each page uses the same static-page shell and marketing styling baseline
- AND none of the pages renders as a placeholder or isolated non-marketing layout

#### Scenario: Static pages remain usable on mobile and desktop

- GIVEN the same static page is reviewed on narrow and wide viewports
- WHEN content blocks and actions are compared
- THEN reading order stays intact and primary actions remain visible without horizontal scrolling

### Requirement: Readable legal content

The system MUST present `/terminos` and `/privacidad` as scannable legal documents. Each page MUST expose a clear title, last-updated context, sectioned content with semantic headings, and paragraph/list formatting that improves comprehension over a flat text wall.

#### Scenario: Legal content is easy to scan

- GIVEN a visitor opens `/terminos` or `/privacidad`
- WHEN they inspect the document structure
- THEN they find a single page title and multiple clearly labeled sections
- AND long-form text is broken into readable paragraphs or lists

#### Scenario: Legal routes are distinct and complete

- GIVEN both legal routes are visited
- WHEN their content is reviewed
- THEN each route covers its own topic with complete page content
- AND neither route reuses irrelevant support or contact copy as a substitute

### Requirement: Public support page with clear contact routes

The system MUST make `/soporte` a public help surface for non-tenant visitors. It MUST clearly distinguish platform support from organizer responsibility, MUST expose concrete contact routes, and MUST make expected response guidance understandable before the user reaches out.

#### Scenario: Buyer and company paths are differentiated

- GIVEN a visitor opens `/soporte`
- WHEN they review the available help guidance
- THEN the page explains when to contact the event organizer and when to contact Platea
- AND the distinction is visible without relying on hidden FAQ content

#### Scenario: Support routes are actionable

- GIVEN the support page exposes contact options
- WHEN a visitor activates them
- THEN each option leads to a real destination such as email, messaging, or a valid internal route
- AND no contact action points to missing, fake, or placeholder behavior

### Requirement: Contact page with meaningful contact surface

The system MUST render `/contacto` as a real contact page. It MUST provide a meaningful way to initiate commercial or general inquiries and MUST give enough context for a visitor to understand what kind of message belongs there.

#### Scenario: Contact page is not a stub

- GIVEN a visitor opens `/contacto`
- WHEN the page is evaluated
- THEN it contains real contact content and at least one actionable inquiry surface
- AND it does not render placeholder text or an empty greeting-only page

#### Scenario: Contact intent is explicit

- GIVEN a visitor wants to write about sales, partnerships, or general questions
- WHEN they read the contact page
- THEN they can identify the intended inquiry path before submitting or leaving the page

### Requirement: Tenant support isolation preserved

The system MUST preserve tenant-aware support behavior. Public marketing support changes MUST NOT replace, intercept, or regress the existing tenant-host support experience served for tenant contexts.

#### Scenario: Tenant host keeps tenant support page

- GIVEN a request resolves to a tenant host context
- WHEN `/soporte` is opened
- THEN the tenant-specific support experience is rendered
- AND the public marketing support page is not shown in its place

#### Scenario: Public contact pages do not alter tenant legal/support routing

- GIVEN tenant routes for `/soporte`, `/terminos`, or `/privacidad` are exercised in tenant context
- WHEN the new marketing static pages are introduced
- THEN tenant route behavior remains intact
- AND no tenant flow is redirected to generic marketing contact content

### Requirement: Accessibility baseline

The system MUST provide an accessibility baseline across all four pages. Content MUST use semantic headings and landmarks, interactive elements MUST have discernible labels, and keyboard users MUST be able to reach primary actions and links.

#### Scenario: Static pages support keyboard and semantic navigation

- GIVEN a keyboard or assistive-technology user visits any static page
- WHEN headings, links, buttons, and form controls are inspected
- THEN the page exposes semantic structure and labeled interactions
- AND primary navigation and contact actions are operable without pointer-only interaction
