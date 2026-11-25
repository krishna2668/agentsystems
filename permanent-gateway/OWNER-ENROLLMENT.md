# Native Worker enrollment — product contract

Owner authority stays separate from device identity. A request code is a correlation
identifier, not a credential or delegation of authority.

## Intended user experience

1. Open Worker. Tap Connect this Worker. No gateway URL, SQL or secret entry.
2. Worker generates a P-256 key in Android Keystore, creates a signed expiring
   enrollment request and displays a copyable 12-character request code.
3. Owner presents the code to the direct ChatGPT integration. It resolves the
   request, displays its identity, and requires explicit authenticated owner
   approval. ChatGPT must not substitute database administration for this action.
4. Worker checks its signed request automatically while visible. Approval creates
   the durable device identity. Worker saves it before displaying connected.
5. Owner can revoke the device. The gateway denies new work, and the Worker
   preserves unacknowledged local results.

## Gateway contract

Device routes: POST /enrollment/start, POST /enrollment/status.
Owner routes: POST /owner/enrollments/lookup, POST /owner/enrollments/approve.
The existing configured owner identity and valid Supabase Auth session are
required for owner routes. The approval request includes the matched request ID,
code and explicit confirmation. Fresh signed device proofs are checked at the
edge; the database binds request, key, owner and device atomically.
Unapproved requests expire in ten minutes; admission caps pending requests at
100. A previously approved request can recover its durable identity.
Legacy protocol 3 endpoints remain for compatibility, not as the product UX.

## Release gates

- Native candidate must pass physical onboarding and recovery.
- A genuine authenticated direct ChatGPT owner-approval connection must be
  implemented and verified. No placeholder plugin, password collection,
  admin SQL workaround or manually pasted token is acceptable.
- End-to-end signed enrollment, work execution, result retrieval and revocation
  must pass using the permanent gateway.
- Native Worker session limits, idle scheduling, and release signing still
  need product acceptance. This candidate is not production-ready.
- Stay within confirmed free plans; no additional paid resources.
