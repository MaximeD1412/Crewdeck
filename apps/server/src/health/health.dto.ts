import { zHealth } from '@crewdeck/contracts';
import { createZodDto } from 'nestjs-zod';

export class HealthDto extends createZodDto(zHealth) {}
