"""Exact-string CSV/XLSX slices for owner-only retrieval; never execute macros.
Parsing bounds defend against malformed documents, not business call budgets.
"""
import csv,io,posixpath,zipfile,xml.etree.ElementTree as ET
from semantics import Rejected

def need(ok,code='READ_TABLE_FORMAT'):
    if not ok:raise Rejected(code)

def xml(data):
    need(len(data)<=24000000 and b'<!DOCTYPE'not in data.upper()and b'<!ENTITY'not in data.upper(),'READ_DOCUMENT_UNSAFE')
    try:return ET.fromstring(data)
    except ET.ParseError:raise Rejected('READ_DOCUMENT_XML')from None

def local_tag(e):return e.tag.split('}')[-1]

def page(raw,params):
    offset=params.get('offset',0);limit=params.get('limit',200);sheet=params.get('sheet')
    if raw.startswith(b'PK\x03\x04'):
        with zipfile.ZipFile(io.BytesIO(raw))as z:
            members=z.infolist();need(len(members)<=2000 and sum(m.file_size for m in members)<=48000000,'READ_DOCUMENT_UNSAFE')
            need(all(m.file_size<=max(m.compress_size,1)*200 for m in members),'READ_DOCUMENT_UNSAFE')
            if 'xl/workbook.xml'not in z.namelist():return None
            workbook=xml(z.read('xl/workbook.xml'));rels=xml(z.read('xl/_rels/workbook.xml.rels'))
            mappings={x.attrib['Id']:x.attrib['Target']for x in rels if x.attrib.get('TargetMode')!='External'}
            sheets=[s for s in workbook.iter()if local_tag(s)=='sheet'];need(sheets,'READ_TABLE_SHEET')
            selected=next((s for s in sheets if s.attrib['name']==sheet),None)if sheet is not None else sheets[0];need(selected is not None,'READ_TABLE_SHEET')
            rid=next((v for k,v in selected.attrib.items()if k.endswith('}id')),None);need(rid in mappings,'READ_DOCUMENT_UNSAFE')
            target=mappings[rid];name=posixpath.normpath('xl/'+target)if not target.startswith('/')else target.lstrip('/')
            need(name.startswith('xl/')and '..'not in name.split('/')and name in z.namelist(),'READ_DOCUMENT_UNSAFE')
            strings=[]
            if 'xl/sharedStrings.xml'in z.namelist():
                strings=[''.join(t.text or''for t in si.iter()if local_tag(t)=='t')for si in xml(z.read('xl/sharedStrings.xml'))if local_tag(si)=='si']
            rows=[]
            for r in xml(z.read(name)).iter():
                if local_tag(r)!='row':continue
                row=[]
                for cell in r:
                    if local_tag(cell)!='c':continue
                    position=cell.attrib.get('r','A');letters=''.join(x for x in position if x.isalpha());column=0
                    for letter in letters:column=column*26+ord(letter.upper())-64
                    need(1<=column<=16384,'READ_DOCUMENT_UNSAFE')
                    while len(row)<column:row.append(None)
                    typ=cell.attrib.get('t');v=next((x.text for x in cell if local_tag(x)=='v'),None)
                    if typ=='s':need(v is not None and v.isdigit()and int(v)<len(strings));v=strings[int(v)]
                    elif typ=='inlineStr':v=''.join(x.text or''for x in cell.iter()if local_tag(x)=='t')
                    # Cached formula values stay exact strings; no evaluation.
                    row[column-1]=v
                rows.append(row)
            fmt='XLSX_RAW_CELL_STRINGS';sheet_name=selected.attrib['name']
    else:
        if raw.startswith((b'%PDF-',b'\x89PNG',b'\xff\xd8')):return None
        try:text=raw.decode('utf-8-sig')
        except UnicodeDecodeError:
            try:text=raw.decode('cp1251')
            except UnicodeDecodeError:return None
        if '\x00'in text:return None
        try:dialect=csv.Sniffer().sniff(text[:16384],delimiters=',;\t')
        except csv.Error:return None
        rows=list(csv.reader(io.StringIO(text),dialect));fmt='CSV_EXACT_STRINGS';sheet_name=None
        need(sheet in(None,''),'READ_TABLE_SHEET')
    cut=rows[offset:offset+limit]
    return {'format':fmt,'sheet':sheet_name,'offset':offset,'rows_count':len(cut),'has_more':offset+len(cut)<len(rows),'rows':cut,'numeric_interpretation':'SOURCE_STRINGS_NO_INFERRED_DATES_OR_ZERO','scope':'OWNER_ONLY'}
