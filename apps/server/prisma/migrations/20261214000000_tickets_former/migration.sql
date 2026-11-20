-- SOURCE-8: a Ticket's number and Source before a migration moved it, shown « ex-#12 ».
ALTER TABLE "tickets" ADD COLUMN     "former_number" INTEGER,
ADD COLUMN     "former_source" "ticket_source";

-- A row a migration just moved has no title until its new Source fills it (the
-- reconciliation to GitHub, the Runner's scan to Local): neither readable nor sealed.
ALTER TABLE "tickets" DROP CONSTRAINT "tickets_title_by_source";
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_title_by_source" CHECK (
  ("source" = 'github' AND "title" IS NOT NULL AND "title_sealed" IS NULL AND "labels_sealed" IS NULL)
  OR ("source" = 'local' AND "title" IS NULL AND "title_sealed" IS NOT NULL)
  OR ("former_source" IS NOT NULL AND "former_source" <> "source" AND "title" IS NULL AND "title_sealed" IS NULL AND "labels_sealed" IS NULL)
);
ALTER TABLE "milestones" DROP CONSTRAINT "milestones_title_by_source";
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_title_by_source" CHECK (
  ("source" = 'github' AND "title" IS NOT NULL AND "title_sealed" IS NULL)
  OR ("source" = 'local' AND "title" IS NULL AND "title_sealed" IS NOT NULL)
  OR ("title" IS NULL AND "title_sealed" IS NULL)
);
