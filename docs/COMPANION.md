# Android Companion

AgentSystems is one Android app. The Worker is an execution capability,
not the primary user experience. Keep the existing application ID,
enrolled key, saved connection, checkpoint format and foreground
execution controls while replacing the surrounding experience.

## Product surface

- Home: recent work and items awaiting attention.
- Library: saved outputs, available offline when already stored, and
  explicit previews. Rendered bytes must remain in private app storage.
- Worker: availability, existing enrollment, pause/start and resource
  restrictions. Existing execution semantics are not changed by navigation.
- Preview: show the actual artifact, play it directly, preserve user
  context on Back. Never invent a title or mark an unavailable file local.

Use Jetpack Compose and Material 3, dynamic colors where supported,
system insets and standard native navigation. The existing Java Worker
control screen is transitional, not the finished design.

## First complete experience

1. Keep the verified completed render in the private library before
   clearing the durable execution checkpoint. Never delete an earlier
   output when a new job begins. Retrying publication must be idempotent.
2. Use an HTTPS Android App Link, /artifacts/<job-id>, with exact host
   validation and Digital Asset Links verification. A link is an identifier,
   not a credential. An installed test build may use its separately
   verified test signing certificate; production association requires
   a protected release signing identity. Keep a browser fallback.
3. Play local bytes immediately. If missing, retrieve only an authorized
   completed artifact, verify size, chunk sequence and SHA-256, then
   atomically publish to private storage. Never show a partial file as
   a playable output. No public URLs or bearer tokens in links.
4. Device identity may recover completed media assigned to that same
   active, media-authorized Worker; it must not grant access to another
   Worker's output or owner controls. Cross-device library and owner
   approvals require a separate authenticated human session in the same app.
5. The gateway tool should return the preview link rather than require
   a browser download. Verify actual ChatGPT-to-Android link handling,
   cold/warm launch, offline replay, and recovery after interruption.

Keep these as explicit release gates. Initial library files have no
remote project title or review metadata; derive only what is actually
known. The earlier 0.10 pilot was not retained on-device by the old
Worker and must be recovered through an authorized artifact retrieval
path. Do not pretend it is already local.

## Safety and storage

Only publish server-confirmed local renders or verified retrieved bytes.
Completed items are separate from unfinished checkpoints; storage limits
must never silently discard user work. A remote revocation stops future
authorized retrieval and work, not a promised remote wipe of local files.
Use a clear storage management action later. No extra paid service.

## Candidate build and association

The Gradle wrapper pins the distribution and its checksum. CI builds the
native app; an isolated configured checkout is required for device
installation. Run `bash build-product.sh` after the deployment configuration
script. The Android package ID is unchanged. The existing signing identity
must match before an in-place upgrade.

The gateway candidate workflow accepts an explicit public certificate
SHA-256 fingerprint. Until configured, the association endpoint returns
an empty statement list. Verify the exact candidate certificate and the
published association for each deployment that enables App Links. A test
certificate is only for this private acceptance installation; no public
release signing is established. Browser fallback is a public, non-indexable handoff with no artifact lookup or media disclosure. It displays the same canonical link and generates its QR code locally in the browser. No device management or sign-in is required to understand the next step. Actual media retrieval remains authenticated. Browser playback is not implemented.

Public animation links ignore query decorations and accept a single trailing slash; QR and copied links always contain only the canonical origin and validated job identifier. Malformed preview paths return a human-readable page. Android parses the same decorated links without granting authority. Authenticated API route validation remains strict.

The 0.12 candidate preserves Back navigation across configuration changes, suspends library refresh while stopped, and restores playback intent on return without overriding a user-paused video. These lifecycle behaviours still require physical acceptance.
