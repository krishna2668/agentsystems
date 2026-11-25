"""Exercise actual MP4 bytes against the local test database, not a cloud project."""
import base64
import hashlib
import json
import pathlib
import subprocess
import sys
import tempfile
import uuid

fixture = pathlib.Path(sys.argv[1]).read_bytes()
assert 0 < len(fixture) <= 2097152
owner, device = str(uuid.uuid4()), str(uuid.uuid4())
digest = hashlib.sha256(fixture).hexdigest()
sql = [
    "begin; set role service_role;",
    f"insert into worker_private.owners(id) values('{owner}');",
    f"insert into worker_private.devices(id,owner_id,public_key) values('{device}','{owner}',decode('{uuid.uuid4().hex * 6}','hex'));",
    f"select public.worker_operation('{device}',gen_random_uuid(),extract(epoch from clock_timestamp())::bigint,'claim_v2');",
    f"select public.worker_media_permission('{owner}','{device}',true);",
    f"select public.worker_media_submit('{owner}','{device}','roundtrip','v1:4:4:5:7')->>'job_id' as job \\gset",
    f"select split_part(public.worker_operation('{device}',gen_random_uuid(),extract(epoch from clock_timestamp())::bigint,'claim_v2')->>'claim',E'\\t',2) as lease \\gset",
]
chunks = [fixture[i:i+65536] for i in range(0,len(fixture),65536)]
for i, chunk in enumerate(chunks):
    sql.append(f"select public.worker_media_write('{device}',gen_random_uuid(),extract(epoch from clock_timestamp())::bigint,:'job',:'lease',{i},decode('{chunk.hex()}','hex'),null,null);")
sql.extend([
    f"select public.worker_media_write('{device}',gen_random_uuid(),extract(epoch from clock_timestamp())::bigint,:'job',:'lease',null,null,{len(chunks)},decode('{digest}','hex'));",
    f"select public.worker_media_manifest('{owner}',:'job');",
    f"select public.worker_media_artifact('{owner}',:'job',i) from generate_series(0,{len(chunks)-1}) i;",
    "rollback;",
])
result = subprocess.run(['psql','-XAtq','-v','ON_ERROR_STOP=1'], input='\n'.join(sql), text=True, capture_output=True, check=True)
rows = [json.loads(line) for line in result.stdout.splitlines() if line.startswith('{')]
assert rows[0]['claim'] == ''
assert rows[1]['media_enabled'] is True
assert all(r['state']=='uploaded' and r['seq']==i for i,r in enumerate(rows[2:2+len(chunks)]))
assert rows[2+len(chunks)]['sha256']==digest
manifest=rows[3+len(chunks)]
assert manifest['bytes']==len(fixture) and manifest['chunks']==len(chunks) and manifest['media_validity']=='unverified'
parts=rows[4+len(chunks):]
assert len(parts)==len(chunks)
assert all(p['seq']==i and p['sha256']==digest and p['chunks']==len(chunks) for i,p in enumerate(parts))
recovered=b''.join(base64.b64decode(p['bytes_b64'],validate=True) for p in parts)
assert recovered==fixture and hashlib.sha256(recovered).hexdigest()==digest
with tempfile.TemporaryDirectory() as tmp:
    path=pathlib.Path(tmp)/'retrieved.mp4'
    path.write_bytes(recovered)
    probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(path)]))
    assert any(s['codec_name']=='h264' and s['width']==360 and s['height']==640 and s['nb_frames']=='480' for s in probe['streams'])
    assert float(probe['format']['duration'])==20
    subprocess.run(['ffmpeg','-v','error','-i',str(path),'-f','null','-'],check=True)
print(f'PASS: real MP4 round-trip, {len(chunks)} chunks, {len(fixture)} bytes, identical digest and independent full decode')
