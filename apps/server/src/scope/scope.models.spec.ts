import { getDMMF } from '@prisma/get-dmmf';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type DatamodelShape, GLOBAL_MODELS, unscopedModels } from './scope.models.js';

const schema = readFileSync(join(import.meta.dirname, '../../prisma/schema.prisma'), 'utf8');

const datamodel = (source = schema): DatamodelShape => {
  const dmmf = getDMMF({ datamodel: source });
  if ('reason' in dmmf) throw dmmf.error;
  return dmmf.datamodel;
};

const field = (name: string) => ({ name });

describe('the models walk', () => {
  it('finds every model of schema.prisma global or scoped by a pilotId led index', () => {
    expect(unscopedModels(datamodel())).toEqual([]);
  });

  it('allowlists only models that exist in schema.prisma', () => {
    const names = datamodel().models.map((model) => model.name);

    expect([...GLOBAL_MODELS].filter((name) => !names.includes(name))).toEqual([]);
  });

  it('reads the pilotId led indexes, keys and uniques from Prisma’s DMMF', () => {
    const source = (attribute: string) => `
      datasource db {
        provider = "postgresql"
      }
      model Ticket {
        id        String   @id
        pilotId   String
        createdAt DateTime
        ${attribute}
      }`;

    expect(unscopedModels(datamodel(source('@@index([pilotId, createdAt])')))).toEqual([]);
    expect(unscopedModels(datamodel(source('@@unique([pilotId, id])')))).toEqual([]);
    expect(unscopedModels(datamodel(source('@@index([createdAt, pilotId])')))).toEqual(['Ticket: no index starting with pilotId']);
    expect(unscopedModels(datamodel(source('')))).toEqual(['Ticket: no index starting with pilotId']);
  });

  it('fails on a relation between scoped models whose foreign key does not carry pilotId to pilotId', () => {
    const source = (relation: string) => `
      datasource db {
        provider = "postgresql"
      }
      model Pilot {
        id       String    @id
        comments Comment[]
      }
      model Ticket {
        id       String    @id
        pilotId  String
        comments Comment[]
        @@unique([pilotId, id])
      }
      model Comment {
        id       String @id
        pilotId  String
        ticketId String
        pilot    Pilot  @relation(fields: [pilotId], references: [id])
        ticket   Ticket ${relation}
        @@index([pilotId, ticketId])
      }`;

    expect(unscopedModels(datamodel(source('@relation(fields: [pilotId, ticketId], references: [pilotId, id])')))).toEqual([]);
    expect(unscopedModels(datamodel(source('@relation(fields: [ticketId], references: [id])')))).toEqual([
      'Comment.ticket: relation to the scoped Ticket without pilotId in its foreign key',
    ]);
    expect(unscopedModels(datamodel(source('@relation(fields: [ticketId, pilotId], references: [pilotId, id])')))).toEqual([
      'Comment.ticket: relation to the scoped Ticket without pilotId in its foreign key',
    ]);
  });

  it('fails on an implicit many-to-many between scoped models, and passes its explicit join model', () => {
    const source = (relations: string) => `
      datasource db {
        provider = "postgresql"
      }
      model Ticket {
        id      String @id
        pilotId String
        ${relations.includes('TicketLabel') ? 'links TicketLabel[]' : 'labels Label[]'}
        @@unique([pilotId, id])
      }
      model Label {
        id      String @id
        pilotId String
        ${relations.includes('TicketLabel') ? 'links TicketLabel[]' : 'tickets Ticket[]'}
        @@unique([pilotId, id])
      }
      ${relations}`;
    const joinModel = `
      model TicketLabel {
        pilotId  String
        ticketId String
        labelId  String
        ticket   Ticket @relation(fields: [pilotId, ticketId], references: [pilotId, id])
        label    Label  @relation(fields: [pilotId, labelId], references: [pilotId, id])
        @@id([pilotId, ticketId, labelId])
      }`;

    expect(unscopedModels(datamodel(source('')))).toEqual([
      'Ticket.labels: implicit many-to-many relation to the scoped Label, its join table has no pilotId: write an explicit join model',
      'Label.tickets: implicit many-to-many relation to the scoped Ticket, its join table has no pilotId: write an explicit join model',
    ]);
    expect(unscopedModels(datamodel(source(joinModel)))).toEqual([]);
    expect(
      unscopedModels(
        datamodel(`
          datasource db {
            provider = "postgresql"
          }
          model Ticket {
            id        String   @id
            pilotId   String
            blocks    Ticket[] @relation("blocking")
            blockedBy Ticket[] @relation("blocking")
            @@unique([pilotId, id])
          }`),
      ),
    ).toEqual([
      'Ticket.blocks: implicit many-to-many relation to the scoped Ticket, its join table has no pilotId: write an explicit join model',
      'Ticket.blockedBy: implicit many-to-many relation to the scoped Ticket, its join table has no pilotId: write an explicit join model',
    ]);
  });

  describe('on a hand-built DMMF', () => {
    const fixture: DatamodelShape = {
      models: [
        { name: 'Pilot', fields: [field('id'), field('login')] },
        { name: 'Ticket', fields: [field('id'), field('pilotId'), field('createdAt')] },
        { name: 'Session', fields: [field('pilotId'), field('id')] },
        { name: 'Orphan', fields: [field('id'), field('title')] },
        { name: 'Unindexed', fields: [field('id'), field('pilotId')] },
        { name: 'Trailing', fields: [field('id'), field('pilotId'), field('createdAt')] },
      ],
      indexes: [
        { model: 'Pilot', fields: [field('id')] },
        { model: 'Ticket', fields: [field('pilotId'), field('createdAt')] },
        { model: 'Session', fields: [field('pilotId'), field('id')] },
        { model: 'Unindexed', fields: [field('id')] },
        { model: 'Trailing', fields: [field('createdAt'), field('pilotId')] },
      ],
    };

    it('fails on a model without pilotId that is not allowlisted, and on one whose index does not start with pilotId', () => {
      expect(unscopedModels(fixture)).toEqual([
        'Orphan: no pilotId field',
        'Unindexed: no index starting with pilotId',
        'Trailing: no index starting with pilotId',
      ]);
    });

    it('passes an allowlisted model without pilotId', () => {
      expect(unscopedModels(fixture, new Set(['Pilot', 'Orphan', 'Unindexed', 'Trailing']))).toEqual([]);
    });
  });
});
