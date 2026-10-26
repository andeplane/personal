"""Validate append-only print records and assemble the public index. No dependencies."""
import json, re, hashlib
from pathlib import Path
from datetime import datetime
ROOT = Path(__file__).resolve().parent
STATUSES = {'planned', 'printing', 'paused', 'completed', 'failed', 'cancelled', 'completed_partial'}
def build():
    records = []
    for path in sorted((ROOT / 'records').glob('*.json')):
        run = json.loads(path.read_text())
        assert run['id'] == path.stem and re.fullmatch(r'[a-z0-9-]+', run['id']), path
        assert run['status'] in STATUSES, path
        if run['status'] == 'paused':
            evidence = run.get('pauseEvidence', {})
            assert evidence.get('printerState') == 'PAUSE', path
            assert type(evidence.get('printError')) is int and evidence['printError'] >= 0, path
            datetime.fromisoformat(evidence['observedAt'].replace('Z', '+00:00'))
            assert run['finishedAt'] is None, path
        if run['status'] == 'completed_partial':
            assert run.get('terminalEvidence', {}).get('printerState') == 'FINISH', path
            skipped = run.get('skippedParts', [])
            assert skipped and set(skipped) < set(run['parts']), path
        for key in ['title', 'project', 'printer', 'jobName', 'material', 'notes']:
            assert isinstance(run[key], str) and run[key], (path, key)
        assert run['parts'] and all(isinstance(p, str) for p in run['parts']), path
        assert re.fullmatch(r'#[0-9a-fA-F]{6}', run['color']), path
        assert run['source']['sha256'] is None or re.fullmatch(r'[0-9a-f]{64}', run['source']['sha256']), path
        for key in ['recordedAt', 'startedAt', 'finishedAt']:
            if run[key] is not None: datetime.fromisoformat(run[key].replace('Z', '+00:00'))
        for key in ['estimatedSeconds', 'actualSeconds', 'estimatedGrams', 'actualGrams', 'estimatedMeters']:
            assert run[key] is None or isinstance(run[key], (int, float)) and run[key] >= 0, (path, key)
        # An unsliced planned record has no preview; listed captures must still be real files.
        images = [i for i in (run['preview'], run['layout']) if i is not None]
        for image in images + [s['src'] for s in run['snapshots']] + [s['src'] for s in run.get('evidenceImages', [])]:
            resolved = (ROOT / image).resolve()
            assert image.startswith('assets/') and resolved.is_relative_to(ROOT / 'assets') and resolved.is_file(), image
        for shot in run['snapshots']:
            datetime.fromisoformat(shot['capturedAt'].replace('Z', '+00:00'))
            assert shot['caption'], path
        for image in run.get('evidenceImages', []):
            assert image['caption'] and image['kind'], path
            assert re.fullmatch(r'[0-9a-f]{64}', image['sha256']), path
            assert hashlib.sha256((ROOT / image['src']).read_bytes()).hexdigest() == image['sha256'], path
        records.append(run)
    records.sort(key=lambda r: (r['startedAt'] or r.get('printDate') or r['recordedAt'], r.get('sequence', 0)), reverse=True)
    (ROOT / 'records.json').write_text(json.dumps(records, ensure_ascii=False, indent=2) + '\n')
    print(f'Validated {len(records)} print records and all referenced images.')
if __name__ == '__main__': build()
