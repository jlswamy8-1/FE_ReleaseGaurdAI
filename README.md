# ReleaseGuard AI

Angular MVP for monthly release readiness and Go/No-Go decisions.

## Run locally

This workspace requires Node.js 20.11+ and npm.

```powershell
npm install
npm start
```

Open `http://localhost:4200/`.

## Demo flow

- The default September release shows an 82% **AT RISK** decision with a missing rollback plan blocker.
- Select `September Monthly Release - Updated` to show the resolved 92% **READY** scenario.
- Use **View release delta** to compare the current release with the previous release.
- Use **Generate summary** to open the release-manager-ready decision summary.

The app currently uses deterministic in-memory fixtures so the demo does not depend on external Jira, Jenkins, SonarQube, or OpenShift systems. The `Gate` model and scenario fixtures are the integration boundary for replacing them with REST adapters later.
