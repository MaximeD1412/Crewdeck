# Orchestrateurs IA pour les projets logiciels

**Panorama au 19 novembre 2026 · 45 produits, suites, projets et frameworks · 120 fonctionnalités recensées**

## Synthèse

- **Multica, Spaces, Intent et Factory Missions** sont les comparables les plus directs pour le Process de Crewdeck. Multica enchaîne des étapes de tableau avec des transferts à des humains ou des agents. Spaces documente un pipeline qui part d’une idée ou d’un ticket et produit des spécifications, du code et des rapports à des étapes soumises à validation. Intent organise le travail autour d’une spécification partagée et évolutive. Factory Missions structure des projets en fonctionnalités, jalons, exécution et vérification.
- **Linear et Atlassian** sont les comparables les plus solides pour la gestion quotidienne du projet. Linear réunit la planification, le triage, la rédaction de specs, les automatisations et la délégation à des agents natifs ou externes. La suite Atlassian relie les idées, la priorisation, les tickets, la documentation Confluence et la revue de PR fondée sur les critères Jira.
- **OpenSymphony, Backlog.md, Orchestrator.inc et Emdash** sont les références techniques à regarder pour ta nouvelle direction. OpenSymphony expose le graphe des dépendances sur plusieurs dépôts. Backlog.md prouve qu’un backlog Markdown peut servir directement d’interface entre une personne et ses agents. Orchestrator.inc réinjecte CI et retours de revue dans la session d’origine. Emdash documente les runtimes sous ton contrôle, y compris à distance.
- **L’hypothèse la plus intéressante pour Crewdeck** est un Process visuel qui garde les décisions et livrables reliés, même lorsque la documentation, les tickets, le code et l’exécution vivent dans des outils différents. Le scénario le plus exigeant à démontrer est le passage d’un projet entièrement local à un projet connecté, à un rythme différent pour chaque brique.

## Méthode et périmètre

Le cœur de l’étude couvre la gestion de projet logiciel, de l’idée et des exigences à la livraison et au suivi. Des outils voisins complètent l’inventaire lorsqu’ils offrent une fonction transposable, par exemple le canvas de design, l’orchestration de déploiements ou l’évaluation des agents. Une suite compte pour une entrée. « Documenté » signifie que la capacité est décrite dans la documentation, un dépôt public, un changelog ou une publication de l’éditeur. Certaines capacités requièrent une offre, une intégration ou un mode d’exécution spécifique. Les exemples de la grille montrent où chercher la fonction, sans supposer que chaque produit cité propose tous les éléments de sa ligne.

L’analyse repose sur les sources publiques. Les 45 entrées n’ont pas été testées en installation réelle. La qualité des résultats, les performances, la profondeur des synchronisations et l’absence d’une fonction restent à vérifier en essai. La liste vise une couverture complète des familles de fonctions observées dans le périmètre étudié. Les prix, les quotas et les droits commerciaux liés aux abonnements personnels sont hors périmètre.

## Panorama par produit

### Gestion de projet et de produit

