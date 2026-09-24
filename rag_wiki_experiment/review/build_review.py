"""Build the standalone review page from the original evaluation dataset."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
source = ROOT.parent / 'config' / 'rag_evaluation_dataset_100.json'
data = json.loads(source.read_text(encoding='utf-8'))
serialized = json.dumps(data, ensure_ascii=False)
fingerprint = hashlib.sha256(serialized.encode()).hexdigest()
html = (ROOT / 'review_template.html').read_text(encoding='utf-8')
html = html.replace('__DATASET__', serialized.replace('<', '\\u003c')).replace('__FINGERPRINT__', fingerprint)
output = ROOT / 'rag_evaluation_review_100.html'
output.write_text(html, encoding='utf-8')
print(f'Built {output} ({len(data)} questions)')
