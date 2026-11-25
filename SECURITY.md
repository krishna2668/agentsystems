# Security policy

AgentSystems is experimental; no supported stable release exists yet.

Report suspected vulnerabilities privately through GitHub private vulnerability reporting when available. Do not publish exploitation steps, secrets or private account data in a public issue.

Describe the affected revision, impact, and a minimal reproduction against a local or authorized test environment. Do not test against other users' accounts or devices.

The gateway authenticates users and signed devices; database access is restricted to trusted server-side functions. An artifact digest establishes integrity only, not successful decoding or creative quality. Deployment and signing credentials must remain outside source control.
