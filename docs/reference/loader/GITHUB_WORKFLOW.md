# Waypoint Logistics — GitHub Workflow (Loader Team)

Rules every change follows. Based on the team's branching cheat sheet.

## 1. Branch structure

```
main                       ← stable, final code (end of sprint only)
 └── dev                   ← integration branch for all roles
      ├── dispatcher       ← dispatcher role branch
      ├── driver           ← driver role branch (driver-minidu, driver-nagitha)
      └── loader           ← loader role branch (shared)
           ├── loader-sachintha   ← Sachintha's work branch
           └── loader-sanduni     ← Sanduni's work branch
```

| Branch | Purpose | Who pushes directly |
| --- | --- | --- |
| `main` | Stable release code | Nobody — PR from `dev` at sprint end |
| `dev` | Integration of all roles | Nobody — PRs only |
| `loader` | Integrated loader work | Nobody — PRs only |
| `loader-sachintha` | Sachintha's features | Sachintha |
| `loader-sanduni` | Sanduni's features | Sanduni |

## 2. Merge flow

```
loader-sachintha ─┐
                  ├─(PR)→ loader ─(PR)→ dev ─(PR, end of sprint)→ main
loader-sanduni  ──┘
```

1. Build a feature on your own branch.
2. PR into `loader` → the other loader teammate reviews and merges.
3. When a loader milestone is ready → PR `loader` into `dev`.
4. End of sprint → `dev` into `main` (team lead).

## 3. Hard rules

- Never push directly to `main`, `dev`, or `loader`.
- Always use Pull Requests.
- One feature per PR; small, clear commits.
- Never commit `.env`, `.env.local`, `.venv/`, `node_modules/`, or `graphify-out/`.
- Don't commit `.gitattributes` or other tooling files unless the team agrees.
- Check `git status` before every commit.
- Don't change shared models (`Order`, `DispatchTrip`, `Shipment`) without telling the dispatcher and driver teams.

## 4. Commit message format

`type(scope): description` — scope is usually `loader`.

| Type | Use for | Example |
| --- | --- | --- |
| `feat` | New feature | `feat(loader): add stop-sequence loading checklist` |
| `fix` | Bug fix | `fix(loader): correct item quantity per stop` |
| `refactor` | Code improvement, no behaviour change | `refactor(loader): extract stop card component` |
| `docs` | Documentation | `docs(loader): add loader API notes` |
| `style` | UI / formatting | `style(loader): enlarge confirm buttons to 44px` |

## 5. Daily workflow (PowerShell, from repo root)

**Start of session — sync with `loader`:**

```powershell
cd C:\Projects\SynapX_WaypointLogistics
git checkout loader
git pull origin loader
git checkout loader-<yourname>
git merge loader
graphify update .
```

**While working:**

```powershell
git status
git add .
git commit -m "feat(loader): short description"
git push
```

**Finishing a feature — open a PR:**
GitHub → Pull requests → New pull request → **base: `loader`**, **compare: `loader-<yourname>`** → describe what changed and how to test it → request review from your teammate.

**After your PR is merged:** run the start-of-session sync again so your branch includes the merged work.

## 6. Keeping `loader` up to date with `dev`

Other roles merge into `dev` too. Before a `loader` → `dev` PR, bring `dev` into `loader` via a PR (**base: `loader`**, **compare: `dev`**). Resolve conflicts there, then each teammate syncs their own branch.

## 7. Pull request checklist

- [ ] Branch is synced with the latest `loader`
- [ ] Backend starts (`python main.py`) and `pytest` passes
- [ ] Frontend starts (`npm run dev`) and the loader page renders
- [ ] UI matches the Figma loader screens
- [ ] No env files or generated folders in the diff
- [ ] PR title uses the commit format, e.g. `feat(loader): add shortfall flag flow`
- [ ] Description says what changed and how to test it

## 8. Resolving merge conflicts

If `git merge loader` reports conflicts:

```powershell
git status                      # lists conflicted files
# open each file, keep the right code between <<<<<<< ======= >>>>>>> markers, delete the markers
git add <file>
git commit
```

If unsure, stop and ask your teammate before committing — don't delete their code.
