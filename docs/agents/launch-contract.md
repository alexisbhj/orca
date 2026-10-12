# Contrat de lancement — capacités hôte GitHub Tree

## Run autorisé — 9 octobre 2026

L'utilisateur a déclenché l'implémentation du parent #1, dans l'ordre H1 → H2 → H3 → H4, sans développement du plugin. Les restrictions de la préparation ci-dessous sont historiques ; le présent run autorise branches, worktrees, auteurs, contrôles, commits, push et l'unique PR parent, sans merge automatique.

Branche d'intégration : `codex/github-tree-host-capabilities`, cible `origin/main` du fork. Base récupérée au lancement : `bd85767ee7b5a3e65b9835ada9fadf288757bd12`, identique au checkout initial. Les ajouts locaux au contrat sont conservés et versionnés sur cette base avant délégation.

Le prérequis Electron est résolu : skill source `vercel-labs/agent-browser`, `skill-data/electron/SKILL.md`, installée dans `~/.agents/skills/electron/`, exposée par liens dans `~/.codex/skills/` et `~/.claude/skills/`. Son parcours CDP a été lu. Les consignes Orca priment sur ses exemples génériques : profil dédié ci-dessous, `ORCA_BACKGROUND_LAUNCH=1`, Playwright CDP sur renderers cachés, aucune activation ni fenêtre révélée, aucun arrêt de l'application installée de l'utilisateur.

## Autorisation et base

La préparation du 9 octobre 2026 couvre seulement documentation, activation des Issues du fork, parent, quatre enfants et relations natives. Aucun code, test, build, application, auteur, branche, worktree, PR, commit ou push n'est autorisé pendant cette préparation. Aucun changement upstream ni dans le backlog plugin, aucun message à un autre chat.

Cible : `alexisbhj/orca:main`, remote `origin`. Au contrôle, HEAD de `feat/plugin-panel-own-command` et `origin/main` fraîchement récupéré valent `bd85767ee7b5a3e65b9835ada9fadf288757bd12`. Aucun commit de différence, aucun patch H1 : le nom de branche ne prouve aucune capacité. Les consignes upstream de cette base restent applicables.

Avant le futur lancement, synchroniser sur la base cible les documents locaux : `AGENTS.md`, `CLAUDE.md`, `.gitignore`, `docs/agents/issue-tracker.md`, `triage-labels.md`, `domain.md`, `launch-contract.md`. Les modifications antérieures de `.gitignore`, `CLAUDE.md` et des trois documents agents sont conservées. Rien n'est committé/poussé ici. Récupérer à nouveau `origin/main`, comparer les consignes et contrats de la branche avec cette base, résoudre les écarts sans écraser le travail local. Ne pas déléguer sur une base dépourvue de ce contrat.

## Skills et validation disponibles

- Orchestrateur exact : `/Users/alexisbuhaj/.agents/skills/implement-spec/SKILL.md`, lu sans exécution. Ne pas le remplacer par une version générique.
- Auteur installé : `/Users/alexisbuhaj/.codex/plugins/cache/mattpocock/mattpocock-skills/1.3.1/skills/engineering/implement/SKILL.md`. Absent du catalogue de cette session ; fournir ce chemin au futur auteur avec sa tâche minimale, vérifier son existence avant délégation. Aucun agent lancé pour tester la découverte.
- Publication/découpage : `engineering/to-spec/SKILL.md` et `engineering/to-tickets/SKILL.md` dans cette même installation ; conception et découpage déjà validés par le brief.
- Review installée : `engineering/code-review/SKILL.md` dans cette installation ; deux contextes indépendants Standards/Spec. Les reviews de chaque enfant prescrites par `implement` restent obligatoires, sans exemption implicite.
- **Bloquant avant lancement déclaré prêt : skill `electron` introuvable** dans les catalogues et racines locales examinées (`~/.agents/skills`, `~/.codex/skills`, caches plugins et skills Claude). La rendre disponible et lire son parcours Playwright CDP avant toute validation UI ; ne pas substituer computer-use. Les bibliothèques présentes ne prouvent pas la disponibilité de la skill.

## Livraison future

