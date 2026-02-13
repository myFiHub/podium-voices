# Token Rotation SOP

Standard procedure for rotating the Podium JWT used by the AI co-host agent. Use this when the token has expired, been revoked, or as part of routine rotation.

## Step 1: Obtain a fresh Podium JWT

- **Browser:** Log in to the Podium web app and obtain a valid JWT (e.g. from network tab or session storage, per your Podium deployment).
- **Programmatic:** Use the Podium login flow (see [podium interface considerations.md](../podium%20interface%20considerations.md)) if your setup supports it.

Ensure the token has permission to join and speak in the target Outpost.

## Step 2: Update the secret store

- **Do not** put the new token in `.env.local` in the repo or any file that could be committed.
- Update your **secret store** with the new value, for example:
  - AWS Secrets Manager, HashiCorp Vault, or similar
  - An encrypted file mounted only at runtime (e.g. `/run/secrets/podium_token`)
- If using file-based injection: set `PODIUM_TOKEN_FILE` to the path of the file containing the token (e.g. `/run/secrets/podium_token`). The agent reads the token from that file at startup.

## Step 3: Restart agent process(es)

Agents load the token at startup. Restart so they pick up the new value:

- **Kubernetes:** e.g. rollout restart of the agent deployment (new pods get the updated secret).
- **Docker Compose:** `docker compose up -d --force-recreate podium-voices-agent` (and any other agent services).
- **Systemd / bare metal:** `systemctl restart podium-voices-agent` (or your service name).

## Step 4: Validate

1. **WebSocket:** Agent connects to Podium WS without auth errors.
2. **Join:** Agent joins the Outpost room (check logs for successful join).
3. **Greeting / opener:** Agent speaks the greeting or opener after join.
4. **One round-trip:** Speak once and confirm the agent replies with audio.

Use the smoke runbook for a full check: [docs/SMOKE_TEST_RUNBOOK.md](SMOKE_TEST_RUNBOOK.md).

---

## Alert on auth failures

The agent logs a **stable event** when authentication fails so alerting can key off it:

- **`AUTH_FAILURE`** – Emitted when:
  - Podium REST API returns **401** or **403** (e.g. invalid or expired token).
  - Podium WebSocket reports an auth-related error or closes with an auth-related code.

Configure your log aggregator or monitoring to alert on `event: "AUTH_FAILURE"` so operators can rotate the token and restart agents promptly.
