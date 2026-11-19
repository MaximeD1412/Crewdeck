-- Contract (ADR 0009, CORE-11): `github_user_id` and `login` are no longer
-- read nor written since CORE-9's release (the `github` Identité holds them),
-- so the version before this one never needs them. Ships only after a release
-- with CORE-9. The three triggers that kept them in step go first.

-- DropTrigger
DROP TRIGGER "pilots_legacy_github_columns" ON "pilot_identities";
DROP TRIGGER "pilots_legacy_github_identity" ON "pilots";
DROP TRIGGER "pilots_legacy_display_name" ON "pilots";

-- DropFunction
DROP FUNCTION "pilots_legacy_github_columns"();
DROP FUNCTION "pilots_legacy_github_identity"();
DROP FUNCTION "pilots_legacy_display_name"();

-- DropIndex
DROP INDEX "pilots_github_user_id_key";

-- AlterTable
ALTER TABLE "pilots" DROP COLUMN "github_user_id",
DROP COLUMN "login";
