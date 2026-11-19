import { Module } from '@nestjs/common';
import { RunnerTokens } from '../auth/runner-tokens.js';
import { DevicesModule } from '../devices/devices.module.js';
import { RunnerTokenGuard } from '../devices/runner-token.guard.js';
import { RunnersModule } from '../runners/runners.module.js';
import { DeviceRevocationController, RunnerVaultController, VaultController, VaultStateContributor } from './vault.controller.js';
import { VaultItemsRegistry } from './vault-items.js';
import { VaultService } from './vault.service.js';

/**
 * The revocation of an Appareil and the rotation of the vault key (ADR 0003,
 * E2E-4): `POST /api/devices/:id/revoke`, `/api/vault` for a trusted
 * Appareil, `/api/runner/vault` for the Runner, the `vault` slice.
 */
@Module({
  imports: [DevicesModule, RunnersModule],
  controllers: [DeviceRevocationController, VaultController, RunnerVaultController],
  providers: [VaultService, VaultItemsRegistry, VaultStateContributor, RunnerTokens, RunnerTokenGuard],
  exports: [VaultItemsRegistry],
})
export class VaultModule {}
