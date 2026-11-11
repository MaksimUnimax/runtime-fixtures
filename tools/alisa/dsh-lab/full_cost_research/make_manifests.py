"""Recreate the recorded synthetic inputs exactly; this script makes no API calls."""
from pathlib import Path
import json,sys
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE.parent/'boundary_research'))
from fixtures import sum_case
def case(n,seed,sequence,phase,reverse=False):
    c=sum_case(n,seed)
    c.update(rows=n,cache_sequence=sequence,cache_phase=phase,
             question='Сколько составили расходы на логистику Вайлдберриз за восьмое ноября?' if phase=='first' else 'Какова сумма расходов на логистику Вайлдберриз за восьмое ноября?',
             methods=['harness','direct'] if reverse else ['direct','harness'])
    return c
def build():
    control={'campaign':'full_cost_20261111_control','period':'2026-11-08','cases':[case(800,811,'c800_v1','first')]}
    grid={'campaign':'full_cost_20261111_grid','period':'2026-11-08','cases':[]}
    for rep in range(2):
        for n in [10,30,100]:
            for j,phase in enumerate(['first','next']):
                grid['cases'].append(case(n,61000+rep*1000+n*2+j,f'g_{rep}_{n}',phase,bool((rep+j)%2)))
    confirm={'campaign':'full_cost_20261111_confirm50','period':'2026-11-08','cases':[]}
    for rep in range(6):
        for j,phase in enumerate(['first','next']):
            confirm['cases'].append(case(50,71000+rep*10+j,f'c50_{rep}',phase,bool((rep+j)%2)))
    return {'control.json':control,'grid.json':grid,'confirm50.json':confirm}
if __name__=='__main__':
    target=Path(sys.argv[1]) if len(sys.argv)>1 else HERE
    target.mkdir(parents=True,exist_ok=True)
    for name,manifest in build().items():
        (target/name).write_text(json.dumps(manifest,ensure_ascii=False,separators=(',',':')))
