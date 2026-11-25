# AgentSystems Gateway

The authenticated communication boundary between ChatGPT, AgentSystems Workers and persistent knowledge.

## Current status — 2026-11-25

The dedicated live gateway supports connection tests, device enrollment, OAuth and knowledge retrieval. The live database has received the media migration with media disabled by default. The updated media gateway bundle and Android 0.9 candidate have been built locally; deployment and physical media acceptance remain outstanding. The gateway is not itself the product.

Private PostgreSQL tables enforce RLS and restrict direct access. Service-role-only SECURITY INVOKER RPCs require a trusted server-side gateway. Device operations require ECDSA proof; user identity derives from verified authentication, never client-supplied authority. Completed artifact integrity is distinct from independent video validity and creative review.

## Local verification

Run `bash tests/run-local.sh` for an isolated socket-only PostgreSQL test instance. Run the Node test suites for edge, tools, OAuth and browser interface behavior. The optional pilot fixture exercises actual MP4 bytes. No existing database or cloud project is touched by these local tests.

## Release principles

Use reviewed source and reproducible builds. Preserve the existing OAuth resource, package identity, enrollment and signing compatibility. No additional cost or paid resource without explicit approval. Keep unrelated projects untouched.
