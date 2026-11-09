# Crewdeck — Analyse concurrentielle, abonnements IA et implications de conception

**Document destiné à l'agent de conception**  
**Date de vérification : 8 novembre 2026**  
**Statut : note d'analyse et questions ouvertes — aucune décision d'implémentation automatique**  
**Complète :** le brief sur l'intégration Claude Agent SDK / Codex App Server.

---

## 1. Pourquoi cette note existe

De nouvelles recherches montrent que **plusieurs produits commerciaux proches de Crewdeck existent déjà** et utilisent les agents de code avec les **abonnements ou clés API propres à leurs utilisateurs**. Le cas **Conductor** est particulièrement instructif : l'éditeur a publiquement décrit son utilisation de Claude Agent SDK avec les abonnements Claude et a intégré **Sign in with ChatGPT** avec OpenAI.

Il faut tirer les bonnes conclusions :

1. **La faisabilité produit et l'existence d'un marché sont corroborées par des précédents réels.**
2. **La conformité commerciale n'est pas automatiquement transmissible de ces concurrents à Crewdeck.** Une offre publiée ne prouve pas une autorisation contractuelle ; un partenariat peut être spécifique à un éditeur.
3. **La différenciation de Crewdeck ne peut plus reposer uniquement sur « une interface pour Claude Code + Codex » ou « un Runner local ».**
4. **Il faut auditer notre intégration effective**, particulièrement l'authentification du Claude Agent SDK et le futur usage de Codex App Server.

**Mission de l'agent de conception :** analyser les conséquences pour l'architecture existante, le Process et le futur modèle économique, vérifier les faits au moyen des sources officielles, puis proposer des options hiérarchisées avec leurs risques. **Ne pas modifier le code à ce stade.**

## 2. Rappel du produit et de l'objectif non négociable

**Crewdeck** est une application web où un **Pilote** orchestre ses **Projets** GitHub de l'**Idée** à la PR mergée selon le **Process** : **Idée → Conception → Tickets → Boucle**. Les **Décisions** sont regroupées dans « À toi ». Un **Runner** installé sur la machine du Pilote exécute localement les agents. Un **Skin** personnalisable affiche l'état et invoque les actions autorisées ; les **Actions sensibles** restent confirmées par le produit lui-même.

Cible d'intégration :

- Le Pilote connecte **ses propres comptes Claude et/ou ChatGPT/Codex**, ou à défaut ses propres clés API.
- Les conversations **Claude Code** et **Codex** sont visibles et pilotables **dans Crewdeck**, sans imposer un terminal externe.
- Le Pilote choisit **le fournisseur et le modèle par rôle** : analyse de l'Idée, Conception, Code, Review (et éventuellement autres rôles ultérieurs).
- La **Boucle** orchestre les Tickets sur le Runner, avec consentement préalable pour l'exécution automatisée, capacité d'interruption et validations humaines.
- Crewdeck facture **son logiciel et son orchestration**, sans mutualiser ni revendre les quotas personnels des Pilotes.
- Le Runner conserve localement l'authentification des fournisseurs et les accès au système de fichiers ; le backend Crewdeck ne doit pas devenir un relais de jetons IA.

**Précision sur l'existant :** l'intégration Claude est désormais du **cas B** évoqué précédemment : **Claude Agent SDK** embarqué/piloté par l'application, avec consommation de l'abonnement Claude personnel du fondateur. **Le fait que cet usage personnel fonctionne ne valide pas automatiquement une distribution commerciale.**

---

## 3. Concurrents pertinents — faits confirmés et limites

### 3.1 Conductor : le précédent central

