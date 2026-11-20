"""Build the store upload ZIP with manifest.json at the archive root."""
from pathlib import Path
import hashlib,json,struct,zipfile
ROOT=Path(__file__).resolve().parent.parent
STORE=ROOT/'store'
EXT=ROOT/'extension'
manifest=json.loads((EXT/'manifest.json').read_text(encoding='utf-8'))
assert manifest['manifest_version']==3
assert manifest['permissions']==['storage']
assert all(script['matches']==['https://x.com/*','https://twitter.com/*'] for script in manifest['content_scripts'])
files=sorted(p for p in EXT.rglob('*') if p.is_file())
assert not any(p.is_symlink() or p.suffix in ('.sqlite','.pem','.key') for p in files)
archive=STORE/f"liubai-store-v{manifest['version']}.zip"
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
    for path in files:z.write(path,path.relative_to(EXT).as_posix())
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
    assert 'manifest.json' in z.namelist() and len(z.namelist())==len(files)
    for path in files:assert z.read(path.relative_to(EXT).as_posix())==path.read_bytes()
sizes={'logo-300.png':(300,300),'promo-440x280.png':(440,280),**{f'screenshot-0{i}-1280x800.png':(1280,800) for i in (1,2,3)}}
for name,expected in sizes.items():
    data=(STORE/'assets'/name).read_bytes()
    assert data[:8]==b'\x89PNG\r\n\x1a\n' and struct.unpack('>II',data[16:24])==expected
sha=lambda path:hashlib.sha256(path.read_bytes()).hexdigest()
record={'version':manifest['version'],'validation_scope':'package validation only; no store approval implied','archive':archive.name,'bytes':archive.stat().st_size,'sha256':sha(archive),'runtime_files':len(files),'same_runtime_bytes_as_extension':True,'assets':{name:{'dimensions':size,'sha256':sha(STORE/'assets'/name)} for name,size in sizes.items()}}
(STORE/'package-check.json').write_text(json.dumps(record,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(record,ensure_ascii=False))
