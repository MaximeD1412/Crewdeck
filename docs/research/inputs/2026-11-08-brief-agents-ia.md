# Crewdeck — Brief de conception : intégration Claude Code et Codex

**Destinataire :** agent responsable de la conception de Crewdeck  
**Date de référence :** 8 novembre 2026  
**Objet :** analyser l'intégration de moteurs d'agents dans Crewdeck, la configuration des modèles par rôle et la viabilité d'un usage commercial avec les abonnements personnels des Pilotes.  
**Statut :** document de discussion et de cadrage, **pas** une décision d'architecture ni un avis juridique.

> **Consigne à l'agent :** lis ce document à la lumière de l'architecture et du code existants. **N'implémente rien pour l'instant.** Distingue les faits observés dans le projet, les faits documentés par les fournisseurs, les hypothèses et les questions ouvertes. Réponds aux questions en fin de document, puis propose des choix argumentés, avec les conséquences pour le MVP et pour une commercialisation.

## 1. Rappel de ce qu'est Crewdeck

Crewdeck est un produit web commercial dans lequel un **Pilote** conduit un ou plusieurs **Projets** (un Projet correspond à un repository GitHub), du début à la fin du **Process** : **Idée → Conception → Tickets → Boucle**.

- Le **Process** est la séquence d'étapes commune à tous les Pilotes ; les validations restent entre leurs mains.
- Une **Conception** produit notamment un PRD, des maquettes et une conception technique, approuvés par le Pilote.
- Un **Ticket** correspond à une unité d'implémentation suivie dans GitHub et livrée dans une PR revue.
- La **Boucle** prend les Tickets prêts, un par un, et fait travailler les agents sur le **Runner** jusqu'à épuisement des Tickets ou arrêt du Pilote.
- Les **Décisions** (approbations, blocages, Runner hors ligne, etc.) sont centralisées dans **« À toi »**.
- Le **Runner** est le programme **local**, installé sur la machine du Pilote, lié à son compte. Il exécute les agents avec les comptes IA du Pilote. Ce n'est pas un serveur mutualisé d'inférence Crewdeck.
- Le **Skin** est une interface complète bâtie sur les états et actions du SDK de Crewdeck ; un **Thème** ne change que les couleurs et les polices du Skin par défaut.
- Les **Actions sensibles** (merge, démarrage de la Boucle, approbation de Conception, etc.) restent validées par les mécanismes propres au produit, jamais par le seul Skin.
- La **Resynchronisation** reconstruit l'état après une perte de connexion.

**Valeur commerciale de Crewdeck :** l'orchestration du Process, la visibilité en temps réel, les Décisions, la coordination des agents, l'intégration GitHub et les Skins — **pas** la revente de quotas Claude ou ChatGPT.

## 2. Objectif produit à confirmer

L'objectif n'est pas d'ouvrir un terminal Claude Code ou Codex à côté de Crewdeck. Le Pilote doit pouvoir travailler **entièrement dans l'application**, avec une expérience intégrée et cohérente :

1. Connecter/configurer son **compte Claude**, son **compte ChatGPT/Codex**, ou les deux.
2. Voir les moteurs et modèles effectivement utilisables selon ses connexions et leurs capacités.
3. Définir des affectations **par rôle**, au minimum : **Conception**, **Code**, **Review** ; préciser si **analyse d'Idée** et d'autres opérations nécessitent un rôle distinct.
4. Par exemple : Claude pour la Conception, Codex pour le Code, Claude pour la Review — ou toute autre combinaison permise.
5. Lancer, suivre, interrompre et reprendre les conversations et opérations des agents **depuis un Skin**, avec streaming des messages, appels d'outils, modifications de fichiers, demandes d'autorisation et état d'avancement.
6. Exécuter effectivement les opérations sur le **Runner local** du Pilote, en utilisant **ses propres droits/abonnements**, et non une session globale Crewdeck.
7. Permettre la Boucle automatisée avec autorisation explicite et maintien des validations humaines aux gates du Process.

**Situation actuelle connue :** l'implémentation Claude vise le **cas B : intégration du Claude Agent SDK dans le Runner** pour conserver l'expérience dans Crewdeck, tout en faisant actuellement usage de l'abonnement personnel du fondateur. **Le mécanisme précis d'authentification et sa conformité commerciale n'ont pas été audités.** Ne pas supposer qu'un fonctionnement technique en usage personnel vaut autorisation de distribution commerciale.

