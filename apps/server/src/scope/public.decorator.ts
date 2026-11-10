import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'crewdeck:public';

/**
 * A route (or every route of a controller) answered without a principal and
 * outside any scope: health, the auth callback, the webhooks, the install
 * script. Anything it touches of a Pilote's data opens that scope itself
 * (`runInPilotScope`).
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC, true);
