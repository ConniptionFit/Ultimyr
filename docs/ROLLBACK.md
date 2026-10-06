# Rolling back the overnight run (2026-10-06)

A long improvement run started from `main` at commit **`3e8e0930f155049589da2e3be107f002438397af`** ("Keep FAQs, intros and other filler out of course builds (#77)"). That commit is the revert point.

| Marker | What it is |
|---|---|
| Branch `revert/pre-overnight-2026-10-06` | Pushed at that commit. Never changes. |
| Tag `pre-overnight-2026-10-06` | Not created by the run (the cloud session cannot push tags). Create it yourself with the commands below. |

## Create the tag (once, anywhere)
```sh
git fetch origin revert/pre-overnight-2026-10-06
git tag pre-overnight-2026-10-06 3e8e0930f155049589da2e3be107f002438397af
git push origin pre-overnight-2026-10-06
```

## Roll back on your server
Migrations only go forward, so the safe way back is to restore the database taken before the upgrade.

1. **Take a backup of the current state** (in case you want it later): `scripts/backup.sh`
2. **Stop and check out the old code:**
   ```sh
   git fetch origin
   git checkout pre-overnight-2026-10-06   # or: git checkout revert/pre-overnight-2026-10-06
   ```
3. **If migrations were applied after the revert point** (see the table below), restore the backup you took *before* pulling the overnight changes: `scripts/restore.sh backups/<timestamp>/ultimyr.dump`. If you have no such backup, use the manual undo SQL in the table.
4. **Rebuild:** `docker compose up -d --build`

To go back to the code only and keep `main` history intact, do not reset `main`. Open a revert PR instead:
```sh
git checkout -b revert-overnight origin/main
git revert --no-commit 3e8e0930f155049589da2e3be107f002438397af..origin/main
git commit -m "Revert overnight run"
```

## Migrations added during the run
Last migration at the revert point: `services/content/migrations/0009_review_undo`.

| Migration | Service | What it does | Manual undo |
|---|---|---|---|
| none yet | | | |