| Produit | Fonctionnalités observées | Périmètre utile à Crewdeck et sources |
| --- | --- | --- |
| Multica | Tickets, projets, ressources de projet, tableau, agents assignables, équipes mêlant humains et agents, remontée de blocages, suivi et coût des exécutions. Le workflow d’un projet associe à chaque colonne une instruction, un agent ou un humain, une destination en cas de succès et un retour en cas de rejet. | Auto-hébergeable, runtime contrôlé par l’utilisateur, CLI d’agents installées séparément. Comparable direct du Process. [Dépôt](https://github.com/multica-ai/multica) · [Workflows](https://multica.ai/docs/workflows) · [Projets](https://multica.ai/docs/projects) |
| Linear Agent + Linear | Triage, rapprochement des doublons, projets, initiatives, cycles, documents, rédaction de specs, assistance à la planification, délégation à un agent natif ou externe, sessions de code attachées au ticket, revue de PR, automatisations Loops planifiées ou événementielles, connecteurs MCP. | Référence pour une orchestration centrée sur le ticket et l’activité de projet. [Agent](https://linear.app/docs/linear-agent) · [Exécution cloud](https://linear.app/docs/linear-cloud-coding-agent) · [Intégrations](https://linear.app/integrations/agents) · [Triage](https://linear.app/docs/triage-intelligence) · [Cycles](https://linear.app/docs/use-cycles) |
| Jira Product Discovery + Jira + Confluence + Rovo Dev | Capturer et scorer les idées, relier les idées à la livraison, organiser la roadmap, travailler depuis un ticket Jira, produire des changements de code, faire des revues GitHub ou Bitbucket avec vérification des critères d’acceptation Jira et lancer certaines actions par Jira Automation. | Ensemble de briques Atlassian. L’accès aux outils varie entre le CLI, l’IDE et l’action d’automatisation. [Product Discovery](https://support.atlassian.com/jira-product-discovery/docs/what-is-jira-product-discovery/) · [IA Discovery](https://support.atlassian.com/jira-product-discovery/docs/explore-atlassian-intelligence-in-jira-product-discovery/) · [Rovo Dev](https://www.atlassian.com/software/rovo-dev) · [Revue](https://support.atlassian.com/rovo/docs/enable-code-reviews/) |
| GitHub Projects + Copilot cloud agent | Tableau, liste et roadmap alimentés par les issues et PR, champs, itérations, automatisations, délégation d’issue, environnement GitHub Actions, agents spécialisés, choix du modèle selon configuration, PR et suivi des sessions. | Référence intégrée autour de GitHub. [Projects](https://docs.github.com/en/issues/planning-and-tracking-with-projects/learning-about-projects/about-projects) · [Agent cloud](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/use-cloud-agent-on-github) · [Automatisations](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/create-automations) |
| GitLab + Duo Agent Platform | Issues et merge requests reliées au travail de l’agent, flux de développement, déclencheurs, catalogue de flows, éditeur de flux dans VS Code et configuration YAML. Un flux peut contenir un agent, un appel IA simple, une action déterministe et une demande d’accord humain. | Comparable du canvas et de la composition de workflows, dans l’écosystème GitLab. L’offre, la version et les fonctionnalités activées déterminent la disponibilité. [Plateforme](https://docs.gitlab.com/user/duo_agent_platform/) · [Flux personnalisés](https://docs.gitlab.com/user/duo_agent_platform/flows/custom/) · [Déclencheurs](https://docs.gitlab.com/user/duo_agent_platform/triggers/) |
| Plane | Work items, cycles, projets et réglages d’espace de travail. L’intégration Claude documente l’accès aux données de projet depuis une conversation. | Comparable du tracker. L’intégration citée porte sur la gestion du projet. [Work items](https://docs.plane.so/work-items/overview) · [Cycles](https://docs.plane.so/core-concepts/cycles) · [Claude](https://docs.plane.so/integrations/claude) |
| ClickUp Brain + Autopilot Agents | Création et mise à jour de tâches, recherche de contexte interne ou connecté, synthèses et agents déclenchés par des règles de l’espace de travail. Les tâches, docs et échanges servent de contexte. | Référence pour le triage et la coordination de projet. [Brain](https://help.clickup.com/hc/en-us/articles/33032484272023-What-are-ClickUp-AI-tools) · [Autopilot](https://help.clickup.com/hc/en-us/articles/37045015737111-What-are-Autopilot-Agents) |
| Asana AI Studio | Workflows sans code, déclencheurs et actions IA dans les projets, classification et aiguillage des demandes, mise à jour des tâches, modèles de workflow et choix de modèle selon l’offre. | Référence pour un éditeur de processus accessible à des non-développeurs. [AI Studio](https://help.asana.com/s/article/ai-studio-smart-workflows) · [Modèles](https://help.asana.com/s/article/ai-studio-models?language=en_US) |
| Productboard Spark | Exploitation des retours et des données produit, synthèse des constats, identification d’opportunités, transformation d’idées en specs et aide aux décisions de priorisation. | Référence pour l’amont produit. [Spark](https://support.productboard.com/hc/en-us/articles/44571897288723-Productboard-Spark) · [Opportunités](https://support.productboard.com/hc/en-us/articles/52646631989267-Spark-Findings-and-opportunities) · [Spécifications](https://support.productboard.com/hc/en-us/articles/52673247017619-Spark-Turn-ideas-into-specs) |

### Spécifications, planification et exécution par étapes

| Produit | Fonctionnalités observées | Périmètre utile à Crewdeck et sources |
| --- | --- | --- |
| Intent, issu d’Augment Code | Spécification vivante par espace de travail, coordinateur, agents d’implémentation et de vérification, tâches et dépendances, agents CLI et rôles personnalisables, fichiers, navigateur, terminal, diff, Git, exécution sur plusieurs machines. | Comparable direct de Conception → Boucle. L’application de bureau est proposée pour macOS sur la page consultée. [Produit](https://intentapp.dev/) · [Vérification](https://www.augmentcode.com/guides/ai-agent-pre-merge-verification) |
| Factory Missions | Plan coécrit, fonctionnalités par jalon, critères de réussite, stratégie de validation, supervision de workers, QA automatisée et correction, conduite depuis le CLI ou l’app. | Référence pour un lot important de fonctionnalités et la validation à chaque jalon. La QA dépend de la capacité du projet à exécuter des scénarios de manière automatisée. [Missions](https://docs.factory.com/missions/overview) |
| Spaces | Idée, page d’exigences ou ticket en entrée, recherche, spec, plan, tâches, implémentation, revue, QA navigateur et livraison. Validations humaines, artefacts Markdown, traçabilité des critères, tableau, journal et coût, GitHub, Jira, Linear, Confluence et Slack. | Projet public à évaluer. Il documente des tickets et des connaissances externes, un pipeline centré sur la PR GitHub et des clés API. [Dépôt et architecture](https://github.com/rayedbajwa/spaces) |
| AWS Kiro | Exigences, conception technique, tâches, règles de projet, hooks, agents personnalisés et MCP. Modes IDE, CLI, web et mobile, travail autonome et ouverture de PR ou MR selon la surface. | Référence pour le passage de la spec à l’implémentation. [Architecture produit](https://kiro.dev/docs/how-kiro-works/) · [Web](https://kiro.dev/docs/web/) |
| BMad Method | Clarification, brief produit, PRD, UX, architecture, épiques, stories, préparation, implémentation et vérification. Les workflows apportent des rôles et des livrables à des outils de codage existants. | Référence pour le Process depuis l’idée et la conception UX. [Méthode](https://docs.bmad-method.org/start/how-bmad-works/) · [Planification](https://docs.bmad-method.org/plan/plan-the-work/) |
| GitHub Spec Kit | Constitution du projet, spec, clarification, plan, tâches, checklists, analyse de cohérence et implémentation assistée. Artefacts versionnables. | Référence pour structurer les entrées et sorties d’étapes dans le dépôt. [Workflow officiel](https://github.com/github/spec-kit/blob/main/docs/reference/agentic-sdd.md) |
| OpenSpec | Proposition de changement, design, tâches, deltas de spécification, application puis archivage de la décision et fusion dans les specs de référence. Profils et commandes personnalisables. | Référence pour faire évoluer la spec d’un logiciel existant et garder le contexte de chaque changement. [Concepts](https://github.com/Fission-AI/OpenSpec/blob/main/docs/concepts.md) · [Commandes](https://github.com/Fission-AI/OpenSpec/blob/main/docs/how-commands-work.md) |
| Task Master | Extraction de tâches depuis un PRD, estimation de complexité, sous-tâches, dépendances, identification de la prochaine tâche et accès par CLI ou MCP. | Référence pour le découpage et l’ordre d’exécution. [Dépôt](https://github.com/eyaltoledano/claude-task-master) · [Structure des tâches](https://github.com/eyaltoledano/claude-task-master/blob/main/docs/task-structure.md) |
| Backlog.md | Tickets et décisions en fichiers Markdown, Kanban web local et terminal, CLI et MCP, dépendances, jalons, critères d’acceptation, définition de fini, recherche et export de rapports. Revues de la spec, du plan puis du code. | Support explicite de Git distant facultatif. Très proche du scénario local, avec un dépôt Git local pour l’historique du projet. [Dépôt](https://github.com/MrLesk/Backlog.md) |
| Trellis de Mindfold | PRD, contexte d’implémentation et de revue, tâches et mémoire persistées dans le dépôt, intégration à plusieurs outils de codage, règles partagées par l’équipe. | Référence pour une mémoire portable et consultable. Projet distinct de Trellis Builders. [Dépôt](https://github.com/mindfold-ai/Trellis) |

### Coordination des agents, des environnements et des PR

| Produit | Fonctionnalités observées | Périmètre utile à Crewdeck et sources |
| --- | --- | --- |
| Orchestrator.inc, ancien dépôt Composio Agent Orchestrator | Agent principal qui planifie et délègue par worktree. Tableau de suivi alimenté par sessions, CI et PR. Retours de CI, conflits et commentaires renvoyés à l’agent concerné. Agent de revue, aperçu navigateur, sélection d’agent et de modèle, poste local et contrôle mobile, cloud proposé. | Très proche de la Boucle et de la boîte de décisions, notamment sur Windows, Linux et macOS. [Dépôt actuel](https://github.com/OrchestratorInc/agent-orchestrator) · [Architecture d’origine](https://composio.dev/blog/the-self-improving-ai-system-that-built-itself) |
| OpenSymphony | Graphe de tâches avec dépendances et chemin critique, routage par dépôt, espaces isolés, exécution OpenHands, Codex et ACP, reprise de sessions, mémoire liée au code, intégration finale des tâches enfants. | Exécution local-first. Le parcours documenté part d’une hiérarchie de tickets Linear. [Produit](https://opensymphony.dev/) · [Changelog](https://opensymphony.dev/changelog/) |
| OpenAI Symphony | Surveillance d’un tableau Linear, lancement de tâches dans des espaces isolés, remontée de preuves de travail comme l’état CI et les résultats de revue, atterrissage de la PR après acceptation. | Spécification et implémentation de référence expérimentale. Projet distinct d’OpenSymphony. [Dépôt](https://github.com/openai/symphony) |
| Paradev, anciennement Superset | Worktrees locaux, orchestration par agent et transfert entre sessions, CLI, MCP, automatisations sur événement ou horaire, intégration à Linear, serveur pour exécution à distance. | Référence pour l’orchestration d’outils de codage déjà installés et la continuité de contexte. [Orchestration](https://docs.paradev.com/orchestration) · [Automatisations](https://paradev.com/automations) · [Linear](https://docs.paradev.com/use-with-linear) |
| Shuriken | Agents parallèles et sous-agents multi-fournisseurs sur les machines choisies, branche par conversation, file de messages, activité, aperçu de l’application, suivi des coûts et limites, pilotage sur mobile. L’éditeur décrit aussi des mécanismes de bascule entre sources de modèles. | Comparable du Runner, du pilotage distant et de la reprise de session. [Fonctionnalités](https://shuriken.sh/features) |
| VibeiDE | Files de tâches par projet, priorités et capacité par agent, sessions conservées, activité, revue de fin et workflows Execute, Plan Council, Turbo et Standup. | Référence pour organiser Claude Code, Codex et OpenCode déjà installés. Le guide distingue la validation macOS de la prise en charge Windows et Linux. [Guide produit](https://vibeide.dev/docs/product-facts/) |
| Emdash Classic | Tâche créée depuis une branche, une issue ou une PR, worktrees, choix du fournisseur et du modèle selon l’agent, chat ou terminal, navigateur, diff, checks CI/CD et exécution à distance. | Les sources décrivent l’édition Classic. Emdash 2.0 relève d’une offre distincte. [Documentation](https://emdash.com/docs) · [Tâches](https://emdash.com/docs/tasks) · [Exécution distante](https://emdash.com/docs/remote-development) |
| Conductor | Workspaces locaux ou cloud, fils d’agents, checkpoints, Git, diff et checks, automatisation entre workspaces et délégation à d’autres agents. | L’annonce Meta a été actualisée et confirme la poursuite du développement et du fonctionnement. Elle annule le calendrier d’arrêt qui figurait dans la version initiale. [Annonce mise à jour](https://www.conductor.build/announcement) · [Changelog](https://www.conductor.build/changelog) |
| T3 Code | Interface commune pour plusieurs outils d’exécution d’agents, fils isolés sur des branches, diff, push et PR à partir de la même interface. | Comparable de l’interface agents et Git. [Produit](https://t3.codes/) |
| OpenHands + Agent Canvas | Interface web pour les agents, espaces de travail, automatisations, choix du backend d’exécution, VM ou auto-hébergement, SDK, scénarios de triage, tests et revue. | Autre sens du mot canvas, ici centré sur l’exécution des agents. [Agent Canvas](https://github.com/OpenHands/docs/blob/main/openhands/usage/agent-canvas/overview.mdx) · [Cas d’usage](https://www.openhands.dev/) |
| Tembo | Agents de code dans des environnements partageables, intégrations, déclencheurs horaires, API ou événements, collecte du contexte, revue, cloud et offre d’auto-hébergement. | Hub d’automatisations à partir d’outils existants, de Linear et Jira à GitHub, GitLab et Slack. [Produit](https://www.tembo.io/) · [Automatisations](https://www.tembo.io/automations) |
| Devin | Décomposition et délégation parallèle à des Devins séparés, VM par session, terminal, navigateur, tests, inspection et discussion dans les sessions filles, planification, intégration Linear. | Référence pour déléguer et suivre de grosses tâches avec un agent supervisant ses propres workers. [Documentation](https://docs.devin.ai/) · [Délégation](https://cognition.com/blog/devin-can-now-manage-devins) · [Planification](https://cognition.com/blog/devin-can-now-schedule-devins) · [Linear](https://linear.app/integrations/devin) |
| Cursor Cloud Agents | Agents dans des VM, contexte dépôt, navigateur et artefacts, intégrations GitHub, GitLab, Linear et Slack selon le déclencheur, automatisations par agenda ou événement, MCP. | Référence des déclencheurs et de l’exécution cloud. [Capacités](https://cursor.com/docs/cloud-agent/capabilities) · [Automatisations](https://cursor.com/docs/cloud-agent/automations) |
| Claude Code | Sous-agents et équipes d’agents, outils et permissions par rôle, tâches d’équipe, messages entre agents, worktrees selon le mode, routines sur horaire, API ou événement. | L’éditeur indique un statut expérimental pour les équipes d’agents. Les routines cloud sont une surface distincte. [Sous-agents](https://code.claude.com/docs/en/sub-agents) · [Équipes](https://code.claude.com/docs/en/agent-teams) · [Routines](https://claude.com/resources/articles/introducing-routines-in-claude-code) |
| OpenAI Codex | Sessions locales, worktrees et cloud, actions d’environnement, tâches planifiées et revue de code, surfaces desktop et web. App Server pour l’intégration à d’autres interfaces. | Référence pour intégrer l’expérience d’un agent et les droits de pilotage d’une session. Les capacités varient selon le mode et la surface. [Environnements](https://learn.chatgpt.com/docs/environments/modes) · [Automatisations](https://learn.chatgpt.com/docs/automations?surface=app) · [App Server](https://learn.chatgpt.com/docs/app-server) |
| Google Antigravity | Gestion de plusieurs missions d’agents, scénarios navigateur, captures et artefacts consultables pour la revue du travail selon la surface. | Référence pour présenter les preuves d’exécution dans un espace de développement. [Fonctionnalités](https://antigravity.google/docs/features) · [Artefacts](https://antigravity.google/docs/cli/artifacts) |
| Vibe Kanban | Workspaces d’agents, branches et aperçu, revue de diff en ligne, PR et merge. Le produit historique incluait projets, tickets et commentaires distants. | Bloop a annoncé sa fermeture en avril 2026 et le retrait des services distants d’origine. Les workspaces locaux et le projet communautaire continuent. Le dépôt documente aussi l’auto-hébergement. [Annonce](https://www.vibekanban.com/blog/shutdown) · [Dépôt](https://github.com/BloopAI/vibe-kanban) |
| Gas Town + Beads | Coordinateur, agents affectés à des dépôts, lots de tâches, registre durable, transferts, messagerie, détection de blocage, reprise et escalade. | Projet technique axé sur la coordination de nombreux agents et la persistance de leur travail. [Dépôt](https://github.com/gastownhall/gastown) |
| Trellis Builders | Roadmap, recherche en lot sur le backlog, implémentation, tests, revue de PR selon les dépendances, remontée des commentaires et relance des commandes conçues pour être répétables. | Skill et commandes au-dessus d’un agent existant. Flux documenté autour de Linear et GitHub. Distinct du projet Trellis de Mindfold. [Produit et commandes](https://trellis.builders/) |

### Briques adjacentes à comparer par fonction

| Produit | Fonctionnalités observées | Périmètre utile à Crewdeck et sources |
| --- | --- | --- |
| Paperclip | Objectifs, organigramme, agents responsables, tickets, budgets, contrôles humains, journal d’activité, organisations multiples et adaptateurs d’agents. | Référence pour gouverner une équipe d’agents, avec un périmètre plus large que le développement logiciel. [Documentation et dépôt](https://github.com/paperclipai/paperclip) |
| Tessl | Registre de skills et plugins, versions, déploiement, politiques, mesure comparative de l’effet d’un skill, observabilité des sessions et dérive des configurations. | Référence pour distribuer et évaluer les extensions. Son agent Tessl est indiqué en bêta ouverte. [Documentation](https://docs.tessl.io/) |
| Figma MCP | Lecture de designs et de leur contexte par les agents, génération de code à partir du design, écriture en calques natifs et conversion d’une interface en éléments éditables. | Référence pour la connexion bidirectionnelle entre maquette et code. [Documentation](https://developers.figma.com/docs/figma-mcp-server/) · [Code vers canvas](https://developers.figma.com/docs/figma-mcp-server/code-to-canvas/) |
| n8n | Éditeur visuel, déclencheurs, actions, agents, conditions, connexions aux services, visualisation des exécutions, demande d’approbation humaine avant l’appel d’un outil. | Référence pour l’édition et l’exécution des workflows. [Validation humaine](https://docs.n8n.io/advanced-ai/human-in-the-loop-tools/) |
| LangGraph | Graphe programmable, état persistant, exécution durable, streaming, mémoire et interruption pour validation ou intervention humaine. | Brique d’exécution à programmer, sans interface projet intégrée dans le framework. [Documentation](https://docs.langchain.com/oss/python/langgraph/overview) |
| Harness Release Orchestration | Coordination de pipelines, services et équipes, approbations et conditions de passage, suivi des déploiements, vérification après mise en service et rollback. | Référence pour la partie située après la PR. Les capacités dépendent de la configuration des pipelines et des composants. [Release Orchestration](https://www.harness.io/products/continuous-delivery/release-orchestration) · [Vérification](https://github.com/harness/developer-hub/blob/main/docs/continuous-delivery/verify/verify-deployments-with-the-verify-step.md) |
| Sentry Seer | Diagnostic d’incident, cause racine, plan de correction, changement ou PR générée, point d’arrêt configurable et itération sur les retours de revue. | Référence pour relier le suivi en production au prochain changement de code. [Étapes et réglages](https://www.sentry.help/en/articles/13964133-how-do-i-enable-or-disable-seer-for-a-specific-project) · [Itération sur la PR](https://sentry.io/changelog/seer-pr-iteration/) |

**Autres références historiques.** Google indique que Jules est passé en lecture seule après le 11 novembre, pour un arrêt le 31 décembre 2026. L’équipe de Roo Code a annoncé la fin du produit le 15 mai 2026. Ces deux références sont exclues du décompte. [Jules](https://jules.google/docs/changelog/) · [Roo Code](https://github.com/RooCodeInc/Roo-Code-Docs/blob/main/docs/sunset.md)

## Inventaire des 120 fonctionnalités

Chaque groupe recense dix fonctions. Les exemples renvoient aux fiches et aux liens du panorama.

### 01 · Recueil des idées et triage

1. Ouvrir une demande depuis une idée libre, un ticket ou une page existante. **Spaces**.
2. Faire remonter du feedback client dans un espace produit. **Linear, Productboard**.
3. Collecter les demandes depuis Slack ou les commentaires. **Linear, Tembo**.
4. Résumer les retours pour en faire ressortir les thèmes. **Productboard, ClickUp**.
5. Extraire des opportunités à partir des retours et données produit. **Productboard**.
6. Proposer les doublons et les tickets liés à l’entrée dans le backlog. **Linear**.
7. Classer et aiguiller une demande par règles ou par IA. **Asana, Linear, ClickUp**.
8. Préparer une note de recherche sur chaque ticket en attente. **Trellis Builders**.
9. Prioriser les idées avec des champs et scores personnalisés. **Jira Product Discovery**.
10. Relier l’idée à son état de livraison pour suivre l’avancement du produit. **Jira Product Discovery**.

### 02 · Conception et spécifications

1. Clarifier les besoins via questions et réponses. **Spec Kit, BMad**.
2. Générer un brief produit. **BMad**.
3. Rédiger un PRD ou transformer une idée en spécification. **BMad, Productboard Spark, Linear**.
4. Formaliser les exigences et critères d’acceptation. **Kiro, Backlog.md**.
5. Produire une conception UX structurée. **BMad**.
6. Rédiger l’architecture et le plan technique. **BMad, Kiro, Spec Kit**.
7. Définir une constitution ou des règles projet réutilisées par les agents. **Spec Kit, Kiro, Trellis de Mindfold**.
8. Faire évoluer une spécification partagée pendant l’exécution. **Intent**.
9. Comparer proposition, tâches et spec pour détecter les incohérences. **Spec Kit**.
10. Archiver la raison d’un changement et fusionner ses deltas dans la spec de référence. **OpenSpec**.

### 03 · Maquettes, documentation et mémoire

1. Lire un cadre Figma et ses données de design comme contexte. **Figma MCP**.
2. Générer du code à partir d’un design existant. **Figma MCP**.
3. Convertir une interface de navigateur en maquette éditable. **Figma MCP**.
4. Créer ou modifier des calques natifs par l’intermédiaire d’un agent. **Figma MCP**.
5. Sélectionner un élément dans un aperçu pour transmettre une instruction contextualisée. **Shuriken, Vibe Kanban**.
6. Rédiger ou conserver les artefacts de travail en Markdown versionné. **Spec Kit, Spaces, Trellis de Mindfold**.
7. Consulter les informations d’une base de connaissances externe pendant les étapes du projet. **Spaces, Linear**.
8. Retrouver une tâche, un document ou une décision par recherche. **Backlog.md, ClickUp**.
9. Relier la mémoire d’un travail aux fichiers, symboles et sources concernés. **OpenSymphony**.
10. Transformer un mode opératoire en skill réutilisable par les agents. **Multica, Tessl**.

### 04 · Backlog, dépendances et coordination quotidienne

1. Découper un PRD en épiques, fonctionnalités, stories ou sous-tâches. **BMad, Task Master, Factory**.
2. Estimer la complexité des tâches et détailler les plus lourdes. **Task Master**.
3. Gérer des statuts personnalisables et des colonnes de Kanban. **Multica, GitHub Projects**.
4. Utiliser une vue tabulaire et une roadmap à partir des mêmes données. **GitHub Projects**.
5. Organiser des cycles et des itérations. **Linear, Plane, GitHub Projects**.
6. Définir des jalons avec leurs fonctionnalités et critères de réussite. **Factory, Backlog.md**.
7. Montrer les tâches bloquantes et les tâches bloquées. **OpenSymphony, Backlog.md**.
8. Afficher le chemin critique d’un ensemble de tâches. **OpenSymphony**.
9. Proposer la prochaine tâche disponible à partir des dépendances. **Task Master**.
10. Affecter un ticket à une personne ou à un agent et conserver le suivi dans le ticket. **Multica, Linear**.

### 05 · Construction du Process

1. Paramétrer un workflow différent par projet. **Multica, GitLab**.
2. Configurer les instructions propres à une étape. **Multica, GitLab**.
3. Transférer automatiquement le travail à un agent ou à un humain. **Multica**.
4. Définir la transition de réussite et le renvoi après rejet. **Multica**.
5. Arrêter le workflow pour obtenir une approbation humaine. **Spaces, GitLab, n8n**.
6. Combiner appels à un agent et actions déterministes. **GitLab, n8n**.
7. Éditer un flux dans une interface visuelle. **GitLab Flow Builder, n8n**.
8. Décrire et éditer un flux en YAML. **GitLab**.
9. Réutiliser des flux par modèles ou catalogue partagé. **Asana, GitLab, Cursor**.
10. Conserver l’état d’un workflow interrompu pour permettre sa reprise. **LangGraph**.

### 06 · Déclencheurs et automatisations

1. Lancer manuellement une mission avec objectif et contexte. **Factory, Intent**.
2. Lancer par mention dans un ticket ou dans Slack. **Linear, Cursor, Tembo**.
3. Lancer à l’arrivée d’une issue dans le triage. **Linear**.
4. Lancer après assignation ou demande de revue. **GitLab Duo, GitHub Copilot**.
5. Lancer à partir d’un événement de PR ou d’un libellé. **Linear, Cursor**.
6. Lancer via webhook ou appel API. **Tembo, Cursor, Claude Code**.
7. Exécuter sur horaire ou en récurrence. **Linear, Codex, Claude Code, Cursor**.
8. Appliquer un filtre pour n’agir que sur des tickets éligibles. **Linear Loops**.
9. Exécuter des hooks au cours du travail de l’agent. **Kiro, Claude Code**.
10. Relancer des traitements en lot sans reproduire le travail déjà marqué comme effectué. **Trellis Builders**.

### 07 · Environnements d’exécution

1. Exécuter l’agent sur le poste du développeur. **Emdash, Shuriken, Codex**.
2. Utiliser une machine distante contrôlée par l’utilisateur. **Emdash, Multica, Shuriken**.
3. Recourir à une VM cloud isolée. **Cursor, Devin, Codex**.
4. Auto-héberger l’application ou le backend d’exécution. **OpenHands, Multica**.
5. Créer une branche et un worktree par tâche. **Orchestrator.inc, Emdash, Paradev**.
6. Reprendre le travail depuis une branche ou PR existante. **Emdash**.
7. Travailler volontairement dans le checkout principal ou un dossier existant. **Emdash, Codex**.
8. Configurer les scripts de démarrage et les commandes de projet. **Codex, Conductor**.
9. Essayer l’application via serveur de développement, aperçu et navigateur. **Intent, Vibe Kanban, Antigravity**.
10. Router des tickets vers plusieurs dépôts et tester ensuite le résultat intégré. **OpenSymphony**.

### 08 · Coordination de plusieurs agents

1. Utiliser plusieurs CLI d’agents depuis une même interface. **Paradev, T3 Code, Emdash**.
2. Choisir un fournisseur ou un modèle par tâche, suivant la prise en charge de l’agent. **Orchestrator.inc, Emdash**.
3. Créer des agents spécialisés avec leur rôle et leurs outils. **Intent, Claude Code, Copilot**.
4. Faire décomposer le travail par un coordinateur puis déléguer à des exécutants. **Intent, Factory, Devin, Conductor**.
5. Exécuter en parallèle des tâches indépendantes dans des espaces séparés. **Orchestrator.inc, Devin, Paradev**.
6. Limiter le nombre de tâches en vol et faire attendre le reste dans une file. **VibeiDE**.
7. Transmettre la main avec le contexte de la branche et du terminal. **Paradev**.
8. Séparer l’implémentation de la vérification par rôle. **Intent, Factory, Spaces**.
9. Échanger des messages entre agents ou maintenir une liste de tâches d’équipe. **Claude Code, Gas Town**.
10. Détecter un agent bloqué, relancer sa session ou escalader. **Gas Town, OpenSymphony**.

### 09 · Suivi, reprise en main et décisions

1. Observer l’activité de l’agent, les commandes et les résultats en direct. **Shuriken, Spaces**.
2. Retrouver l’historique des demandes et réponses par projet. **VibeiDE**.
3. Répondre ou corriger la direction pendant une exécution. **Multica, Devin, Linear**.
4. Interrompre une session ou annuler un travail délégué. **Conductor, Codex App Server**.
5. Restaurer une conversation ou un état de travail sauvegardé. **VibeiDE, Conductor, OpenSymphony**.
6. Remonter les décisions, demandes d’accord et blocages dans une boîte de réception. **Multica, Spaces**.
7. Envoyer une notification et reprendre le pilotage depuis un téléphone. **Orchestrator.inc, Shuriken**.
8. Ouvrir les sessions filles pour comprendre leurs décisions et leur état. **Devin**.
9. Synthétiser ce qui a avancé pendant une séquence de travail. **VibeiDE Standup, Linear**.
10. Afficher ensemble tickets, exécutions et artefacts pour reconstituer le fil du travail. **Spaces, Multica**.

### 10 · Qualité, tests et merge

1. Préparer un commit, une branche et une PR ou MR avec description. **GitHub Copilot, Vibe Kanban, Kiro**.
2. Afficher le diff et donner un retour en ligne à l’agent. **Vibe Kanban, Linear**.
3. Vérifier les critères de la tâche dans la revue de PR. **Rovo Dev, Spaces**.
4. Lancer build, lint et tests avant d’accepter le résultat. **Intent, Factory**.
5. Détecter des zones de couverture manquantes à partir du diff. **Trellis Builders**.
6. Exercer un parcours dans le navigateur et produire des captures. **Spaces, Cursor, Antigravity**.
7. Produire un rapport de vérification retraçant les critères et leurs preuves. **Spaces, Symphony**.
8. Renvoyer automatiquement à l’agent concerné les échecs de CI et retours de revue. **Orchestrator.inc**.
9. Traiter les conflits de merge et réévaluer la PR après correction. **Orchestrator.inc**.
10. Attendre l’acceptation ou les conditions du dépôt avant l’intégration. **Symphony, GitHub Copilot**.

### 11 · Livraison et fonctionnement en production

1. Préparer des PR empilées quand les chantiers dépendent les uns des autres. **Spaces**.
2. Regrouper et coordonner plusieurs services ou pipelines lors d’une release. **Harness**.
3. Introduire des approbations avant une étape de déploiement. **Harness**.
4. Suivre les statuts et les échecs de déploiement. **Harness**.
5. Vérifier les signaux après mise en service. **Harness**.
6. Déclencher un rollback à partir du workflow de livraison. **Harness**.
7. Trier des incidents ou alertes en tenant compte du contexte de l’ingénierie. **OpenHands, Sentry Seer**.
8. Identifier une cause racine et préparer un plan de correction. **Sentry Seer**.
9. Choisir jusqu’à quelle étape un agent de production peut aller avant un accord. **Sentry Seer**.
10. Itérer sur la PR de correction avec le feedback des équipes. **Sentry Seer**.

### 12 · Intégrations, gouvernance et coûts

1. Connecter un tracker externe pour lancer ou contextualiser l’exécution. **Linear, Tembo, Spaces**.
2. Donner aux agents un accès à des données et outils via MCP. **Linear, Kiro, Paradev**.
3. Piloter les agents et suivre les résultats via une API ou CLI. **Multica, OpenHands, Paradev**.
4. Enregistrer les décisions directement dans des fichiers locaux lisibles. **Backlog.md**.
5. Exporter les données ou transférer un espace d’exécution. **Vibe Kanban, Backlog.md, Conductor**.
6. Définir des rôles, périmètres d’accès et permissions d’agent. **Multica, Claude Code, Tessl**.
7. Appliquer des budgets aux agents. **Paperclip**.
8. Mesurer les coûts par exécution, agent, étape ou projet selon le produit. **Spaces, Multica**.
9. Inspecter les traces et les demandes d’approbation. **Spaces, OpenSymphony**.
10. Versionner, distribuer, évaluer puis retirer ou restaurer des extensions d’agent. **Tessl**.

## Ce que cela donne pour Crewdeck

Les notes Crewdeck du 8 novembre décrivaient un Projet GitHub et un Process **Idée → Conception → Tickets → Boucle**. La direction plus récente fait du choix des outils une décision par brique. Les trois scénarios ci-dessous traduisent ce changement en tests produit.

| Scénario | Outils les plus utiles pour comparer | Point à vérifier dans Crewdeck |
| --- | --- | --- |
| **Projet entièrement local** | Backlog.md pour tâches, décisions et docs Markdown. Emdash ou Orchestrator.inc pour l’exécution locale. Intent pour une spec vivante et un navigateur. | Créer une idée, la valider, obtenir des tickets et modifier le code. Ouvrir une prévisualisation sur le poste, présenter les tests et accepter le changement localement, avec un historique qu’on peut relire depuis les fichiers. |
| **Projet avec GitHub + Jira + Confluence** | Spaces pour la combinaison et la traçabilité des étapes. Jira + Rovo Dev pour les critères liés à la PR. OpenSymphony pour les dépendances entre dépôts. | Garder le ticket Jira, la spec Confluence et la PR GitHub reliés. Ajouter une copie vers Obsidian ou un dossier Markdown et une étape de déploiement Docker sur le serveur choisi. Le Process doit montrer où se trouve chaque livrable et quelle révision a été validée. |
| **Passage progressif du local aux outils connectés** | Backlog.md pour les artefacts portables. Multica pour changer le workflow d’un projet. GitLab et n8n pour la composition du flux. | Connecter d’abord GitHub pour le code, puis Jira pour les futurs tickets, tout en gardant les références aux décisions et tickets locaux. Définir explicitement la source de référence, le sens de synchronisation, l’identité du livrable et le traitement d’un conflit. |

### Les éléments qui se recoupent déjà

| Élément Crewdeck | Équivalents observés | Conséquence |
| --- | --- | --- |
| Plusieurs agents pilotés depuis la même interface | Paradev, Orchestrator.inc, T3 Code, Emdash, Shuriken | Le choix Claude Code/Codex, le chat et les worktrees sont largement couverts. |
| Planification, implémentation et vérification séparées | Intent, Factory, Spaces | La valeur dépend de la qualité des transferts entre étapes et de ce que l’utilisateur peut corriger avant exécution. |
| Étapes modifiables avec transfert humain ou agent | Multica, GitLab, n8n | Un canvas doit aider à comprendre l’état du projet, l’autorité de chaque outil et les prochains points de décision. |
| Décisions centralisées | Multica Inbox, demandes d’accord Spaces, alertes Orchestrator.inc | Une approbation Crewdeck devient plus substantielle si elle montre la décision, la révision concernée, ses preuves, le responsable et les étapes affectées. |
| Gestion locale de la documentation et des tickets | Backlog.md, OpenSpec, Trellis de Mindfold | Un parcours local doit rendre ses fichiers relisibles et réutilisables avec les outils habituels du développeur. |
| Extensibilité | Catalogues de flux GitLab, registre Tessl, intégrations Linear | L’hypothèse propre au Skin SDK serait de changer la présentation et les interactions tout en conservant le même Process. La couverture de cette combinaison n’a pas été établie dans l’échantillon. |

### Ordre de comparaison pratique

1. **Multica pour le Process configurable.** Créer des étapes Conception, Développement et Revue, attribuer chacune à un humain ou un agent, puis rejeter une sortie et observer le retour et le contexte conservé.
2. **Spaces pour la chaîne complète.** Suivre un ticket jusqu’à la livraison et ouvrir chaque artefact, relever où se trouvent les sources de référence et à quel moment GitHub devient nécessaire.
3. **Backlog.md pour le tout-local.** Créer des tickets et une décision dans un dossier, puis faire lire ces fichiers par deux agents différents. Vérifier la continuité après transfert du dossier.
4. **Intent ou Factory pour la vérification.** Partir d’une petite évolution avec trois critères observables et vérifier ce que le superviseur produit comme preuve. Intent est proposé sur macOS au moment de l’étude.
5. **OpenSymphony et Orchestrator.inc pour la Boucle.** Comparer le traitement d’un blocage entre dépôts, d’un test rouge et d’un commentaire de revue. Vérifier que le retour arrive sur la bonne tâche, au bon agent, avec le contexte nécessaire.

Le test qui tranche le mieux pour Crewdeck tient en une question. **Peut-on suivre une même idée, ses décisions et ses preuves depuis des fichiers locaux jusqu’à une pile d’outils connectés, en changeant une brique à la fois ?** Les outils étudiés couvrent plusieurs morceaux de ce parcours. La combinaison exacte de gestion des références par brique, de migration progressive et de validations traçables reste une hypothèse à tester.

