import { Injectable } from '@nestjs/common';

/** The time the Runner's presence reads: a test sets `now` to move it (45 s without a heartbeat in no time). */
@Injectable()
export class RunnerClock {
  now: () => Date = () => new Date();
}
