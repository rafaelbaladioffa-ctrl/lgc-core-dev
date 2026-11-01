"""Gera prisma/catalog-data.ts a partir das tabelas 8.1–8.8 de PLANNING_LOGISTICA.md (8.9 = químicos fica de fora de propósito).
Uso: python scripts/generate-catalog.py <caminho do PLANNING_LOGISTICA.md>"""
import json, re, sys

text = open(sys.argv[1], encoding='utf-8').read()
a = text.index('## 8. Catálogo')
b = text.index('### 8.9')
sec = text[a:b]

TYPE_BY_PREFIX = {'EPI': 'EPI', 'EPC': 'EPC', 'FER': 'FERRAMENTA', 'EQP': 'EQUIPAMENTO', 'EMB': 'EMBALAGEM'}
heads = [(m.start(), m.group(1).strip()) for m in re.finditer(r'^### 8\.\d+ (.+)$', sec, re.M)]

def category_at(pos):
    name = [h for p, h in heads if p <= pos][-1]
    return name

items = []
for m in re.finditer(r'^\| ([A-Z]{2,4}-[A-Z0-9]{2,4}-\d{4}) \| (.+?) \| (.+?) \| (.*?) \|\s*$', sec, re.M):
    code, desc, um, ctrl = (x.strip() for x in m.groups())
    prefix = code.split('-')[0]
    c = ctrl.lower()
    typ = TYPE_BY_PREFIX.get(prefix, 'CONSUMO')
    if code in ('TI-NOT-0001', 'TI-CEL-0001'):
        typ = 'ATIVO'
    serial = 'série' in c or 'imei' in c
    exp = 'validade' in c
    lot = 'lote' in c or exp
    asset = 'patrimônio' in c and 'opcional' not in c
    ca = bool(re.search(r'(^|[ ,/])ca($|[ ,/])', c))
    calib = 'calibração' in c
    returnable = 'retornável' in c or 'custodiante' in c or typ in ('FERRAMENTA', 'EQUIPAMENTO')
    item = {
        'code': code, 'description': desc, 'uom': um.split('/')[0].strip(), 'type': typ,
        'category': category_at(m.start()), 'subcategory': code.split('-')[1],
        'controls': ctrl,
        'lotControlled': lot, 'expiryControlled': exp, 'serialControlled': serial, 'assetTagged': asset,
        'requiresCa': ca, 'requiresCalibration': calib, 'returnable': returnable, 'disposable': 'descartável' in c,
        'repairable': 'manutenção' in c, 'hasSizeGrid': 'tamanho' in c or 'numeração' in c,
        'exitMethod': 'SERIE_ESPECIFICA' if serial else ('FEFO' if exp else 'FIFO'),
        'criticality': 'A' if prefix == 'EPI' and code.startswith('EPI-ALT') else ('B' if ca else 'C'),
    }
    if 'inflamável' in c:
        item['riskClass'] = 'INFLAMAVEL'
        item['storageCondition'] = 'Local ventilado, longe de fontes de ignição'
    elif 'sds' in c or 'fispq' in c:
        item['storageCondition'] = 'Manter SDS/FISPQ disponível no local de guarda'
    items.append(item)

codes = [i['code'] for i in items]
assert len(codes) == len(set(codes)), 'códigos duplicados na seção 8'
out = '// GERADO por scripts/generate-catalog.py a partir das tabelas 8.1–8.8 do PLANNING_LOGISTICA.md — não editar à mão.\n'
out += '// Semente de implantação: marcas, modelos, tamanhos, CAs e quantidades mínimas devem ser confirmados pela LGC (seção 28). 8.9 (químicos) só após validação técnica/HSE.\n'
out += 'export interface CatalogItem {\n  code: string; description: string; uom: string; type: string; category: string; subcategory: string; controls: string;\n  lotControlled: boolean; expiryControlled: boolean; serialControlled: boolean; assetTagged: boolean; requiresCa: boolean; requiresCalibration: boolean;\n  returnable: boolean; disposable: boolean; repairable: boolean; hasSizeGrid: boolean; exitMethod: string; criticality: string; riskClass?: string; storageCondition?: string;\n}\n\n'
out += 'export const CATALOG: CatalogItem[] = ' + json.dumps(items, ensure_ascii=False, indent=2) + ';\n'
open('prisma/catalog-data.ts', 'w', encoding='utf-8').write(out)
by = {}
for i in items: by[i['category']] = by.get(i['category'], 0) + 1
print(len(items), by)
