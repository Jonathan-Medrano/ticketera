# Super Admin Dashboard Specification

## Purpose

Define the main owner dashboard that shows the platform's aggregate commercial performance, owner gains, and global operational visibility across companies.

## Requirements

### Requirement: Global owner metrics dashboard

The system MUST provide a super-admin dashboard with aggregate platform metrics, including owner gains and visual summaries suitable for a main backoffice landing page.

#### Scenario: Super-admin opens the platform dashboard

- GIVEN an authenticated super-admin
- WHEN the super-admin opens the platform dashboard
- THEN the system returns aggregate commercial metrics for the platform
- AND includes owner-facing gain figures rather than tenant-local revenue only

#### Scenario: Dashboard includes chartable time-series data

- GIVEN an authenticated super-admin
- WHEN the platform dashboard data is requested
- THEN the response includes time-series or grouped datasets suitable for graphs
- AND the frontend can render visual summaries without deriving platform totals client-side from raw company rows

### Requirement: Company list visibility from dashboard context

The super-admin dashboard MUST provide visibility into the set of companies managed by the platform, either directly in the main page or through a linked company list section.

#### Scenario: Dashboard exposes companies overview

- GIVEN an authenticated super-admin
- WHEN the dashboard data is requested
- THEN the response includes enough company-level summary information to navigate to the company directory
- AND does not require the owner to impersonate a tenant account to inspect companies
