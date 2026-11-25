# Releases

The public repository is authoritative for source. GitHub CI validates pushes and pull requests without deployment credentials.

## Gateway

The manually dispatched Gateway candidate workflow runs full verification on main. A separate environment approval is required before access to deployment secrets. The upload job creates an immutable version and verifies that active traffic remains unchanged. It is not a production deploy. The release record contains the source commit, candidate and previous version IDs, and bundle SHA-256. No configured bundle is published to GitHub artifacts.

Configure the gateway-candidate environment with GATEWAY_ORIGIN, SUPABASE_ORIGIN, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_WORKER_NAME and CLOUDFLARE_API_TOKEN. Use an account-scoped Workers Scripts Edit token, only for the intended Cloudflare account. Do not place tokens in chat, source or repository-wide secrets. The token is used only by the upload step. The candidate script inherits the existing exact binding inventory and compatibility settings, rejects divergent latest/active versions, and never calls the deployment mutation endpoint.

Review the Cloudflare candidate version and validate readiness, authorization and compatibility before separately approving traffic promotion. Retain the previous version for rollback. Rollback does not undo database migrations.

## Database

Use reviewed, forward-only migration files. Compare the hosted migration history against the source before applying a pending migration; never replay an applied migration or silently repair migration history. A live database change requires a dedicated authorized release step with a dry-run and readback. Automated database writes are not enabled yet.

## Android

Local debug-signed candidates are not release-signed distribution artifacts. Production signing requires a protected signing identity and a deliberate compatibility plan for existing enrolled devices. Do not publish signing credentials or reuse debug keys for public releases. Android distribution automation is not enabled yet.
