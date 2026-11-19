import { aToi, aToiVide } from './a-toi.js';
import { aToiProcess } from './a-toi-process.js';
import { blank } from './blank.js';
import {
  composants,
  composantsDialog,
  composantsFigures,
  composantsProcess,
  composantsProcessList,
  composantsRows,
  composantsSession,
  composantsSettingRow,
  composantsTextField,
  confirmDialog,
} from './composants.js';
import { connexion, connexionErreur, connexionGoogleNonVerifiee, connexionLien, connexionLienEnvoye } from './connexion.js';
import { demarrage, demarrageComptesIa, demarrageComptesIaAucun, demarrageLiaisonEchouee, demarrageRunnerRelie } from './demarrage.js';
import { appareilAApprouver, appareilAApprouverCode, appareils, appareilsAjouter } from './devices.js';
import type { Scenario } from './define.js';
import { idees, ideesNouvelle, ideesVide } from './idees.js';
import { menuPlus } from './menu-plus.js';
import { demarrageProjets, demarrageProjetsSansGithub, projets, projetsVide } from './projets.js';
import { parametres } from './parametres.js';
import { parametresProjet } from './parametres-projet.js';
import { processScenarios } from './process.js';
import { resynchronisation } from './resynchronisation.js';
import { runner, runnerServeursMcp } from './runner.js';
import { aToiRunnerHorsLigne, runnerHorsLigne } from './runner-offline.js';
import { session, sessionArretee, sessionPermission, sessionQuestion, sessionRunnerHorsLigne } from './session.js';
import { smoke } from './smoke.js';

export { defineScenario, type Scenario, type ScenarioContext, type ScenarioSeed } from './define.js';

/** Every scenario, by name: a screen ticket adds its own here. */
const SCENARIOS: readonly Scenario[] = [
  appareilAApprouver,
  appareilAApprouverCode,
  appareils,
  appareilsAjouter,
  aToi,
  aToiVide,
  aToiProcess,
  aToiRunnerHorsLigne,
  aToiVide,
  blank,
  composants,
  connexion,
  connexionErreur,
  connexionGoogleNonVerifiee,
  connexionLien,
  connexionLienEnvoye,
  demarrage,
  demarrageLiaisonEchouee,
  demarrageRunnerRelie,
  demarrageComptesIa,
  demarrageComptesIaAucun,
  demarrageProjets,
  demarrageProjetsSansGithub,
  idees,
  ideesNouvelle,
  ideesVide,
  menuPlus,
  parametres,
  parametresProjet,
  projets,
  projetsVide,
  resynchronisation,
  runner,
  runnerHorsLigne,
  runnerServeursMcp,
  session,
  sessionArretee,
  sessionQuestion,
  sessionPermission,
  sessionRunnerHorsLigne,
  smoke,
  ...composantsRows,
  composantsTextField,
  composantsSettingRow,
  composantsDialog,
  confirmDialog,
  ...composantsFigures,
  ...composantsSession,
  ...composantsProcess,
  ...composantsProcessList,
  ...processScenarios,
];

const byName = new Map(SCENARIOS.map((scenario) => [scenario.name, scenario]));

export const findScenario = (name: string): Scenario | undefined => byName.get(name);
