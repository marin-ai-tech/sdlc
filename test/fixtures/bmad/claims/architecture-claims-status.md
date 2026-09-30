---
title: Claims Status
---

# Architecture Spine — Claims Status

## Design Paradigm
Read model fed by claim stage events; the portal reads it through the existing API gateway.

## Invariants & Rules

### AD-1 — Event-driven read model
Claim stage changes are consumed from the claims event stream into a read model; the portal never queries the claims system directly.

### AD-2 — Notifications through the existing mailer
Stage-change emails go through the company mailer service, not a new provider.

## Stack
- TypeScript services on Node 20, PostgreSQL for the read model.

## Deferred
- SMS notifications — after the email channel proves useful.
- Broker access to client claims — waiting for a legal opinion.
