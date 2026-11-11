import { zSeq } from '@crewdeck/contracts';
import { Global, Injectable, Module, type OnModuleInit } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants.js';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum.js';
import { APP_INTERCEPTOR, DiscoveryModule, DiscoveryService, MetadataScanner } from '@nestjs/core';
import { z } from 'zod';
import { SENSITIVE_ACTION } from './sensitive-action.decorator.js';
import { SensitiveActionInterceptor } from './sensitive-action.interceptor.js';
import { SensitiveActionsService } from './sensitive-actions.service.js';

interface RouteArg {
  readonly index: number;
  readonly data?: unknown;
}

/** The schema of a handler's whole `@Body()`, from its DTO (`createZodDto`), if it has one. */
const bodySchemaOf = (controller: object, method: string): unknown => {
  const args = (Reflect.getMetadata(ROUTE_ARGS_METADATA, controller.constructor, method) ?? {}) as Record<string, RouteArg>;
  const body = Object.entries(args).find(([key, arg]) => key.startsWith(`${RouteParamtypes.BODY}:`) && arg.data === undefined)?.[1];
  if (!body) return undefined;
  const types = (Reflect.getMetadata('design:paramtypes', controller, method) ?? []) as unknown[];
  return (types[body.index] as { schema?: unknown } | undefined)?.schema;
};

const carriesSeq = (schema: unknown): boolean => schema instanceof z.ZodObject && schema.shape['seq'] === zSeq;

/**
 * At boot, every `@SensitiveAction` route's body must carry the `seq` the
 * Pilote confirmed on (`withSeq` of its contract): the app fails to start
 * otherwise, before any Pilote reaches it.
 */
@Injectable()
export class SensitiveActionsBootCheck implements OnModuleInit {
  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
  ) {}

  onModuleInit(): void {
    const wrong: string[] = [];
    for (const wrapper of this.discovery.getControllers()) {
      const instance = wrapper.instance as object | undefined;
      if (!instance) continue;
      const prototype = Object.getPrototypeOf(instance) as Record<string, unknown>;
      for (const method of this.scanner.getAllMethodNames(prototype)) {
        const handler = prototype[method];
        if (typeof handler !== 'function' || Reflect.getMetadata(SENSITIVE_ACTION, handler) === undefined) continue;
        if (!carriesSeq(bodySchemaOf(prototype, method))) wrong.push(`${instance.constructor.name}.${method}`);
      }
    }
    if (wrong.length > 0) {
      throw new Error(`Actions sensibles ${wrong.join(', ')} : leur corps doit porter le seq confirmé (withSeq)`);
    }
  }
}

/** The Actions sensibles' server side (CORE-7): the freshness check, its interceptor, the boot check of their bodies. */
@Global()
@Module({
  imports: [DiscoveryModule],
  providers: [
    SensitiveActionsService,
    SensitiveActionsBootCheck,
    { provide: APP_INTERCEPTOR, useClass: SensitiveActionInterceptor },
  ],
  exports: [SensitiveActionsService],
})
export class SensitiveActionsModule {}
