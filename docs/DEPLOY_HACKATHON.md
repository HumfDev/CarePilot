# Deploy to hackathon workspace (`carepliots`)

**Target URL:** https://carepliots-736467640869366.aws.databricksapps.com  
**Workspace ID:** `736467640869366`  
**App name:** `carepliots`

This is a **different workspace** from the UW workspace (`2975424914277074` / `carepilot`).

## 1. CLI login (one-time)

Copy the workspace URL from your browser (`https://dbc-xxxxx.cloud.databricks.com`):

```bash
databricks auth login \
  --host https://dbc-XXXXX.cloud.databricks.com \
  --profile hackathon
```

## 2. Discover resources

```bash
export DATABRICKS_CONFIG_PROFILE=hackathon
npm run discover:hackathon
```

Update `targets.hackathon.variables` in `databricks.yml` (Lakebase branch, Genie space, warehouse ID).

## 3. Build + deploy

```bash
export DATABRICKS_CONFIG_PROFILE=hackathon
npm run deploy:hackathon
```

Or upload source to workspace then deploy:

```bash
npm run build
databricks workspace import-dir . \
  /Workspace/Users/<your-email>/carepilot \
  --profile hackathon --overwrite

databricks apps deploy carepliots \
  --profile hackathon \
  --source-code-path /Workspace/Users/<your-email>/carepilot \
  --auto-approve
```

## 4. Git source (optional)

In Databricks Apps UI → `carepliots` → connect repo:

- https://github.com/HumfDev/CarePilot
- Branch: `main` (commit `4cead7b`+)

## Notes

- Lakebase synced tables (`facility_features_v4`) must exist in **this** workspace too.
- Do **not** set `CAREPILOT_LOCAL_DEMO` in production `app.yaml` env.
- If deploy hits a daily limit, retry the next day or use workspace file upload + `apps deploy` only.
