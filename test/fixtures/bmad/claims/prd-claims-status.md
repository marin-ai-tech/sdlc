---
title: Claims Status
created: 2026-09-01
updated: 2026-09-10
---

# PRD: Claims Status
*Working title — confirm.*

## 0. Document Purpose
Defines the self-service claim status feature for policyholders.

## 1. Vision
Policyholders call support to learn where their claim is. They should see the status themselves, at any time, in the customer portal.

## 2. Target User
Policyholders with an open claim, and the support agents who answer status calls today.

### 2.1 Jobs To Be Done
- Know what happens next with my claim without calling.

### 2.3 Key User Journeys
- **UJ-1. A policyholder checks the status of an open claim from the portal.**

## 3. Glossary
- **Claim** — A request for payment under a policy.

## 4. Features

### 4.1 Claim status lookup
**Description:** The policyholder opens a claim and sees its current stage. Realizes UJ-1.

**Functional Requirements:**

#### FR-1: Show claim stage

Policyholder can see the current stage of each open claim. Realizes UJ-1.

**Consequences (testable):**
- The portal shows one of: received, in review, approved, paid, rejected.
- A claim owned by another policyholder is never shown.

#### FR-2: Stage change notification

Policyholder can receive an email when the stage of a claim changes.

**Consequences (testable):**
- An email is sent within 5 minutes of a stage change.

## 5. Non-Goals (Explicit)
- Editing a claim from the portal.

## 6. MVP Scope

### 6.1 In Scope
- Status lookup and email notification.

### 6.2 Out of Scope for MVP
- SMS notifications.

## 7. Success Metrics
- **SM-1**: Status calls to support — down 40% within two months. Validates FR-1.

## 8. Open Questions
- Do brokers see their clients' claims?

## 9. Assumptions Index
- Claims already have a machine-readable stage in the claims system.
