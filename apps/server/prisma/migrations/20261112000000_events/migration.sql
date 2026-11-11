-- CreateTable
CREATE TABLE "events" (
    "pilot_id" UUID NOT NULL,
    "seq" BIGINT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source_at" TIMESTAMPTZ,

    CONSTRAINT "events_pkey" PRIMARY KEY ("pilot_id","seq")
);

-- CreateIndex
CREATE INDEX "events_at_idx" ON "events"("at");

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_pilot_id_fkey" FOREIGN KEY ("pilot_id") REFERENCES "pilots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
