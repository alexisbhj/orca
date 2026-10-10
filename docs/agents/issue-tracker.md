# Issue tracker: GitHub

Issues and specs live in `alexisbhj/orca`.
Always pass `--repo alexisbhj/orca` to gh: the clone also has an upstream remote.

## Conventions

- Create: `gh issue create --repo alexisbhj/orca --title "..." --body-file <file>`.
- Read: `gh issue view <number> --repo alexisbhj/orca --json number,title,body,labels,comments`.
- List: `gh issue list --repo alexisbhj/orca --state open --limit 100`.
- Comment: `gh issue comment <number> --repo alexisbhj/orca --body-file <file>`.
- Labels: `gh issue edit <number> --repo alexisbhj/orca --add-label "..."` or `--remove-label "..."`.
- Close: `gh issue close <number> --repo alexisbhj/orca`.
- Native parent: `gh issue edit <child> --repo alexisbhj/orca --parent <parent>`.
- Native blocker: `gh issue edit <child> --repo alexisbhj/orca --add-blocked-by <blocker>`.
- Verify: `gh issue view <number> --repo alexisbhj/orca --json number,state,parent,subIssues,blockedBy,blocking`.
- Create children in launch order, then verify the complete ordered child list and relation counts. Paginate if returned nodes are fewer than totalCount.
- Text references explain relations; they never replace native sub-issues or blockers. A failed native write blocks preparation until resolved.
- `gh repo view/edit` do not accept `--repo`: pass the explicit positional repository `alexisbhj/orca`. Never rely on remote inference.

Publishing to the issue tracker means creating a GitHub issue.
Fetching a ticket means reading its GitHub issue.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## Spec delivery

Read [launch-contract.md](launch-contract.md) before starting a spec. One integration branch and one parent PR target `alexisbhj/orca:main`; no child PRs. Native blockers gate scheduling. Child completion means verified integration on the pushed integration branch, not delivery on main. The parent stays open until human merge. The launch contract defines evidence, independent reviews and closure comments.
