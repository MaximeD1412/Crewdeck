# 2. PostgreSQL through Prisma

> **Status:** accepted, recorded from the code, 2026-11-24.

## Context

Bookings must never overlap.

## Decision

PostgreSQL, its schema in `prisma/schema.prisma`.

## Consequences

An exclusion constraint keeps two Bookings off one court.
