import { Injectable } from '@nestjs/common';

/** The heartbeat of `/api/ws`: the page pings every 25 s, a socket silent `silenceMs` is closed (a test shortens it). */
@Injectable()
export class RealtimeTiming {
  silenceMs = 60_000;
}
