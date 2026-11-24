# 2. PostgreSQL through Prisma

## Context

Bookings must never overlap.

## Decision

PostgreSQL, its schema in `prisma/schema.prisma`.

## Consequences

An exclusion constraint keeps two Bookings off one court.
