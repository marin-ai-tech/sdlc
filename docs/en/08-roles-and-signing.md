# 8. Roles, separation of duties and signed approvals

A gate approval is only worth something if the right person gave it. Since 0.6.0, sdlc can tie approvals to people named in a file that lives in git, refuse approvals that break separation of duties, and check that each approval arrived in a commit signed by the person who gave it.

Without `openspec/roles.yaml`, nothing changes: the `roles:` allow-lists in `openspec/sdlc.yaml` apply as before.

## 8.1. `openspec/roles.yaml`

Since 0.16.1, a person can run `sdlc init --roles` to create a starter file from the current git identity.
That identity holds every role until the team edits the file. An existing file is kept; text and JSON report
whether it was created or kept. In an agent session the CLI refuses with `agent_cannot_edit_roles`, and the hook
denies the command, as it does `sdlc roles migrate`.

```yaml
version: 1
signing: warn                 # off | warn | required
people:
  alice: { name: Alice Walker, emails: [alice@corp.example], signing_key: "ssh-ed25519 AAAA… alice@corp" }
  bob:   { name: Bob Turner,   emails: [bob@corp.example],   signing_key: "ssh-ed25519 AAAA… bob@corp" }
  carol: { name: Carol Hughes, emails: [carol@corp.example], handles: [carol-s] }
roles:
  product-owner: [alice]
  release-manager: [alice]
  maintainer: [alice]         # may change this file
  engineer: [bob, carol]
  tech-lead: [bob]
  code-owner: [bob, carol]
separation:
  author_cannot_approve: [review, release]
  distinct_approvers: [[spec, review], [plan, review]]
  max_gates_per_person: 3
```

- **people**: a stable id, a name, one or more emails (matched case-insensitively), and optionally the public SSH key the person signs commits with. An email belongs to one person only.
- Since 0.16.2, `handles` lists GitHub personal handles, with or without `@` and matched case-insensitively.
  CODEOWNERS `@carol-s` then resolves to Carol in `sdlc review suggest` and the adoption draft. A handle equal
  to the person id also matches. Team handles such as `org/team` are refused. `sdlc adopt` text and JSON both
  list handles it could not resolve.
- **roles**: role names from the gates in `sdlc.yaml` (`approvers`, `high_risk_approvers`) and the people who hold them. `maintainer` is the role that may change this file.
- **separation** (the defaults are shown):
  - `author_cannot_approve`: gates the authors of the change's code may not approve. Authors are the commit authors and `Co-authored-by` trailers on the branch since the review base, counting only files outside `openspec/`.
  - `distinct_approvers`: pairs of gates that need two different people.
  - `max_gates_per_person`: how many gates of one change one person may approve (0 = no limit).

Agents cannot edit the file: the guard of every supported tool (the hooks, or the OpenCode plugin) denies writes to it,
like `.sdlc.yaml`.

## 8.2. What `sdlc approve` checks

With the file present, `sdlc approve <gate> --change <id>`:

1. Identifies the person by the git identity's email. An unknown email is refused (`unknown_person`). `--by` may only repeat the same email (`by_mismatch` otherwise). The record keeps `by: Name <email>` and adds `person: <id>`.
2. Requires a role the gate accepts (`missing_role` names the people who hold it).
3. Applies the separation rules (`author_cannot_approve`, `distinct_approvers`, `max_gates_per_person`) against the approvals already recorded in the change.

`reject` and `waive` check the person and the role, not the separation rules.

Ask before trying:

```bash
sdlc roles who review --change add-calc      # who may approve, and why the others may not
sdlc roles check --change add-calc           # the same for every gate
sdlc roles check                             # people and their roles
```

Move from the allow-lists in `sdlc.yaml` with `sdlc roles migrate` (a person runs it; it writes `roles.yaml` with `signing: off` and the default separation, and never overwrites an existing file).

## 8.3. Signed approvals

A git email is easy to fake. Signing closes that gap: every approval must arrive in a commit signed by the key of the person who approved, and every change to `roles.yaml` must be signed by a maintainer.

| Mode | `sdlc approvals verify` |
|---|---|
| `off` | checks nothing (the mode without signatures) |
| `warn` | reports problems, exits 0 |
| `required` | reports problems, exits 1 — use it in CI |

`--mode` overrides the file, so CI can require signatures while local work only warns: `sdlc approvals verify --mode required`.

Statuses of an approval: `valid`, `unsigned`, `wrong-signer` (signed by someone other than the approver — for example Bob signing a commit that claims Alice's approval), `bad-signature`, `not-committed` (the record is not in a commit yet). For `roles.yaml` commits: `valid`, `unsigned`, `not-maintainer`. A change to `roles.yaml` is checked against the maintainers in the version before it, so nobody can make themselves a maintainer and sign that with their own key.

After `sdlc archive`, committed approvals retain their status even before you commit the archive move.

Set up signing once per person (git ≥ 2.34):

```bash
git config gpg.format ssh
git config user.signingkey ~/.ssh/id_ed25519.pub
git config commit.gpgsign true
```

Then put the public key into `signing_key` in `roles.yaml` (a maintainer commits that change).

Bootstrap the keys before requiring signatures. In a temporary two-person repository, these steps were checked:

1. Commit `roles.yaml` with Alice as maintainer, Alice and Bob as people, no `signing_key` fields, and `signing: off`.
2. Generate each person's SSH key with `ssh-keygen -q -t ed25519 -N '' -C <email> -f <key>`.
3. Add both public keys to `signing_key`. Alice signs that commit with `git -c gpg.format=ssh
   -c user.signingkey=<alice.pub> commit -S -m 'add signing keys'`.
4. Change to `signing: warn` in another Alice-signed commit. Run `sdlc approvals verify` and review the findings.

The observed text was `valid` for the `signing: warn` commit, `bad-signature` for the signed key-adding
commit, and `unsigned` for the initial roles commit. It ended with
`0 approvals checked, 2 invalid (warn: not blocking)` and exited 0. The JSON had `mode: "warn"`, `ok: false`
and the same three statuses. The key-adding commit cannot verify against the preceding version, which has
no keys. Record this expected bootstrap finding; require signatures in CI after the bootstrap is reviewed.

The approver commits their own approval: `sdlc approve …`, then `git commit -S`.

Protect the file in code review too. With GitHub or GitLab code owners, one line makes every change to it need a maintainer's review (use your maintainers' handles or a team):

```text
# .github/CODEOWNERS (or CODEOWNERS / docs/CODEOWNERS)
/openspec/roles.yaml @your-org/maintainers
```

## 8.4. What this protects against, and what it does not

- **Protects**: one person approving their own code; one person carrying a change through every gate; an agent approving; a person approving under someone else's email (with signing); quietly widening roles (with signing).
- **Does not protect**: a person with write access who disables the checks in CI, or a compromised signing key. Protect the default branch and require the CI check that runs `sdlc approvals verify --mode required`.
