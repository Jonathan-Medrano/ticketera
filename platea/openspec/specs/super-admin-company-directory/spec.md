# Super Admin Company Directory Specification

## Purpose

Define how the platform owner lists companies, reviews company-specific gains, and inspects commercial data per company from the global console.

## Requirements

### Requirement: Platform company directory

The system MUST provide a super-admin-only company directory listing the companies managed by the platform with enough summary data to identify their operational and commercial status.

#### Scenario: Super-admin lists companies

- GIVEN an authenticated super-admin
- WHEN the company directory is requested
- THEN the response contains platform-visible company rows
- AND each row includes stable identifiers and commercial summary fields suitable for table display

### Requirement: Company gains modal data

The system MUST allow the super-admin to open a company-specific gain detail view from the directory without entering that company's tenant dashboard.

#### Scenario: Super-admin opens company gains modal

- GIVEN an authenticated super-admin viewing the company directory
- WHEN the super-admin requests gains for one specific company
- THEN the system returns company-specific gain detail for modal presentation
- AND the data is scoped to that company without requiring tenant impersonation

#### Scenario: Gains modal shows owner-oriented values

- GIVEN a company has platform fees associated to its sales
- WHEN the gains modal data is requested
- THEN the response includes owner gain figures for that company
- AND those figures are distinguishable from the company's gross sales totals
