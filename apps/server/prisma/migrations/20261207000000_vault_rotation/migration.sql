-- E2E-4: the revocation of a key holder and the rotation of the vault key.
ALTER TABLE "pilots"
  ADD COLUMN "vault_rotation_pending" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "vault_last_seq" BIGINT NOT NULL DEFAULT 0;

ALTER TABLE "devices" ADD COLUMN "last_seq" BIGINT NOT NULL DEFAULT 0;

-- A Process version stays immutable, except the item key of its `sealed`
-- that a rotation rewraps: the same ciphertext, every other column the same.
CREATE OR REPLACE FUNCTION "process_versions_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."sealed" IS NOT NULL AND NEW."sealed" IS NOT NULL
     AND (NEW."sealed" - 'key') = (OLD."sealed" - 'key')
     AND (to_jsonb(NEW) - 'sealed') = (to_jsonb(OLD) - 'sealed') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'process_versions rows are immutable: write the next version instead (ADR 0011)';
END;
$$;
