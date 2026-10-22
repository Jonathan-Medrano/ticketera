# Internal Auth Ambiguity Prevention Specification

## Purpose

Define how internal login and password recovery remain unambiguous once internal emails are globally unique.

## Requirements

### Requirement: Internal login resolves a single actor

The system MUST keep internal login unambiguous by ensuring one internal email maps to at most one internal actor.

#### Scenario: Employee login stays unambiguous

- GIVEN an employee email is globally unique among internal actors
- WHEN that employee logs in through the general internal login flow
- THEN the system resolves exactly one internal actor
- AND the login does not depend on hidden tenant guessing to break ties

#### Scenario: Company login stays unambiguous

- GIVEN a company email is globally unique among internal actors
- WHEN that company logs in through the general internal login flow
- THEN the system resolves exactly one internal actor

### Requirement: Internal password reset resolves a single actor

Internal password reset MUST continue to resolve a single actor from email without ambiguity across empresa, employee, and super-admin identities.

#### Scenario: Employee password reset resolves one employee only

- GIVEN an employee requests password recovery with an internal email
- WHEN the system resolves the actor for reset
- THEN the resolution points to exactly one internal actor
- AND no competing internal identity shares that same email

#### Scenario: Company password reset rejects collision-prone data model

- GIVEN the platform is enforcing global uniqueness for internal emails
- WHEN a company password reset is requested
- THEN the system can safely resolve the company actor by email alone
- AND the request is not ambiguous with employee or super-admin identities
