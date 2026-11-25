# Roadmap

The goal is a production system whose intelligence improves through actual work.

1. Authenticated, durable foundation and authorized physical Workers.
2. First closed-loop Tamil animatic: native execution, durable retrieval, independent decode, human creative review.
3. Persistent reviewed learning and contextual retrieval.
4. Resource selection based on capabilities and observed performance.
5. Reusable audiovisual capabilities: animation, image, sound, speech, composition and rendering.
6. Production coordination, recovery, evaluation, controlled experiments and continuous improvement.
7. Scale production without sacrificing quality, continuity or cost discipline.

Each milestone requires evidence. A fixed pilot renderer and a verified file digest do not establish a general production capability.

## Product boundary

ChatGPT owns creative reasoning, direction, review and revision. Android owns programmatic application operations, editable local project state, computation and preview. The intended experience is two apps on the same phone: chat and production preview, with creative feedback through chat. Do not build manual editing tools or an Android intelligence layer. Retain essential playback, permission, pause and recovery controls. Programmatic operations must use supported interfaces, not simulated taps or assumptions about third-party application internals.

The first useful vertical slice is an editable animation project that ChatGPT can create, change and preview on the phone, without a manual editor. Preserve project identity and versions across interruptions; return actual visual evidence to ChatGPT for review. Expand operations in response to production needs, not a speculative universal workflow language.

## Production acceptance

The long-term creative benchmark is the owner-approved aquarium advertisement reference: a small incident escalates into danger, a protective reaction builds tension, an unexplained survival creates curiosity, and a replay reveals a surprising product-related payoff. The objective is original work with comparable storytelling, emotional timing, continuity, effects, sound and editing, not reproduction of the reference or a fixed advertisement pipeline. Fictional exaggeration is not substantiation for real product claims.

Begin with the existing Tamil pilot, **ஒரு குடை**, and close one real production loop before broadening the renderer. The system chooses a creative objective and an initial version, obtains a verified artifact, inspects actual audiovisual output, records a specific creative weakness, makes a targeted revision, compares the two outputs, and proposes a scoped lesson backed by evidence. Human feedback establishes whether the intended emotion was communicated. A failed experiment is useful evidence; technical validity alone is not creative acceptance.

Keep the gates distinct:

- Physical Worker: reported compatible media capability, explicit media permission, completed bounded job, durable artifact retrieval and matching digest.
- Technical review: independent full decode, expected duration and streams; identify the silent Android pilot separately from the audio-bearing local reference.
- Creative review: observed action, timing, continuity and emotional clarity; record which artifact was actually reviewed and any limits of the review.
- Revision: change a specific controllable variable, retain both versions, and compare against the same intent.
- Learning: record sourced observations, propose a revision, and retrieve it only after trusted review. Pending learning is not active knowledge.

Local engineering experiments are not evidence of physical Worker acceptance. RunOrc remains an engineering environment, not a production dependency. No new provider, paid resource or deployment is required to define or test the local loop.

### Companion preview

The newer native Companion and its verified private artifact library supersede the earlier latest-only preview experiment. Preserve all completed outputs, link directly to the requested artifact and retain the browser handoff. Playback availability follows confirmed integrity, not merely local render completion. See COMPANION.md.

### First editable project slice (local implementation)

`PilotProject` is the bounded Android-side project store. Creation assigns a supplied stable project UUID and revision 1. `setNoticeReaction` names a project, base revision, operation UUID and desired boolean; it creates the next immutable snapshot while retaining the original timing and history. Exact retry at the same base revision returns the existing snapshot, conflicting retry or stale mutation fails, and restoring the earlier setting creates a new revision. The caller must serialize mutations, as the Worker already does for its current jobs. This is a pilot-specific engine, not a generic timeline model.

The renderer now accepts the revised snapshot’s reaction flag and draws an eye/head-direction change during the notice beat before movement starts. Legacy v1 timing-only jobs retain their previous appearance. The local project transport candidate introduces `create_pilot_project`, `edit_pilot_notice` and `read_pilot_project`. A new forward-only migration reserves each revision as a render job and requires the previous revision to be completed on the same device. The Worker reports media protocol 2 through the signed claim-v3 route; legacy claims do not receive project commands. Exact retries preserve job identity, and unavailable local project revisions are explicitly blocked without retaining the active claim. Readback describes submitted revisions, not verified creative quality. This is a narrow pilot contract; a failed revision currently terminates that project chain, and multi-device project relocation, larger artifacts and further creative operations are not implemented. Physical Android rendering/playback and creative evaluation are still required.

### First AgentSystems-native visual review (0.13 candidate)

The Android Worker decodes six representative frames from a retained completed MP4, assembles a bounded JPEG contact sheet, and uploads it using the existing signed device identity. The original MP4 remains intact. A durable local pending image survives an interrupted upload; server evidence is immutable and tied to the completed video SHA-256. A separate additive migration stores the private contact sheet. `inspect_video_frames` returns an MCP image content block to ChatGPT after owner OAuth authorization, not an unauthenticated URL or a base64 text response. Neither Android nor Cloudflare performs visual reasoning. An authenticated model can now examine the actual frame pixels without RunOrc device control once this candidate is released and accepted.

Six stills do not establish full motion, sound, emotion, or artifact validity; creative feedback must still name what was and was not inspected. Source-signed capture is not an independent decode. Existing completed local MP4s are backfilled only during an explicitly started Worker session. Release order is additive migration, reviewed gateway candidate, separately approved gateway activation, then in-place Android upgrade and physical image-block inspection. Current v9 and installed Android 0.12 are not changed by this local 0.13 development branch.
