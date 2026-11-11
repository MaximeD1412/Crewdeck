import { Global, Module } from '@nestjs/common';
import { ReconcileHooks, Reconciliation } from './reconciliation.service.js';

/** The 15-min reconciliation (ADR 0002): a module registers its hook with `ReconcileHooks`. */
@Global()
@Module({ providers: [ReconcileHooks, Reconciliation], exports: [ReconcileHooks] })
export class ReconciliationModule {}
