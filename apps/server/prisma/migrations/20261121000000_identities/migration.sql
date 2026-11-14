-- Identités (ADR 0014, CORE-9): a Pilote signs in by email, Google or
-- GitHub. Expand only (ADR 0009): `github_user_id` and `login` stay, nullable
-- and no longer read nor written; CORE-11's migration drops them, and the
-- two triggers below with them.

-- CreateEnum
CREATE TYPE "identity_provider" AS ENUM ('email', 'google', 'github');

-- AlterTable
ALTER TABLE "pilots" ADD COLUMN "display_name" TEXT,
ALTER COLUMN "github_user_id" DROP NOT NULL,
ALTER COLUMN "login" DROP NOT NULL;

UPDATE "pilots" SET "display_name" = "login";

ALTER TABLE "pilots" ALTER COLUMN "display_name" SET NOT NULL;

-- CreateTable
CREATE TABLE "pilot_identities" (
    "id" UUID NOT NULL,
    "pilot_id" UUID NOT NULL,
    "provider" "identity_provider" NOT NULL,
    "subject" TEXT NOT NULL,
    "email" TEXT,
    "login" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pilot_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_login_tokens" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "next" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "used_at" TIMESTAMPTZ,

    CONSTRAINT "email_login_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pilot_identities_pilot_id_idx" ON "pilot_identities"("pilot_id");

-- CreateIndex
CREATE UNIQUE INDEX "pilot_identities_provider_subject_key" ON "pilot_identities"("provider", "subject");

-- CreateIndex
CREATE UNIQUE INDEX "pilot_identities_pilot_id_provider_key" ON "pilot_identities"("pilot_id", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "email_login_tokens_token_hash_key" ON "email_login_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "email_login_tokens_email_created_at_idx" ON "email_login_tokens"("email", "created_at");

-- AddForeignKey
ALTER TABLE "pilot_identities" ADD CONSTRAINT "pilot_identities_pilot_id_fkey" FOREIGN KEY ("pilot_id") REFERENCES "pilots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Each Pilote's GitHub user becomes their `github` Identité.
INSERT INTO "pilot_identities" ("id", "pilot_id", "provider", "subject", "login", "created_at")
SELECT gen_random_uuid(), "id", 'github', "github_user_id"::text, "login", "created_at" FROM "pilots" WHERE "github_user_id" IS NOT NULL;

-- A rollback runs the version before on this schema (ADR 0009, no migration
-- down): it writes a new Pilote with `github_user_id` and `login` only. Its
-- `display_name` is then its login, and its `github` Identité is written
-- beside it, so that this version finds it once deployed again. This version
-- never writes `github_user_id`: neither trigger acts on its rows.
CREATE FUNCTION "pilots_legacy_display_name"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."display_name" IS NULL THEN
    NEW."display_name" := NEW."login";
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "pilots_legacy_display_name" BEFORE INSERT ON "pilots"
FOR EACH ROW EXECUTE FUNCTION "pilots_legacy_display_name"();

CREATE FUNCTION "pilots_legacy_github_identity"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "pilot_identities" ("id", "pilot_id", "provider", "subject", "login")
  VALUES (gen_random_uuid(), NEW."id", 'github', NEW."github_user_id"::text, NEW."login")
  ON CONFLICT DO NOTHING;
  RETURN NULL;
END;
$$;

CREATE TRIGGER "pilots_legacy_github_identity" AFTER INSERT ON "pilots"
FOR EACH ROW WHEN (NEW."github_user_id" IS NOT NULL) EXECUTE FUNCTION "pilots_legacy_github_identity"();
