import { type SensitiveActionId, zSensitiveActionId } from '@crewdeck/contracts';
import { SetMetadata } from '@nestjs/common';

/** The metadata key of `@SensitiveAction(id)`. */
export const SENSITIVE_ACTION = Symbol('SENSITIVE_ACTION');

/**
 * Marks the route of an Action sensible (CORE-7): its body must carry the
 * `seq` the Pilote confirmed on (`withSeq`), else the app fails at boot; its
 * handler must call `SensitiveActionsService.assertFresh`, else it answers
 * 500 outside production; its success is logged with its Pilote and resource.
 */
export const SensitiveAction = (id: SensitiveActionId): MethodDecorator => {
  if (!zSensitiveActionId.safeParse(id).success) throw new Error(`Action sensible ${String(id)} inconnue`);
  return SetMetadata(SENSITIVE_ACTION, id);
};