Seulement après instruction séparée : réutiliser ou créer depuis la base synchronisée une branche d'intégration `codex/…`. Publier son pointeur sur le parent avant les auteurs si nécessaire. Une seule PR parent vers le `main` du fork ; ouvrir son draft après le premier commit intégré/poussé. Aucune PR par enfant. Les auteurs découvrent le contexte d'intégration via parent/PR et appliquent `implement` et les consignes du dépôt ; leurs éventuelles branches/worktrees temporaires relèvent du futur run.

Ordre par défaut : H1, H2, H3, puis H4. H1/H2/H3 n'ont aucun bloqueur métier l'un vers l'autre ; H4 est bloqué nativement par les trois. Les tickets du plugin consomment ces capacités et ne sont jamais des prérequis d'Orca. H1 et toutes les preuves hôte utilisent une fixture minimale du fork, sans plugin final.

Un auteur frais à la fois, tâche minimale `implement <référence complète du ticket>` avec chemin installé uniquement si sa découverte manque. Le parent orchestre, n'implémente pas. Vérification manquante déléguée à un contexte frais avec ticket, SHA et pointeurs de preuves. Review indépendante ciblée avant intégration pour consentement, identité, exécution et effets durables. Vérifier chaque critère, intégrer le commit contrôlé, pousser et attendre les contrôles requis sur le SHA intégré exact avant l'enfant suivant. Contrôle requis absent/en échec/indisponible, preuve manquante ou capacité non vérifiable : arrêt de la file.

## Fermeture des enfants et parent

Après intégration poussée, critères prouvés et contrôles requis réussis sur ce SHA, commenter puis fermer l'enfant `completed` pour résoudre ses dépendances natives. Commentaire obligatoire : « intégré sur la branche d'intégration, non livré sur main », SHA complet, branche/PR parent, verdict par critères et liens vers preuves/contrôles. Réouvrir et arrêter les descendants si l'intégration est retirée ou sa preuve invalidée.

Aucune fermeture pendant la préparation. Recharger la liste complète des enfants et bloqueurs après chaque intégration et avant livraison. Ne pas mettre `Closes`/`Fixes` pour les enfants dans la PR ; seul le parent peut être fermé par le merge humain. Le parent reste ouvert jusque-là.

Une fois code et preuves finalisés, déléguer les vérifications intégrées puis la review indépendante Standards/Spec de tout le diff avec HEAD et base figés. Renouveler les preuves/reviews affectées après toute correction ou changement de HEAD/base, y compris documentaire. PR ready uniquement après tous critères, CI exacte et reviews satisfaits ; validation finale et merge humains. Respecter le template upstream, notamment preuves visuelles avant/après jointes sans committer les captures dans la PR, et bilan sécurité, plateformes, SSH, agents, intégrations, performance et UI.

## Contrôles futurs, non exécutés pendant la préparation

