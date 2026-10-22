# Global Internal Email Uniqueness Specification

## Purpose

Define the rule that internal actor emails are globally unique across the platform so authentication and recovery flows remain unambiguous.

## Requirements

### Requirement: Global uniqueness for internal identities

The system MUST treat the email address of internal actors as globally unique across all internal identity types. An internal email MUST NOT be assigned to more than one empresa account, employee account, or super-admin account.

#### Scenario: Company registration rejects an employee email already in use

- GIVEN an employee account already exists with a specific email
- WHEN a new company attempts to register using that same email
- THEN the registration is rejected
- AND the system returns a stable conflict error

#### Scenario: Employee creation rejects a company email already in use

- GIVEN a company account already exists with a specific email
- WHEN an internal user attempts to create an employee using that same email
- THEN the creation is rejected
- AND the system returns a stable conflict error

#### Scenario: Super-admin email cannot be reused by internal actors

- GIVEN a super-admin account already exists with a specific email
- WHEN a company or employee tries to use that same email
- THEN the operation is rejected

### Requirement: Internal identity updates preserve uniqueness

The system MUST enforce the same global uniqueness rule when internal actor emails are edited after creation.

#### Scenario: Employee update rejects email already taken by another internal actor

- GIVEN an employee account is being edited
- AND the target email already belongs to another internal actor
- WHEN the update is submitted
- THEN the update is rejected
- AND the original employee email remains unchanged

### Requirement: Buyers remain tenant-scoped

The system MUST NOT apply this global uniqueness rule to buyer accounts if buyer authentication continues to be tenant-scoped.

#### Scenario: Buyer email does not block internal actor uniqueness decision

- GIVEN a buyer account exists with a given email in one tenant
- WHEN an internal actor is created with the same email
- THEN the operation follows the internal-identity uniqueness rules only
- AND buyer tenancy rules remain unchanged
