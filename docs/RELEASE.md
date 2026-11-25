# Releases

The public repository is authoritative for source. GitHub CI validates pushes and pull requests without deployment credentials.

## Gateway

The manually dispatched Gateway candidate workflow runs full verification on main. A separate environment approval is required before access to deployment secrets. The upload job creates an immutable version and verifies that active traffic remains unchanged. It is not a production deploy. The release record contains the source commit, candidate and previous version IDs, and bundle SHA-256. No configured bundle is published to GitHub artifacts.

Configure the gateway-candidate environment with GATEWAY_ORIGIN, SUPABASE_ORIGIN, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_WORKER_NAME and CLOUDFLARE_API_TOKEN. Prefer an Individual Workers Editor token scoped to the initialized target Worker. Keep the credential in the protected environment, not chat, source or repository-wide secrets. The manual workflow defaults to read-only preflight; candidate upload requires explicitly setting upload_candidate=true. Preflight checks target access, reports binding readiness, and optionally checks denial of access to a known existing, distinct Worker specified by the environment variable CLOUDFLARE_DENIED_WORKER (HTTP 404 is inconclusive). It does not upload or deploy. The candidate script inherits the existing exact binding inventory and compatibility settings, rejects divergent latest/active versions, and never calls the deployment mutation endpoint.

Review the Cloudflare candidate version and validate readiness, authorization and compatibility before separately approving traffic promotion. Retain the previous version for rollback. Rollback does not undo database migrations.

## Database

Use reviewed, forward-only migration files. Compare the hosted migration history against the source before applying a pending migration; never replay an applied migration or silently repair migration history. A live database change requires a dedicated authorized release step with a dry-run and readback. Automated database writes are not enabled yet.

## Android

Local debug-signed candidates are not release-signed distribution artifacts. Production signing requires a protected signing identity and a deliberate compatibility plan for existing enrolled devices. Do not publish signing credentials or reuse debug keys for public releases. Android distribution automation is not enabled yet.

## Moving an existing gateway between accounts

A Worker name and account subdomain jointly determine its origin. Changing either is an authentication and device-compatibility migration, not merely a deployment setting.

- Keep the old gateway, OAuth resource and device enrollment functional until acceptance at the new origin. Never rename a shared account's Workers subdomain or modify unrelated Workers.
- Bootstrap only a new, explicitly selected Worker from verified source. Refuse an unexpected existing target; an explicitly created inert placeholder can be initialized only after checking its identity, contents and active version. Bind only the dedicated project's credentials and a separate rate limit namespace. Do not copy another project's runtime secrets.
- The candidate-upload workflow applies to an existing initialized Worker; the target may be set before bootstrap for read-only preflight, but never upload until the required bindings and verification are complete.
- Add the exact new MCP resource through a reviewed forward-only database migration; never rewrite deployed migration history or allow arbitrary OAuth audiences. Reauthorize ChatGPT at the new resource; keep grants isolated.
- Preserve enrolled device keys and IDs; require a tested, explicit origin transition before redirecting devices. Never erase a pending job checkpoint to force reconnection.
- Verify direct login, OAuth, signed device execution, artifact retrieval and recovery before retiring the previous gateway. Record rollback steps. Do not delete the previous Worker automatically.
- An account-level deploy token can affect other Workers within that account unless narrower resource scoping is supported. Prefer the narrowest available scope, an explicit script target, environment approval, and short-lived credentials. Account separation remains optional; monitor shared usage and do not purchase capacity without approval.

For a gateway origin transition, configure a disposable checkout with both
`--gateway <new-origin>` and `--previous-gateway <old-origin>`. Apply only
the new reviewed transition migration to the existing database. It preserves
old grants and permits a distinct client grant for the new exact audience.
Do not reuse a client ID for a different audience. A fresh installation can
omit the previous origin. Supabase Auth's Site URL plus its authorization
path determines the consent page; switch that URL only after the new gateway
is initialized and ready, preserving the prior settings for rollback.
The transition SQL alone does not move devices or change Auth configuration.