## 3. Alerte conformité : Anthropic / Claude

### 3.1 Ce qui est documenté

- Anthropic indique que le **Claude Agent SDK** et `claude -p` peuvent, pour l'instant, consommer les limites de l'abonnement d'un utilisateur connecté. Cela décrit une capacité technique et une politique d'usage actuelle ; **cela n'accorde pas automatiquement à un éditeur tiers le droit de commercialiser cette intégration**.
- Sa documentation juridique dit que les **développeurs de produits tiers**, y compris ceux construisant avec l'**Agent SDK**, devraient utiliser une **authentification par clé API** (Claude Console ou fournisseur cloud compatible). Elle exclut l'offre, par ces développeurs tiers, d'un login Claude.ai propre à leur application et l'acheminement de requêtes via les identifiants d'abonnement des utilisateurs.
- Elle distingue l'usage d'un **binaire Claude Code non modifié**, auquel l'utilisateur final se connecte lui-même avec son abonnement. La fourniture de Claude Code dans un produit/service commercial est soumise aux conditions commerciales et à diverses restrictions (dont aucune modification du binaire, absence de revente/intermédiation de consommation et authentification propre à chaque utilisateur).
- Anthropic interdit aux développeurs tiers de collecter, stocker ou servir d'intermédiaire pour les identifiants et jetons de session Claude.ai ; l'authentification doit suivre le parcours Anthropic prévu.

**Conséquence pour Crewdeck :** l'architecture actuelle **Agent SDK + abonnement du Pilote** est un **point de blocage juridique potentiel pour la commercialisation**. Ne pas la classer « autorisée » sans confirmation écrite d'Anthropic, même si le Runner est local et chaque Pilote possède son abonnement.

### 3.2 Alternatives à comparer

| Option | Expérience intégrée | Abonnement Claude personnel | Enjeu principal |
|---|---|---|---|
| **C1. Agent SDK + authentification d'abonnement** (approche actuelle) | Oui | Techniquement possible aujourd'hui | **Autorisation commerciale incertaine** ; demander validation officielle |
| **C2. Exécution du binaire Claude Code officiel non modifié**, authentifié par le Pilote, avec pilotage/événements compatibles | À démontrer | Oui, dans les limites documentées | Vérifier les conditions commerciales, la frontière entre pilotage du binaire et intégration tierce, et les capacités réellement offertes |
| **C3. Agent SDK + clé API personnelle du Pilote** | Oui | Non : consommation API facturée à la clé du Pilote | Alternative commerciale à privilégier si C1 n'est pas autorisée |

**Question indispensable à Anthropic :** une application commerciale telle que Crewdeck, avec Runner installé **et exécuté localement** par chaque Pilote, peut-elle utiliser le **Claude Agent SDK avec l'authentification d'abonnement Claude de ce Pilote** ? Si non, est-ce qu'un binaire Claude Code officiel non modifié, piloté depuis une interface tierce, constitue une alternative conforme ? Selon quelles conditions/contrats ?

## 4. Alerte conformité : OpenAI / Codex

### 4.1 Interface technique recommandée à étudier

Pour une fenêtre intégrée, **Codex App Server** est une piste prioritaire, car il propose une interface protocolaire pour les conversations, le streaming et les approbations. La documentation décrit notamment :

