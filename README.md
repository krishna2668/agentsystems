# AgentSystems

**Intelligence that compounds.**

An experimental intelligent production system that executes work, evaluates outcomes and accumulates knowledge from evidence. Our first domain is audiovisual storytelling, beginning with Tamil animated shorts.

[![CI](https://github.com/krishna2668/agentsystems/actions/workflows/ci.yml/badge.svg)](https://github.com/krishna2668/agentsystems/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

## Architecture

Intelligence plans and evaluates; an authenticated gateway coordinates bounded jobs; persistent storage retains results and knowledge; Workers execute tasks. Resources are replaceable. RunOrc is an engineering environment, not a runtime dependency.

## Project status

Early engineering candidate, **not production-ready**. Device enrollment, bounded jobs and knowledge retrieval have been demonstrated. The initial renderer is a fixed four-beat animatic, not a general animation engine. Physical Android media acceptance, production coordination and continuous learning are outstanding.

## Quick start

Use Node.js 24+, JDK 17+, PostgreSQL 16, and optionally Android SDK 36 and build tools 36.0.0.

```sh
bash scripts/build-gateway.sh
bash scripts/test.sh
```

See [development](docs/DEVELOPMENT.md), [roadmap](docs/ROADMAP.md) and [contributing](CONTRIBUTING.md). The public source contains example endpoints. Configure your own deployment before building a distributable Worker.

| Directory | Purpose |
| --- | --- |
| permanent-gateway | Gateway, MCP, database migrations and integration tests |
| product-src | Android Worker source |
| product-tests | JVM tests for Worker logic |
| production-pilot | Reproducible reference animation |
| scripts | Development build and test entrypoints |

## License

[Apache License 2.0](LICENSE). Product names and logos are not licensed as trademarks by the software license. See [security policy](SECURITY.md) for vulnerability reporting.