Scripts effectivement présents : `pnpm tc`, `pnpm run check:code-quality:changed`, `pnpm test <suites pertinentes>`. Avant livraison, exigences complètes du guide : `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, et contrôles CI applicables. Ne pas prendre la présence des workflows pour une preuve de CI verte. Si modification des sessions Claude structurées, exécuter les deux suites CLI réelles prescrites par AGENTS.md.

Tous tests/apps avec `ORCA_BACKGROUND_LAUNCH=1`. UI : Electron + Playwright CDP sur renderers cachés ; aucune activation/fenêtre révélée, tests de focus natif sur display isolé ou CI. Reconstruire toute politique de lancement modifiée avant usage. Vérifier clair/sombre, raccourcis/plateformes et latence SSH. Réutiliser les suites panneau/session/worker, layout/panneaux, CLI terminal, lancement natif, reçus/retry et compatibilité des pairs.

Préserver plateformes macOS/Linux/Windows, SSH, folder workspaces, Git 2.25 et fournisseurs Git supportés ; l'hôte d'exécution reste propriétaire des effets et du statut agent natif. Perte de contact : `unverifiable`, jamais preuve de `exited`. Compatibilité clients/hôtes mixtes, champs optionnels et négociation des capacités ; aucun nouvel opcode non négocié ni launcher/store de statut parallèle.

## Toolchain et profil dédiés

Référence locale : `../orca-github-tree/docs/DEMARRAGE.md` depuis la racine du checkout. Toolchain préparée : `/Users/alexisbuhaj/.local/share/orca-github-tree-toolchain/node_modules/.bin` (Node 24.21.0, pnpm 12.8.1, Bun 1.4.2), à remettre dans PATH pour ce checkout uniquement et à revalider contre les pins courants. Ne pas changer les versions globales.

Profil obligatoire : `/Users/alexisbuhaj/Library/Application Support/orca-github-tree-dev`, via `ORCA_DEV_USER_DATA_PATH` pour app ET wrapper CLI. Conserver l'application installée et ses données. Commandes futures, à adapter au checkout d'intégration effectif :

```sh
export PATH="/Users/alexisbuhaj/.local/share/orca-github-tree-toolchain/node_modules/.bin:$PATH"
export ORCA_BACKGROUND_LAUNCH=1
export ORCA_DEV_USER_DATA_PATH="/Users/alexisbuhaj/Library/Application Support/orca-github-tree-dev"
pnpm build
pnpm dev
# Dans un autre processus, même environnement et checkout :
node config/scripts/orca-dev.mjs --help
```

Ne jamais supposer que la CLI globale cible ce build. Le build CLI peut préparer un lien global : ne pas écraser de lien existant ni utiliser sudo automatiquement ; utiliser le wrapper du checkout. `pnpm install:release` avant packaging multi-architecture. H4 doit identifier SHA, artefact, profil et invocation exacte sans exposer les secrets runtime, vérifier l'isolation puis démontrer H1/H2/H3 via fixture hôte. Merge humain et disponibilité effective du bon build sont deux étapes différentes.

## Points de réutilisation contrôlés à la préparation

- H1 : contrat `src/shared/plugins/plugin-host-api.ts`, pont/session/CSP `plugin-panel-bridge.ts`, `plugin-panel-shell.ts`, contrôleur `src/main/plugins/plugin-panel-controller.ts`, dispatcher `plugin-service.ts` et transports existants. Budgets 64 KiB, 30 messages/10 s ; activation 10 s, invocation 30 s. Aucun `invokeOwnCommand` public trouvé.
- H2 : montage actuel dans la zone droite, store `src/renderer/src/store/plugin-panels.ts`, disposition et cycle de vie existants ; ajouter une capacité générique et garder le défaut actuel.
- H3 : `src/cli/specs/core.ts` expose actuellement `terminal create` sans agent/modèle/réflexion typés ; `src/shared/rpc-contract/agent-launch-params.ts` possède options et identité d'opération mais laisse l'hôte choisir terminal/structuré. Réutiliser le plan natif, catalogue, identité et reçus ; `src/cli/specs/terminal-send.ts` documente déjà `--retry-request` et la différence acceptation/soumission. Étendre les lacunes, sans promesse de disponibilité avant les tests.

Aucun prérequis entre H1/H2/H3 identifié dans ces frontières ; tout nouveau vrai bloqueur découvert au futur run doit être justifié par les sources et ajouté nativement, jamais inventé pour imposer l'ordre par défaut.

## Backlog préparé

Parent : https://github.com/alexisbhj/orca/issues/1. Ordre : H1 https://github.com/alexisbhj/orca/issues/2, H2 https://github.com/alexisbhj/orca/issues/3, H3 https://github.com/alexisbhj/orca/issues/4, H4 https://github.com/alexisbhj/orca/issues/5. Quatre sous-issues natives ; H4 bloqué par H1/H2/H3 uniquement. Tous restent ouverts. Les Issues du fork ont été activées avec autorisation ; aucun changement upstream.

Consommateurs : https://github.com/alexisbhj/orca-github-tree/issues/1 et https://github.com/alexisbhj/orca-github-tree/issues/2 (attend H1), jamais prérequis bloquants d'Orca. Leur backlog n'est pas modifié ici.

Message futur exact, à ne pas exécuter pendant la préparation :

> Utilise ma skill personnelle `/Users/alexisbuhaj/.agents/skills/implement-spec/SKILL.md` pour implémenter https://github.com/alexisbhj/orca/issues/1 selon les consignes upstream et le contrat local : une branche d’intégration et une seule PR parent vers le main du fork `alexisbhj/orca`. Commence par H1 ; aucun développement du plugin dans ce run.

Contrôle après publication : corps GitHub relus et comparés aux brouillons, quatre enfants dans l'ordre H1/H2/H3/H4, trois bloqueurs H4 et aucun autre, labels et cinq états ouverts confirmés. Aucun chemin privé ni contenu client dans les corps publiés. HEAD et origin/main inchangés ; vérification documentaire `git diff --check` réussie, aucun contrôle produit exécuté.