- `thread/start`, `thread/resume`, `turn/start`, `turn/interrupt` ;
- notifications de messages, commandes, changements de fichiers et progression ;
- `model/list` pour alimenter la sélection de modèles (attention : **catalogue ≠ preuve d'accès effectif**) ;
- `review/start` pour lancer une review sur une branche, un commit ou des modifications ;
- demandes d'autorisation et réponse du client.

**Codex SDK** reste une solution potentielle pour des exécutions automatisées ciblées ; comparer les deux sans présumer qu'un seul outil doit couvrir tous les cas.

### 4.2 Point juridique central : authentification Codex

La documentation officielle Codex indique que **l'authentification native historique d'App Server n'a pas été autorisée pour les services commerciaux ou hébergés**. Le fait que le processus tourne localement ne constitue donc **pas** une permission commerciale implicite.

OpenAI a ouvert une autre voie : **Sign in with ChatGPT (SIWC)**, avec un périmètre d'usage de l'abonnement ChatGPT. Pour un produit commercial, l'accès est **actuellement réservé à un groupe sélectionné de partenaires / soumis à demande**. OpenAI décrit une intégration d'App Server alimentée par un jeton OAuth SIWC obtenu via son parcours officiel.

Les conditions SIWC imposent notamment :

- requêtes depuis le runtime local du Pilote ou depuis un environnement distant contrôlé **uniquement** par lui ;
- usage du forfait **pour ce Pilote uniquement**, sans mutualisation, partage ou contournement des limites ;
- **consentement explicite** pour les automatisations et tâches en arrière-plan (donc attention à la Boucle) ;
- utilisation liée à l'application connectée, pas une API générale ouverte à des tiers ;
- jetons persistants gardés **localement sous le contrôle de l'utilisateur**, non dans un environnement géré ou distant ;
- **accès à l'utilisation du forfait ChatGPT via SIWC sans paiement obligatoire à Crewdeck ni passage imposé à une offre payante** ; possibilité de monétiser des fonctionnalités distinctes, sous réserve d'interprétation et d'accord du fournisseur.

**Conséquence pour Crewdeck :** une intégration abonnement ChatGPT **ne doit pas être promise au lancement commercial** sans autorisation/accès SIWC adapté. Prévoir aussi un mode **clé API personnelle**, indépendant de SIWC.

### 4.3 Question indispensable à OpenAI

Un SaaS à abonnement pour l'orchestration du Process, mais doté d'un **Runner local** et d'un **mode gratuit permettant réellement d'utiliser son forfait ChatGPT**, peut-il proposer une fenêtre Codex intégrée via SIWC et App Server ? Quelles fonctionnalités doivent rester gratuites ? L'automatisation de la Boucle est-elle couverte si le Pilote donne une autorisation explicite et révocable ? Quel parcours d'enregistrement du client, d'authentification et de renouvellement des jetons est requis ?

## 5. Architecture candidate à évaluer, non à considérer comme décidée

```text
Pilote dans le Skin Crewdeck (web / mobile)
        │
        ├── Process / Décisions / Actions sensibles
        │
Backend Crewdeck (état et orchestration ; aucun token IA personnel)
        │ canal authentifié / événements
Runner LOCAL du Pilote
        │
        ├── Provider Claude
        │     ├── Agent SDK + clé API Pilote     [voie commerciale de repli]
        │     └── Abonnement / binaire officiel  [seulement si autorisé]
        │
        └── Provider Codex
              ├── App Server + clé API Pilote    [voie commerciale de repli]
              └── App Server + SIWC              [si accord commercial obtenu]
        │
Workspace Git local / tests / GitHub / PR
```

**Séparation souhaitée :** le **Process** demande une opération selon un rôle ; le **Runner** choisit et pilote le fournisseur ; le **Skin** rend les événements et présente les actions autorisées. Le Process ne doit pas être couplé à une marque ou à un modèle précis.

**À confirmer :** comment le backend et le Skin communiquent-ils réellement avec le Runner, quelle autorité chaque composant détient-il, quels flux sont conservés (données de Projet, prompts, logs d'outils, diffs, secrets), et quels mécanismes empêchent un Skin non fiable de lancer une opération non autorisée ?

## 6. Points de conception à instruire

### 6.1 Configuration des agents par rôle

- Prévoir une distinction entre **fournisseur**, **mode d'authentification** (`subscription` / `api_key` / autre mode autorisé), **moteur** (Agent SDK / binaire / App Server) et **modèle**. Un simple couple `{ provider, model }` serait probablement insuffisant.
- Profils minimaux : **Idée** (si distincte), **Conception**, **Code**, **Review**.
- Gérer les capacités du moteur : streaming, review native, outils, permissions, reprise, modèle/effort de raisonnement, exécution automatisée.
- Prévoir des dégradations explicites si un modèle disparaît, si l'accès est refusé, si les quotas sont épuisés, si le compte se déconnecte ou si le Runner est hors ligne.
- Préciser la priorité entre configuration globale du Pilote, configuration du Projet et éventuelle configuration temporaire d'un Ticket.

### 6.2 Conversation et événements unifiés

- Construire une **vue agent intégrée** commune, mais conserver dans l'adaptateur les événements spécifiques à chaque fournisseur.
- Normaliser a minima : messages incrémentaux, appels et résultats d'outils, commandes, fichiers modifiés, demandes d'approbation, état d'une exécution, erreur, annulation, fin, identifiants de session et corrélation Projet/Ticket.
- Ne pas déduire une reprise de session inter-fournisseurs : **une session Claude ne se reprend pas dans Codex**. Le passage Claude → Codex doit transmettre un **paquet de contexte** : Conception approuvée, Ticket, branche, diff, tests et résultats précédents.
- Ne pas exposer des chaînes de raisonnement privées ni supposer qu'elles sont disponibles. Afficher seulement les contenus et métadonnées que chaque outil expose légitimement.
- Examiner la reprise après redémarrage du Runner et la **Resynchronisation** du Skin.

### 6.3 Sécurité et contrôle

- Les abonnements, clés API et jetons doivent rester sous le contrôle du Pilote ; distinguer stockage local sûr et éventuel affichage distant d'événements expurgés.
- Un **Skin** ne peut pas contourner les **Actions sensibles** ni répondre silencieusement à des autorisations d'exécution sensibles.
- Le démarrage d'une **Boucle** nécessite le consentement du Pilote ; pour SIWC, cadrer explicitement l'autorisation de consommation en arrière-plan, sa portée et sa révocation.
- Définir les politiques de sandbox/permissions, les accès filesystem/réseau, la séparation entre Projets et les limites des commandes pouvant être exécutées.
- Éviter toute exposition non authentifiée du protocole local du Runner ou d'App Server (privilégier `stdio` ou une connexion locale verrouillée ; ne pas exposer de port sur Internet par défaut).
- Traiter les secrets potentiels dans les logs, les diffs, les commandes, les prompts, les pièces jointes et la télémétrie.

### 6.4 Exploitation et modèle économique

- Le coût d'inférence est assumé par le compte/abonnement/clé du Pilote ; Crewdeck facture sa **valeur d'orchestration**, pas des quotas IA revendus.
- Pour **SIWC**, vérifier concrètement quelle expérience gratuite est nécessaire pour respecter la clause **« no charge »** ; ne pas présumer qu'un simple bouton « Connecter ChatGPT » gratuit suffit si l'exécution utile est payante.
- Prévoir une stratégie si l'accès commercial SIWC est refusé ou retardé, si Anthropic refuse l'utilisation commerciale SDK + abonnement, ou si les conditions changent.
- Définir les messages UX pour les limites et les conséquences sur un Ticket en cours de Boucle.

## 7. Questions précises auxquelles l'agent de conception doit répondre

### Audit de l'existant — avec preuves dans le code

1. **Comment Claude est-il intégré aujourd'hui ?** Packages utilisés et versions, processus démarrés, orchestration SDK, mécanisme d'authentification, provenance des jetons, stockage, sous-processus et flux d'événements. Donne les fichiers, modules et fonctions pertinents.
2. Utilise-t-on le **binaire Claude Code non modifié** sous le capot ? Est-ce que Crewdeck initie ou relaie lui-même une authentification par abonnement ? Les jetons passent-ils par le backend ? **Signale tout écart** avec les textes Anthropic.
3. Comment la configuration des agents, les conversations, l'état d'exécution et le Runner sont-ils déjà représentés ? Quelles abstractions peut-on réutiliser plutôt que reconstruire ?

### Choix techniques

4. Pour une fenêtre Codex intégrée, recommandes-tu **App Server**, **Codex SDK**, une combinaison, ou une autre interface officielle ? Pourquoi ? Quelles capacités font défaut ou sont expérimentales ?
5. Quel contrat d'**adaptateur agent** proposes-tu (modèles, capacités, exécutions, événements, permissions, reprise, erreurs) sans sacrifier les possibilités propres à Claude et à Codex ?
6. Comment configurer **Conception / Code / Review** et éventuellement Idée par Pilote et par Projet ? Comment récupérer un catalogue de modèles **sans confondre catalogue et éligibilité réelle** ?
7. Comment garantir une **Review indépendante** du codeur, et comment transmettre proprement le contexte entre agents de fournisseurs différents ?
8. Quelles données restent **strictement locales**, lesquelles remontent au backend et lesquelles sont exposées au Skin ? Comment sécuriser les secrets et les Actions sensibles ?
9. Comment fonctionnent **interruption, reprise, perte du Runner, Resynchronisation, épuisement de quotas et changement de moteur** au milieu d'un Ticket ?

### Conformité et lancement

10. Dresse une **matrice par fournisseur et mode d'authentification** : techniquement faisable, autorisation commerciale documentée, besoin d'accord explicite, contraintes UX, risques et fallback.
11. Quel est le **MVP commercial minimal juridiquement prudent** si nous n'obtenons **ni** la confirmation Anthropic SDK + abonnement **ni** l'accès partenaire SIWC OpenAI ? Le mode **BYO API key** suffit-il pour conserver une bonne expérience ?
12. Quelles questions exactes envoyer **à Anthropic** et **à OpenAI** pour obtenir une position écrite sur **notre architecture précise**, sans ambiguïté ?
13. Comment concevoir le **gratuit/premium** pour SIWC sans faire payer l'accès aux quotas ChatGPT eux-mêmes ? Présente au moins deux scénarios et leurs incertitudes.
14. Quelles décisions sont **réversibles** et lesquelles risquent d'enfermer Crewdeck dans une seule technologie ou une interprétation juridique incertaine ?

## 8. Livrable attendu de l'agent

Produis **une note de décision**, pas encore du code, avec :

1. **Constat de l'existant**, avec références aux fichiers/classes/services du projet et niveau de certitude.
2. **Matrice Claude/Codex × abonnement/API × intégration technique × statut commercial**, distinguant *documenté*, *interprétation* et *à confirmer auprès du fournisseur*.
3. **Architecture cible** et frontières de responsabilité entre Process, Runner, adaptateurs agents, backend et Skin, avec un schéma simple.
4. **Proposition de schéma de configuration** et de **contrat d'événements**, seulement au niveau de la conception.
5. **Risques classés** (bloquants avant vente / importants / améliorations ultérieures).
6. **Plan de mise en œuvre progressif** : ce qui peut être développé immédiatement sans risque commercial, ce qui reste derrière un feature flag et ce qui requiert une autorisation écrite.
7. **Questions à poser au fondateur** uniquement si elles conditionnent réellement une décision ; sinon propose une recommandation argumentée.

**Ne valide pas a priori le cas Claude SDK + abonnement, ni l'authentification native Codex App Server dans un produit commercial.** La capacité technique actuelle n'est pas une preuve d'autorisation contractuelle.

## 9. Documentation officielle à consulter et à re-vérifier

Documents consultés pour ce brief au **8 novembre 2026** ; leurs termes peuvent évoluer. Pour tout lancement, confirmer la version en vigueur et conserver une trace des réponses contractuelles reçues.

### Anthropic

1. Claude Code — *Legal and compliance* (voir en particulier « Can customers offer Claude Code in their products? » et « Authentication and credential use ») :  
   https://code.claude.com/docs/en/legal-and-compliance
2. Claude Help Center — *Use the Claude Agent SDK with your Claude plan* (mises à jour des 15 juin et 7 octobre 2026) :  
   https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan
3. Claude Agent SDK — documentation :  
   https://platform.claude.com/docs/en/agent-sdk/overview

### OpenAI

4. *Sign in with ChatGPT Terms* (en vigueur depuis le **4 novembre 2026**, notamment la section 3.1 « ChatGPT plan usage ») :  
   https://openai.com/policies/sign-in-with-chatgpt-terms/
5. Codex — *App Server* (intégration et mise en garde sur l'authentification pour les services commerciaux) :  
   https://learn.chatgpt.com/docs/app-server
6. *Sign in with ChatGPT — Codex app-server* (jetons OAuth SIWC, configuration et catalogue de modèles) :  
   https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server
7. *Request a client ID* (accès commercial SIWC sur sélection) :  
   https://developers.openai.com/siwc/request-client-id
8. OpenAI Developers — *Codex as a platform* (comparaison SDK/App Server) :  
   https://developers.openai.com/blog/codex-as-a-platform

---

**Question de fond :** comment construire **une expérience Crewdeck unifiée, configurable par rôle, avec des agents exécutés sur le Runner local et financés par les comptes du Pilote**, tout en disposant d'une **voie de commercialisation autorisée même si Anthropic et OpenAI refusent ou limitent les intégrations par abonnement personnel** ?