**Sources éditeur et fournisseur :**
- [Conductor — Claude subscription update, 15 juin 2026](https://www.conductor.build/blog/claude-subscription-update)
- [Conductor — Sign in with ChatGPT (changelog)](https://www.conductor.build/changelog/0.89.0-sign-in-with-chatgpt)
- [OpenAI — partenaires Sign in with ChatGPT](https://learn.chatgpt.com/docs/sign-in-with-chatgpt)
- [Conductor — annonce de rapprochement avec Meta et calendrier](https://www.conductor.build/announcement)
- [Conductor — documentation Codex](https://www.conductor.build/docs/reference/harnesses/codex)

**Ce qui est documenté :**

- Conductor gérait des agents de développement, leurs espaces de travail, leurs conversations et leur relation avec Git/PR.
- Conductor indique expressément utiliser le **Claude Code natif à travers le Claude Agent SDK** et que la suspension, le 15 juin 2026, des changements de politique d'Anthropic permettait alors de continuer à utiliser les **quotas d'abonnement Claude** dans Conductor.
- Conductor a officiellement communiqué sur son **partenariat avec OpenAI** pour **Sign in with ChatGPT** et l'usage du forfait ChatGPT dans Codex ; OpenAI répertorie Conductor parmi les applications partenaires.
- **4 novembre 2026 :** annonce de l'arrivée de Conductor chez **Meta**, fermeture aux nouvelles inscriptions/téléchargements ; **13 novembre :** Conductor Cloud doit passer en lecture seule ; **20 novembre :** arrêt prévu de Conductor Cloud ; la version locale doit continuer temporairement avec un retrait progressif au début de **2027**. Ce sont les échéances annoncées, pas des événements tous déjà réalisés au 8 novembre.

**Ce que cela démontre pour Crewdeck :**

- **Précédent technique réel :** Agent SDK + abonnement Claude a existé chez un éditeur de produit commercial ; l'architecture recherchée n'est pas isolée.
- **Précédent commercial OpenAI vérifiable :** l'accès au forfait via un produit tiers est possible via l'intégration/accord adéquat.
- **Cela ne prouve pas** que Crewdeck peut répliquer le mode Claude à l'identique au regard des restrictions actuelles ; ni qu'un accès SIWC sera automatiquement attribué à Crewdeck.
- Le rapprochement avec Meta témoigne d'un intérêt stratégique pour la catégorie, **pas** d'une preuve de rentabilité d'un nouveau SaaS indépendant.

**Questions pour l'agent :**
1. Dans quel détail notre architecture Claude Agent SDK ressemble-t-elle à celle décrite par Conductor ? Quels écarts sont importants (processus binaire, authentification, interception des sessions, backend, hébergement, stockage) ?
2. Peut-on reproduire la qualité de l'expérience de Conductor sans en copier les hypothèses de conformité ?
3. Quelles fonctionnalités de Conductor recoupent déjà la Boucle, le suivi de PR et les reviews de Crewdeck ?

### 3.2 Paradev (anciennement Superset)

**Source :** [Paradev — tarifs et FAQ](https://paradev.com/pricing)

**Faits affichés :**

- Utilisation des agents **Claude Code, Codex, OpenCode ou autres CLI** avec **comptes/abonnements ou clés API personnels**.
- Espaces de travail locaux gratuits ; l'éditeur dit ne **pas relayer les appels API** et laisser par défaut dépôts, worktrees, terminaux et sessions sur la machine.
- Offre **Free** ; **Pro : 20 $/utilisateur/mois** en facturation mensuelle (**16 $** avec paiement annuel) ; offres Team/Ultra et Enterprise.
- Fonctionnalités Pro annoncées : accès distant, automatisations, intégrations Linear/Slack, mobile.

**Apprentissages :** modèle **freemium local + premium orchestration/accès distant** ; séparation explicite de la facturation IA. **La méthode d'authentification et les accords éventuels avec les fournisseurs restent à vérifier.**

### 3.3 Shuriken

**Sources :** [Shuriken — présentation](https://shuriken.sh/) ; [tarifs](https://shuriken.sh/pricing) ; [fonctionnalités](https://shuriken.sh/features)

**Faits affichés :**

- Agents fonctionnant sur les **machines et serveurs du Pilote**, accessibles depuis une interface web/mobile ; prise en charge annoncée de Claude Code et Codex et de plusieurs fournisseurs.
- Offre gratuite pour **2 sources** (comptes ou clés API) et **2 appareils** ; **Pro : 49 €/mois** ou **490 €/an**.
- Fonctions : agents parallèles, branches isolées, suivi d'activité, MCP et gestion des limites d'utilisation.
- L'éditeur affiche des possibilités de **bascule automatique entre comptes** et de démarrage anticipé de fenêtres de quota.

**Point d'alerte majeur :** les conditions **Sign in with ChatGPT** interdisent les méthodes de création, rotation ou distribution de comptes visant à **contourner des limites d'usage**. Il ne faut **pas recopier mécaniquement** ces fonctions. L'existence des fonctionnalités chez Shuriken **ne démontre pas** qu'elles sont permises par tous les fournisseurs ou tous les modes d'authentification ; ne pas accuser le concurrent d'une violation non établie.

**Apprentissage principal :** un **Runner local + application web + abonnements individuels** est déjà proposé sur le marché. Il faut donc différencier Crewdeck par autre chose.

### 3.4 VibeiDE

**Sources :** [VibeiDE — site et tarifs](https://vibeide.dev/) ; [guide produit](https://vibeide.dev/docs/product-facts/)

**Faits affichés :**

- Espace de travail local pour **Claude Code, Codex et OpenCode installés** ; files de travail par projet, suivi en direct, historique et review des résultats.
- Les abonnements/consommations des fournisseurs sont séparés du prix de VibeiDE.
- Tarifs promotionnels publiés au 8 novembre 2026 : **7,99 $/mois** en formule personnelle, **14,99 $/siège/mois** pour l'équipe (hors taxes) ; augmentation annoncée pour janvier 2027. L'éditeur propose un essai gratuit plutôt qu'un niveau gratuit permanent sur les offres individuelles présentées.

**Apprentissages :** la **file de Tickets** et la **review** ne suffisent pas à elles seules pour distinguer Crewdeck. La présence d'un abonnement logiciel payant ne renseigne pas, à elle seule, sur l'autorisation du fournisseur ni sur le parcours d'accès gratuit exigé pour le périmètre SIWC pertinent.

### 3.5 T3 Code

**Source :** [T3 Code — site officiel](https://t3.codes/)

**Faits affichés :**

- Plan de contrôle **open source** des agents, avec Claude Code, Codex et d'autres outils ; connexion avec les propres comptes de l'utilisateur.
- Possibilité d'utiliser plusieurs moteurs et de pousser des branches/PR GitHub depuis une interface commune.

**Apprentissage :** la valeur de Crewdeck ne doit pas être seulement « une UI unifiée », puisqu'une partie de cette proposition est offerte gratuitement et en open source.

### 3.6 Tableau de lecture du marché

| Produit | Axe principal observable | Modèle annoncé | Ce qui concurrence Crewdeck | Ce que cela **ne** prouve **pas** |
|---|---|---|---|---|
| Conductor | Orchestration multi-agents, workspaces, PR | Ancien produit commercial ; arrêt annoncé | Agents, sessions, GitHub, reviews | Droit transférable à Crewdeck d'utiliser Claude Agent SDK avec les quotas Pro/Max |
| Paradev | Workspaces locaux, automatisation, accès distant | Free + Pro 20 $/mois | Runner local, CLI, automatisation | Approbation fournisseur applicable à toute intégration similaire |
| Shuriken | Agents locaux pilotés à distance, multi-comptes | Free + Pro 49 €/mois | Runner, interface web/mobile, agents | Conformité de toute stratégie de bascule de comptes |
| VibeiDE | Files de travail, chats, review | Essai + payé dès 7,99 $/mois (promotion) | File de Tickets, suivi, review | Autorisation SIWC ou conformité de son parcours commercial |
| T3 Code | Interface multi-harness open source | Open source | Conversation intégrée, modèles, PR | Équivalence avec le Process Crewdeck |

**Méthode :** ce tableau est un **repérage concurrentiel**, pas un benchmark fonctionnel complet. La présence ou l'absence de fonctionnalités du **Process** (PRD, maquettes, validation de Conception, Décisions transversales, Skins SDK, etc.) doit être testée ; **ne pas affirmer l'absence d'une fonction sur la seule base du marketing**.

---

## 4. Conditions des fournisseurs : ce qui est permis, ce qui reste à valider

### 4.1 Anthropic / Claude

**Sources primaires :**
- [Anthropic — Legal and compliance, Claude Code](https://code.claude.com/docs/en/legal-and-compliance)
- [Anthropic — Utiliser le Claude Agent SDK avec votre plan Claude](https://support.claude.com/fr/articles/15036540-utiliser-le-claude-agent-sdk-avec-votre-plan-claude)

**Constat nuancé :**

- Dans son aide mise à jour en octobre 2026, Anthropic indique que le **Claude Agent SDK, `claude -p` et les applications tierces** continuent, pour le moment, à pouvoir puiser dans les **quotas d'abonnement** après la suspension du changement annoncé le 15 juin 2026.
- Dans sa page **Legal and compliance**, Anthropic stipule en parallèle que les **développeurs de produits tiers**, y compris ceux utilisant l'Agent SDK, **devraient utiliser une authentification par clé API** et **ne sont pas autorisés à fournir une connexion Claude.ai intégrée ni à acheminer les demandes via les identifiants d'abonnement pour le compte des utilisateurs**.
- La même page ménage un cas spécifique où **l'utilisateur final se connecte lui-même à un binaire Claude Code non modifié** avec son propre abonnement, même dans certaines plateformes qui proposent Claude Code, moyennant les conditions commerciales appropriées. Il faut analyser si Crewdeck entre réellement dans ce cas.

**Conclusion opérationnelle :** ne pas assimiler **« fonctionne aujourd'hui »** à **« usage commercial général autorisé »**. Le cas Conductor est une pièce importante pour poser une question précise à Anthropic, mais pas un sauf-conduit. **Demander une confirmation écrite** décrivant le code et le parcours d'authentification réels.

**Variantes à comparer :**

- **A.** Runner qui lance le **binaire Claude Code inchangé** et laisse l'utilisateur s'authentifier via le flux officiel.
- **B.** Runner qui intègre le **Claude Agent SDK** et réutilise l'abonnement du Pilote (implémentation actuelle) : **statut commercial à clarifier expressément**.
- **C.** Claude Agent SDK avec **clé API propre au Pilote** : voie généralement prévue pour les intégrations tierces ; confirmer les modalités commerciales et de conservation locale des clés.

> **Question à soumettre à Anthropic :** « Crewdeck est une application commerciale avec Runner exécuté uniquement sur la machine de chaque utilisateur. Le Runner contrôle Claude Agent SDK pour afficher les conversations et orchestrer les agents dans l'interface Crewdeck. Chaque utilisateur se connecte personnellement à Claude Code avec son propre abonnement, aucun jeton n'est stocké côté serveur ni mutualisé. Ce scénario est-il autorisé commercialement pour Pro/Max/Ultra ? La réponse change-t-elle si nous lançons uniquement le binaire officiel non modifié au lieu de piloter le SDK ? Quelles clauses et contrats s'appliquent ? »

### 4.2 OpenAI / Codex

**Sources primaires :**
- [OpenAI — Conditions Sign in with ChatGPT, effectives le 4 novembre 2026](https://openai.com/fr-FR/policies/sign-in-with-chatgpt-terms/)
- [OpenAI — partenaires reconnus](https://learn.chatgpt.com/docs/sign-in-with-chatgpt)
- [OpenAI — documentation Codex App Server](https://learn.chatgpt.com/docs/app-server)
- [OpenAI — Request a client ID / liste d'attente commerciale](https://developers.openai.com/siwc/request-client-id)
- [OpenAI — Quickstart SIWC](https://developers.openai.com/siwc/quickstart)
- [OpenAI — intégration Codex App Server avec jetons autorisés](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server)

**Constat :**

- **Codex App Server** est une interface adaptée à un client conversationnel complet : historique, événements, approbations, interruptions et appels d'outils. Il convient mieux à la **fenêtre Codex intégrée** qu'une simple capture de terminal ; le **Codex SDK** reste pertinent pour certaines automatisations.
- Le flux historique d'authentification **App Server** n'est, selon la documentation OpenAI, **pas autorisé pour les services commerciaux ou hébergés** ; OpenAI oriente ces usages vers **Sign in with ChatGPT (SIWC)**.
- Au 8 novembre 2026, **SIWC pour les partenaires commerciaux est proposé sur sélection**. **Conductor apparaît dans la liste des applications partenaires** ; ce statut ne s'étend pas automatiquement à Crewdeck.
- Dans le périmètre d'utilisation des forfaits ChatGPT via SIWC, OpenAI impose :
  - Demandes déclenchées dans un runtime local ou distant **contrôlé par le Pilote** ;
  - Demandes faites pour le **Pilote authentifié**, y compris en arrière-plan **seulement après consentement explicite** ;
  - Pas de mutualisation, redistribution, contournement des plafonds ou rotation de comptes à ces fins ;
  - Pas de service de proxy API général ;
  - **Possibilité pour le Pilote d'utiliser son forfait ChatGPT via SIWC sans payer Crewdeck ni devoir passer à un forfait payant**.
- La facturation de **services premium réellement distincts** peut être étudiée, mais la frontière concrète de ce qui peut être réservé au payant doit être **validée auprès d'OpenAI**.

**Conclusion opérationnelle :** choisir une abstraction qui supporte **SIWC officiel quand l'accès est obtenu**, plus un **mode clé API personnelle** qui ne dépend pas de cette approbation. **Ne pas bâtir le lancement payant uniquement sur une authentification Codex personnelle non autorisée en contexte commercial.**

> **Question à soumettre à OpenAI :** « Crewdeck est un SaaS d'orchestration payant doté d'un Runner local, sans proxy des requêtes modèle. Nous voulons intégrer Codex App Server, chaque Pilote liant son propre ChatGPT Plus/Pro via SIWC. Quel est le parcours d'accès partenaire ? Quelles fonctionnalités minimales doivent rester utilisables gratuitement pour respecter l'exigence *no charge* ? Quels Process, Boucles automatisées et fonctionnalités premium pouvons-nous facturer séparément ? »

**Attention :** SIWC **n'est pas** un accès générique aux abonnements via les API ordinaires ou les sessions Codex existantes ; il faut prendre en compte le **périmètre de jeton autorisé, le client ID, la conservation locale, le renouvellement et l'éligibilité du compte**.

---

## 5. Conséquences sur la conception de Crewdeck

### 5.1 Le véritable angle de différenciation à instruire

**Éléments devenus des standards concurrentiels** (au moins partiellement) : terminal ou conversation agent, multi-fournisseur, worktrees/branches, PR, review, agents parallèles, pilotage distant, Runner local, abonnements personnels.

**Hypothèse de valeur propre à Crewdeck à tester :** un **Process cohérent de bout en bout** qui transforme les Idées en Conception validée (PRD, maquettes, conception technique), puis en Tickets puis en Boucle, avec **gates humaines**, historique et **Décisions transversales** ; le tout pilotable par des **Skins** complètement interchangeables grâce à un SDK.

Questions prioritaires :

1. Quel problème concret le Process règle-t-il mieux qu'une suite de chats ou de workspaces concurrents ?
2. Quel est le coût de friction ajouté par les validations ? Comment garder le contrôle humain sans casser le flux ?
3. Quels écrans ou démonstrations montreraient en **5 minutes** un avantage que Paradev, VibeiDE et T3 Code ne montrent pas ?
4. Le **Skin SDK** apporte-t-il une valeur suffisante au MVP, ou distrait-il de l'avantage principal du Process ?
5. Quel segment viser d'abord : **développeur solo gérant plusieurs produits**, développeur freelance qui livre des applications, ou équipe ? Les concurrents adressent-ils déjà ce segment de manière comparable ?

### 5.2 Architecture d'intégration recommandée comme **hypothèse**

```text
                        Crewdeck Web / Skins
                                  |
                        Process & Décisions
                                  |
                   Backend Crewdeck (orchestration)
                                  |
                    Canal chiffré / protocole Runner
                                  |
                Runner local (machine du Pilote)
                     /                         \
          Adaptateur Claude              Adaptateur Codex
          - Agent SDK OU CLI             - Codex App Server
          - Abonnement* OU API           - SIWC autorisé* OU API
                     \                         /
                      Git local / worktrees / outils
                                  |
                                GitHub

* Chemin abonnement conditionné à une validation commerciale explicite.
```

Le **Process** ne doit pas dépendre d'une marque de modèle. Définir une capacité d'exécution de rôle et un **registre de fournisseurs** sur le Runner.

**Exemple conceptuel, à adapter au code réellement présent :**

```ts
type AgentRole = 'idea' | 'design' | 'coding' | 'review';
type ProviderId = 'claude' | 'codex';
type AuthMode = 'subscription' | 'api-key';

type ModelChoice = {
  provider: ProviderId;
  modelId: string;
  authMode: AuthMode;
};

type ProjectAgentSettings = Partial<Record<AgentRole, ModelChoice>>;
```

**Contraintes :**

- Séparer **compte connecté**, **mode d'authentification**, **modèles annoncés**, **modèles effectivement accessibles**, **limites/quota** et **état du Runner**.
- Fournir des **capacités** déclaratives (review native, interruption, reprise, accès outils, approbation) plutôt que supposer que les deux SDK ont les mêmes primitives.
- Normaliser les **événements UI** sans effacer les détails fournisseur. Gérer messages partiels, tools, fichier modifié, demande d'approbation, erreur, interruption, achèvement, resynchronisation.
- Garder les **sessions de chaque moteur distinctes** : un échange Claude → Codex passe par un **transfert de contexte documenté** (documents validés, Ticket, diff, branche, tests et contraintes), pas par la « reprise » magique d'une session inter-fournisseur.
- Distinguer les permissions du Skin de celles du Runner. Une **Action sensible** (démarrage de Boucle, validation de Conception, merge) conserve la confirmation propre à Crewdeck.
- Pour les automatisations, recueillir et tracer le **consentement explicite** du Pilote et prévoir pause/arrêt/révocation.
- Éviter de transmettre au backend Crewdeck les **jetons OAuth**, les **clés API**, les prompts complets et les fichiers du Projet, sauf nécessité justifiée, consentie et documentée. Vérifier le besoin réel de toute synchronisation.
- Prévoir un **fallback utilisable par clé API** et des messages d'état clairs (« indisponible avec l'abonnement », « connexion requise », « quota atteint », « Runner hors ligne »).

### 5.3 Modèle économique à challenger

**Hypothèse :** offre gratuite de base pour l'exécution locale et l'utilisation de l'intégration SIWC (si autorisée), puis fonctionnalités payantes clairement distinctes : coordination multi-Projets, automatisations avancées, historique, dashboards, collaboration future, accès distant, Skins, etc.

**Ne pas finaliser le paywall avant d'avoir obtenu une lecture d'OpenAI** : l'exigence « no charge » ne permet pas d'affirmer sans analyse que toute limite sur la Boucle ou tout feature gating est acceptable. **C'est une question contractuelle, pas seulement une décision produit.**

Le prix de la concurrence s'étend de l'open source/gratuit à plusieurs dizaines d'euros par mois ; Crewdeck devra justifier son coût par un **bénéfice mesurable** (temps gagné de conception à merge, réduction des interruptions et oublis, lisibilité du travail, qualité/reproductibilité du Process), et non simplement par le nombre de moteurs compatibles.

---

## 6. Questions à traiter par l'agent de conception (audit requis)

### Bloc A — Vérifier l'existant

1. **Comment Crewdeck lance-t-il aujourd'hui Claude Agent SDK ?** Package exact, processus, chemins de configuration, permissions, stockage local, identité de l'utilisateur et traitement des erreurs.
2. **Quel est le mécanisme d'authentification réel ?** Réutilisation de la session Claude Code native, jeton passé explicitement au SDK, OAuth développé dans Crewdeck, clé API, ou autre ? Identifier **précisément**, code et configurations à l'appui.
3. **Quelles données sensibles transitent par le backend ?** En particulier clés, jetons, contenu des chats, données Git, artefacts, logs.
4. **Le Runner peut-il exécuter un binaire Claude Code inchangé** en conservant l'UX intégrée ? Quelles capacités seraient perdues par rapport au SDK ?

### Bloc B — Conformité et fournisseurs

5. Distinguer les scénarios **Claude API / SDK + API / SDK + abonnement / CLI officiel + abonnement**, avec statut **confirmé / incertain / interdit** et citation de la clause.
6. Distinguer les scénarios **Codex App Server + clé API / App Server + login historique / App Server + SIWC**, et leurs conditions de distribution commerciale.
7. Quel design d'offre gratuite répondrait à l'exigence **SIWC no charge** tout en conservant un SaaS Crewdeck payant ? Quelles questions poser exactement à OpenAI avant le lancement ?
8. Quels usages **automatisés de la Boucle** exigent une autorisation explicite ? Comment garder et retirer cette autorisation ?
9. Quels risques créeraient une gestion de **plusieurs comptes IA** (bascule, rotation, limite de quota) ? Quelles fonctions exclure pour ne pas contourner les limites ?

### Bloc C — Technique et expérience Pilote

10. Proposer un **contrat d'adaptateur Claude/Codex**, incluant lancement, reprise, interruptions, événements et demandes d'approbation.
11. Proposer la structure des **paramètres par rôle** (Idée, Conception, Code, Review), la détection des modèles disponibles et les fallbacks.
12. Décrire le parcours **« connecter un compte »** pour Claude et Codex, en distinguant clairement flux officiels, modes API et états non pris en charge.
13. Expliquer le transfert de contexte **Conception → Code → Review**, surtout quand le moteur change en cours de Process.
14. Définir les états du Runner et les garanties de **Resynchronisation**, sans répéter les actions sensibles après reconnexion.

### Bloc D — Stratégie concurrentielle

15. Faire un **benchmark comparatif réellement testé**, au minimum Conductor (documentation/archives, compte tenu de l'arrêt annoncé), Paradev, Shuriken, VibeiDE et T3 Code. Comparer **Process complet, validation des artefacts, orchestration, intervention humaine, GitHub, mobile, plugin/skins, prix, auth**.
16. Identifier **3 fonctionnalités différenciantes** prouvables de Crewdeck et **3 fonctionnalités à ne pas prioriser** au MVP parce que déjà commoditisées.
17. Formuler une proposition de valeur concise pour le **Pilote solo**, puis proposer un test utilisateur et une métrique vérifiable.
18. Proposer un **plan de lancement par scénarios** : (a) approbation Anthropic et SIWC obtenue ; (b) seule une approbation obtenue ; (c) aucune approbation — lancement clés API personnelles uniquement.

---

## 7. Livrables attendus de l'agent (sans écrire de code)

Produire un rapport structuré contenant :

1. **Audit factuel du code existant**, avec les fichiers/modules concernés et ce qui reste à vérifier.
2. **Matrice d'autorisation par fournisseur et mode d'authentification**, sourcée et datée, distinguant *techniquement possible* / *commercialement permis* / *à confirmer*.
3. **Benchmark concurrentiel** sourcé avec capture du périmètre fonctionnel testé et des inconnues.
4. **2 ou 3 architectures alternatives**, avantages, inconvénients, risques juridiques et dette technique.
5. **Recommandation motivée** qui conserve la philosophie **Runner local + comptes propres au Pilote + interface intégrée** dans toute la mesure autorisée.
6. **Proposition de modèle gratuit/premium**, explicitement conditionnée aux réponses d'OpenAI.
7. **Liste de questions prêtes à envoyer à Anthropic et OpenAI**, avec description neutre du fonctionnement réel.
8. **Roadmap priorisée**, avec dépendances : ce qui peut être développé maintenant sans verrouiller une décision juridique ; ce qui attend un accord.

**Règles méthodologiques :**

- Se baser d'abord sur **les conditions contractuelles et documentations officielles**, puis sur les annonces des concurrents ; ne pas déduire une autorisation du simple fait qu'un outil existe.
- Documenter chaque affirmation avec **URL, date de consultation et citation/paragraphe pertinent**, et signaler les contradictions apparentes entre documentation technique et clauses juridiques.
- Ne pas présenter les annonces futures de Conductor (13/20 novembre, début 2027) comme déjà réalisées au **8 novembre 2026**.
- Ne pas suggérer de récupération non autorisée de sessions, extraction de cookies/tokens, proxies mutualisant les abonnements ou contournement de quotas.
- **Ne pas coder ni modifier la base existante** avant validation du scénario d'intégration et des risques.

---

## 8. Sources principales (vérifiées le 8 novembre 2026)

### Conditions officielles et SDK

1. Anthropic — Claude Code Legal and compliance : https://code.claude.com/docs/en/legal-and-compliance
2. Anthropic — Claude Agent SDK avec un abonnement : https://support.claude.com/fr/articles/15036540-utiliser-le-claude-agent-sdk-avec-votre-plan-claude
3. OpenAI — Sign in with ChatGPT Terms (4 novembre 2026) : https://openai.com/fr-FR/policies/sign-in-with-chatgpt-terms/
4. OpenAI — liste de partenaires SIWC : https://learn.chatgpt.com/docs/sign-in-with-chatgpt
5. OpenAI — Codex App Server : https://learn.chatgpt.com/docs/app-server
6. OpenAI — accès partenaire commercial : https://developers.openai.com/siwc/request-client-id
7. OpenAI — parcours SIWC : https://developers.openai.com/siwc/quickstart
8. OpenAI — SIWC + Codex App Server : https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server

### Concurrence et précédents

9. Conductor — Claude SDK et abonnements : https://www.conductor.build/blog/claude-subscription-update
10. Conductor — SIWC / Codex : https://www.conductor.build/changelog/0.89.0-sign-in-with-chatgpt
11. Conductor — rapprochement Meta et arrêt annoncé : https://www.conductor.build/announcement
12. Conductor — Codex : https://www.conductor.build/docs/reference/harnesses/codex
13. Paradev — tarifs et modèle local : https://paradev.com/pricing
14. Shuriken — aperçu : https://shuriken.sh/
15. Shuriken — tarifs : https://shuriken.sh/pricing
16. Shuriken — fonctionnalités : https://shuriken.sh/features
17. VibeiDE — site et tarifs : https://vibeide.dev/
18. VibeiDE — guide produit : https://vibeide.dev/docs/product-facts/
19. T3 Code — open source : https://t3.codes/

---

## 9. Synthèse de décision

- **Feu vert sur l'objectif produit :** Crewdeck peut légitimement viser une interface multi-agents avec Runner local et logiciel payant, car le modèle existe et les API offrent des voies d'intégration commerciales.
- **Pas de feu vert automatique sur le chemin “abonnement personnel dans le SDK commercial” :** Anthropic présente une ambiguïté importante à éclaircir pour le cas exact de Crewdeck ; OpenAI exige le respect des conditions et du parcours commercial SIWC.
- **Éviter le piège concurrentiel :** les chats intégrés, worktrees, reviews, agents parallèles et connexions multi-fournisseurs ne différencient plus à eux seuls le produit.
- **Hypothèse stratégique à tester :** le **Process complet, piloté par Décisions humaines, jusqu'à la PR mergée**, avec **Runner local** et **Skins modulables**, constitue la proposition distinctive de Crewdeck.
- **Prochaine étape :** produire l'audit, les variantes d'architecture, la matrice de conformité et les demandes formelles aux fournisseurs **avant de verrouiller le modèle économique**.

*Cette note est une aide à la conception, non un avis juridique. Les conditions peuvent évoluer ; refaire une vérification avant la commercialisation.*
