/**
 * The labels the Process reads on a Dépôt GitHub whose Tickets are on GitHub
 * (PROJET-3): readiness checks each is there, its fix creates those missing.
 * A repository lacking them is a point of preparation, never a Manque.
 */
export interface ProcessLabel {
  readonly name: string;
  /** Six hex digits, without `#`, as GitHub takes it. */
  readonly color: string;
  readonly description: string;
}

export const PROCESS_LABELS: readonly ProcessLabel[] = [
  { name: 'ready-for-agent', color: '1d76db', description: 'Prêt pour un agent : la Boucle peut le prendre' },
  { name: 'needs-human', color: 'd93f0b', description: 'Attend le Pilote : une Boucle ne le prend pas' },
  { name: 'revue-visuelle', color: 'fbca04', description: 'Le merge attend la revue visuelle du Pilote' },
  { name: 'type:feature', color: '0e8a16', description: 'Une fonctionnalité' },
  { name: 'type:fix', color: 'd73a4a', description: 'Une correction' },
  { name: 'type:chore', color: 'c5def5', description: 'De l’entretien' },
  { name: 'type:spike', color: 'fbca04', description: 'Une exploration, sans code de production' },
  { name: 'type:externe', color: 'd4c5f9', description: 'Demande une action hors du dépôt' },
  { name: 'blocked:externe', color: 'b60205', description: 'Bloqué par une action hors du dépôt' },
  { name: 'priority:P0', color: 'ededed', description: 'Priorité P0' },
  { name: 'priority:P1', color: 'ededed', description: 'Priorité P1' },
  { name: 'priority:P2', color: 'ededed', description: 'Priorité P2' },
  { name: 'size:S', color: 'ededed', description: 'Taille S' },
  { name: 'size:M', color: 'ededed', description: 'Taille M' },
  { name: 'size:L', color: 'ededed', description: 'Taille L' },
];
