# Safe Theme Provider Mounting Specification

## Purpose

Define how the app mounts the theme provider without triggering the runtime error caused by rendering a script tag inside an invalid React component context.

## Requirements

### Requirement: Theme provider mounts in a safe global location

The system MUST mount the theme provider in a way that avoids rendering its internal script tag from an invalid client component composition.

#### Scenario: App root no longer throws script-render error

- GIVEN the app root renders session and theme providers
- WHEN the page loads in the browser
- THEN the runtime does not throw the script tag error associated with the current provider composition

### Requirement: Theme behavior remains intact after provider move

The system MUST preserve current theme behavior after the provider reorganization.

#### Scenario: Theme provider still controls theme state

- GIVEN the global theme provider has been moved or separated from the session provider
- WHEN the app renders interactive dashboard pages
- THEN theme handling still works
- AND the change does not regress the existing theme configuration behavior
