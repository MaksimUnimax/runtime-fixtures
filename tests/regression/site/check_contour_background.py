from pathlib import Path
from PIL import Image
import sys,json,re
root=Path(sys.argv[1]);r=json.loads((root/'results.json').read_text());results=[]
for item in r['pixel_samples']:
 im=Image.open(item['path']).convert('RGB');expected=tuple(map(int,re.findall(r'\d+',item['background'])[:3]));w,h=im.size
 samples=[im.getpixel(p) for p in [(2,2),(w-3,2),(2,h-3),(w-3,h-3)]]
 error=max(abs(v-e) for sample in samples for v,e in zip(sample,expected));assert error<=2,(item['path'],expected,samples)
 results.append({'image':Path(item['path']).name,'expected_page_background':expected,'corners':samples,'max_error':error,'result':'PASS'})
(root/'pixel-check.json').write_text(json.dumps({'status':'PASS','count':len(results),'samples':results},indent=2)+'\n');print('PIXEL_BACKGROUND_PASS',len(results))
