# Inventory

- [0001 Next.js for the web app](adr/0001-web-framework.md)
- [0002 PostgreSQL through Prisma](adr/0002-database.md)

## Apps

- `apps/web`: the club's pages and the booking.

## Routes and screens

- `/`: the courts of the day.
- `/reserver/:court`: booking a court.

## Tests and CI

- Vitest beside the code, `pnpm test`.
- GitHub Actions: `.github/workflows/ci.yml`, lint and tests on each PR.
