import { Injectable } from '@nestjs/common';

/** The time the Appareils read (`lastSeenAt`, `approvedAt`): a test sets `now` to move it. */
@Injectable()
export class DeviceClock {
  now: () => Date = () => new Date();
}
