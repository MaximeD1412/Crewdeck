-- AlterTable
ALTER TABLE "events" ADD COLUMN     "source" TEXT;

-- CreateTable
CREATE TABLE "latency_samples" (
    "id" UUID NOT NULL,
    "pilot_id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "delay_ms" INTEGER NOT NULL,
    "at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "latency_samples_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "latency_samples_pilot_id_at_idx" ON "latency_samples"("pilot_id", "at");

-- CreateIndex
CREATE INDEX "latency_samples_at_idx" ON "latency_samples"("at");

-- AddForeignKey
ALTER TABLE "latency_samples" ADD CONSTRAINT "latency_samples_pilot_id_fkey" FOREIGN KEY ("pilot_id") REFERENCES "pilots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

