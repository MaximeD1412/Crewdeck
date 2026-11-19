import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findGaps, type ProcessDefinition, type ProcessGap, validateDefinition } from '@crewdeck/contracts';
import { findScenario } from './index.js';
import { LOCAL_DRAFT, MANQUES_DRAFT, PROCESS_SCENARIO_PROJECTS } from './process.js';

const FIXTURES = join(import.meta.dirname, '../../../../../packages/contracts/fixtures/process');
const fixture = (name: string) => JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8')) as { definition: ProcessDefinition; gaps: ProcessGap[] };

describe('the scenarios of « Gestion du process »', () => {
  it('draws the Manques of the shared case « gaps-every-kind »: its definition, its five Manques', () => {
    const shared = fixture('gaps-every-kind');
    expect(MANQUES_DRAFT).toEqual(shared.definition);
    expect(findGaps(MANQUES_DRAFT, { ticket: 'github', code: 'github' })).toEqual(shared.gaps);
    expect(shared.gaps).toHaveLength(5);
  });

  it('gives the Local Projet a draft the canvas accepts, without a Manque on its Sources: the Phase « Livraison », the Commande « Lancer »', () => {
    expect(validateDefinition(LOCAL_DRAFT)).toEqual([]);
    expect(findGaps(LOCAL_DRAFT, { ticket: 'local', code: 'local' })).toEqual([]);
    expect(LOCAL_DRAFT.phases.find((phase) => phase.id === 'ph-livraison')).toMatchObject({ name: 'Livraison', forEach: null });
    expect(LOCAL_DRAFT.steps.find((step) => step.id === 'st-lancer')).toMatchObject({ kind: 'command', name: 'Lancer', phaseId: 'ph-livraison' });
  });

  it('opens each on its Projet’s « Gestion du process », the state in its URL', () => {
    const { mairie, recettes, sansVersion } = PROCESS_SCENARIO_PROJECTS;
    expect(
      ['process', 'process-manques', 'process-etape', 'process-sources', 'process-local', 'process-sans-version'].map((name) => findScenario(name)?.path),
    ).toEqual([
      `/projets/${mairie}/process`,
      `/projets/${mairie}/process`,
      `/projets/${mairie}/process?etape=st-review`,
      `/projets/${mairie}/process?onglet=sources`,
      `/projets/${recettes}/process?etape=st-lancer`,
      `/projets/${sansVersion}/process`,
    ]);
  });
});
