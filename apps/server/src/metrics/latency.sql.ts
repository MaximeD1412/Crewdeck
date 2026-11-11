import type { PrismaService } from '../prisma/prisma.service.js';

/**
 * The 95th percentile of the delays `pilotId` measured since `since`, and how
 * many: `percentile_cont(0.95)`, which no Prisma query expresses. Raw SQL on
 * `prisma.unscoped` (ESLint allows this file), filtered by `pilotId` here:
 * `LatencyService.p95` checks it is the scope's.
 */
export const latencyP95 = async (prisma: PrismaService, pilotId: string, since: Date): Promise<{ p95Ms: number | null; count: number }> => {
  const [row] = await prisma.unscoped.$queryRaw<{ p95: number | null; count: number }[]>`
    SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY delay_ms) AS p95, count(*)::int AS count
    FROM latency_samples
    WHERE pilot_id = ${pilotId}::uuid AND at >= ${since}`;
  return { p95Ms: row?.p95 === null || row?.p95 === undefined ? null : Math.round(row.p95), count: row?.count ?? 0 };
};
