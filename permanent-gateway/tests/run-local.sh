#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
pgbin=/usr/lib/postgresql/16/bin
root=$(mktemp -d /tmp/worker-pg.XXXXXX)
trap '"$pgbin/pg_ctl" -D "$root/data" -m fast stop >/dev/null 2>&1 || true; rm -rf "$root"' EXIT
"$pgbin/initdb" -D "$root/data" -A trust --no-locale >/dev/null
"$pgbin/pg_ctl" -D "$root/data" -o "-k $root -p 18767 -c listen_addresses=''" -w start >/dev/null
export PGHOST="$root" PGPORT=18767 PGDATABASE=postgres
psql -X -v ON_ERROR_STOP=1 -c 'create role anon; create role authenticated; create role service_role bypassrls;'
psql -X -v ON_ERROR_STOP=1 -f "$(find supabase/migrations -name '*_worker_core.sql' | head -1)"
psql -X -v ON_ERROR_STOP=1 -f "$(find supabase/migrations -name '*_worker_discovery.sql' | head -1)"
psql -X -v ON_ERROR_STOP=1 -f "$(find supabase/migrations -name '*_device_initiated_enrollment.sql' | head -1)"
psql -X -v ON_ERROR_STOP=1 -f "$(find supabase/migrations -name '*_knowledge_core.sql' | head -1)"
psql -X -v ON_ERROR_STOP=1 -f "$(find supabase/migrations -name '*_knowledge_retrieval.sql' | head -1)"
psql -X -v ON_ERROR_STOP=1 -f tests/acceptance.sql
psql -X -v ON_ERROR_STOP=1 -f tests/discovery.sql
# Separate sessions race to claim the same device; exactly one attempt must be returned.
device=$(psql -XAt -v ON_ERROR_STOP=1 -c "select id from worker_private.devices where revoked_at is null")
psql -X -v ON_ERROR_STOP=1 -c "set role service_role; select public.worker_submit('00000000-0000-4000-8000-000000000002','$device','race-a','a'::bytea),public.worker_submit('00000000-0000-4000-8000-000000000002','$device','race-b','b'::bytea);" >/dev/null
for i in 1 2 3 4 5 6 7 8; do
 psql -XAt -v ON_ERROR_STOP=1 -c "set role service_role; select public.worker_operation('$device',gen_random_uuid(),extract(epoch from clock_timestamp())::bigint,'claim')->>'claim';" >"$root/claim-$i" &
done
wait
python3 - "$root" <<'PYTEST'
import pathlib,sys
root=pathlib.Path(sys.argv[1])
claims=[p.read_text().strip().splitlines()[-1] for p in root.glob('claim-*')]
assert len(claims)==8 and len(set(claims))==1 and len(claims[0].split('	'))==3,claims
print('PASS: eight concurrent claims returned exactly the same attempt')
PYTEST
test "$(psql -XAt -c "select count(*) from worker_private.jobs where state='claimed'")" = 1
# Explicit restart validates persisted completed results and revoked identity.
"$pgbin/pg_ctl" -D "$root/data" -m fast -w restart >/dev/null
psql -X -v ON_ERROR_STOP=1 -c "select case when count(*)=1 then 'PASS: completed result persisted across database restart' else 'FAIL' end from worker_private.jobs where state='completed';"
test "$(psql -XAt -c "select count(*) from worker_private.jobs where state='completed'")" = 1

psql -X -v ON_ERROR_STOP=1 -f tests/enrollment.sql

psql -X -v ON_ERROR_STOP=1 -f tests/knowledge.sql

psql -X -v ON_ERROR_STOP=1 -f tests/retrieval.sql

psql -X -v ON_ERROR_STOP=1 -f tests/oauth-fixture.sql
psql -X -v ON_ERROR_STOP=1 -f "$(find supabase/migrations -name '*_mcp_oauth_boundary.sql' | head -1)"
psql -X -v ON_ERROR_STOP=1 -f tests/oauth.sql

psql -X -v ON_ERROR_STOP=1 -f "$(find supabase/migrations -name '*_media_animatic.sql' | head -1)"
psql -X -v ON_ERROR_STOP=1 -f tests/media.sql

# Optional actual pilot artifact, never downloaded or required for the SQL unit suite.
if [[ -f ../production-pilot/pilot.mp4 ]]; then
 python3 tests/media-roundtrip.py ../production-pilot/pilot.mp4
fi
