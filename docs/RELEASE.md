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

The Android transition candidate uses a release-configured previous origin
and an explicit Update connection action. The new gateway must already
support the signed, read-only /worker/verify-connection endpoint. The
response must match the existing device ID, target origin, and fresh
challenge before the app persists its new address. No enrollment or job
claim occurs during verification. Install in place with the same test
signing certificate; never uninstall or clear data. Verify the same
device ID and a completed job on the new origin before retiring the old
gateway. A failed verification preserves the old address; a storage
failure is not a verified connection.

## Editable pilot candidate

Apply the new pilot-project migration before activating a gateway that exposes project commands. It preserves legacy media jobs and adds signed claim-v3 admission for the new project-capable Worker. Then verify gateway readiness and existing operations, install an in-place compatible Android candidate, and verify its reported media version 2. Media permission remains an explicit account action. Exercise create, render, edit, render, readback, and local playback on the enrolled device; do not report creative acceptance based only on job completion or digest verification. No existing media job or project revision is silently deleted. The old app cannot claim project work; downgrading during a pending project is not an accepted recovery procedure.

### Reconciled editable pilot candidate (0.12)

The candidate retains the native Companion, private non-evicting artifact library, App Links and browser handoff from upstream main. The earlier latest-only preview prototype is superseded; it must not be reintroduced. The deployed device-artifact migration was verified against hosted migration history and recorded locally under its actual version `20261125130923`. The applied project migration is `20261125144020` (the hosted API assigned this version; SQL is byte-identical to reviewed `20261125142423`); it also permits signed artifact retrieval from media protocol 2, retaining the same authorization and device scope. Do not replay the already-applied artifact migration. The installed Worker currently advertises protocol 1 and will need the compatible candidate to report protocol 2 before project operations are admitted. No live migration, gateway activation or app installation is implied by local candidate validation.

### Visual-review candidate (0.13, not deployed)

The 0.12 physical test established creation, revision, integrity and Android playback, but visual inspection used RunOrc. The proposed independent review path adds `20261125234137_review_stills.sql`, a signed bounded six-frame JPEG capture on Android, and the authenticated MCP `inspect_video_frames` image content tool. Do not confuse JPEG integrity with semantic/creative quality. The approved additive migration was applied under hosted version `20261125234137`, with unchanged reviewed SQL (SHA-256 `d6f5642d215c37dbbd01a502d39a7b966936f1b08fb19186fe8d335d14bff38b`); never replay it. Verify v9 rollback and retained authorizations, upload the gateway candidate without traffic changes, and activate only under a separate approval. Android 0.13 is an in-place private test candidate; physical capture, backfill and ChatGPT image-block delivery require acceptance after deployment. On rollback to v9, an HTTP 404 from the optional review route must not stop ordinary Worker jobs or discard locally retained review evidence. No live activation is authorized by this branch.
