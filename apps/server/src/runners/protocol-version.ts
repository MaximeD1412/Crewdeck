import { PROTOCOL_VERSION } from '@crewdeck/contracts';
import { Injectable } from '@nestjs/common';

/**
 * The Runner protocol this server speaks (ADR 0004): `PROTOCOL_VERSION`, and
 * the one before it accepted too. A test sets `version` to try the window
 * at a version that has one before (1 has none).
 */
@Injectable()
export class RunnerProtocol {
  version = PROTOCOL_VERSION;

  /** The oldest protocol a Runner may speak: the server's, or the one before. */
  get oldest(): number {
    return this.version - 1;
  }
}
