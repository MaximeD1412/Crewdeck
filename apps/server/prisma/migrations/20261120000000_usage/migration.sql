-- CreateEnum
CREATE TYPE "usage_window_id" AS ENUM ('five-hour', 'week');

-- CreateTable
CREATE TABLE "usage_measures" (
    "id" UUID NOT NULL,
    "pilot_id" UUID NOT NULL,
    "engine" "engine_id" NOT NULL,
    "window" "usage_window_id" NOT NULL,
    "used_percent" DOUBLE PRECISION NOT NULL,
    "resets_at" TIMESTAMPTZ NOT NULL,
    "measured_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "usage_measures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spends" (
    "id" UUID NOT NULL,
    "pilot_id" UUID NOT NULL,
    "engine" "engine_id" NOT NULL,
    "project_id" UUID,
    "session_id" UUID,
    "step_run_id" UUID,
    "day" DATE NOT NULL,
    "cost_usd_micros" BIGINT NOT NULL,
    "cost_eur_cents" BIGINT,
    "measured_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "spends_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fx_rates" (
    "day" DATE NOT NULL,
    "usd_per_eur" DECIMAL(12,6) NOT NULL,
    "fetched_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "fx_rates_pkey" PRIMARY KEY ("day")
);

-- CreateIndex
CREATE INDEX "usage_measures_pilot_id_engine_window_measured_at_idx" ON "usage_measures"("pilot_id", "engine", "window", "measured_at");

-- CreateIndex
CREATE INDEX "usage_measures_measured_at_idx" ON "usage_measures"("measured_at");

-- CreateIndex
CREATE INDEX "spends_pilot_id_engine_day_idx" ON "spends"("pilot_id", "engine", "day");

-- AddForeignKey
ALTER TABLE "usage_measures" ADD CONSTRAINT "usage_measures_pilot_id_fkey" FOREIGN KEY ("pilot_id") REFERENCES "pilots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spends" ADD CONSTRAINT "spends_pilot_id_fkey" FOREIGN KEY ("pilot_id") REFERENCES "pilots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

