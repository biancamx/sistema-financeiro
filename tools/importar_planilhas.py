#!/usr/bin/env python3
"""
Atualiza backend/src/db/seed-data.json com os dados de uma planilha nova (ex.: Financeiro_2027.xlsx).

Regra: o ano da planilha nova manda naquele ano. Tudo que for de OUTROS anos continua como está.

  python3 tools/importar_planilhas.py Financeiro_2027.xlsx --ano 2027
  python3 tools/importar_planilhas.py Financeiro_2027.xlsx --ano 2027 --relabel Pessoa 07:2027=2026

O que ele traz da planilha:
  * aba "Banco De Dados"   -> parcelas do ano (compras novas entram; compras que já existem ganham as parcelas
                              que faltavam; parcelas do ano que não estão na planilha nova saem)
  * abas "Financeiro <X>"  -> planilha mensal de cada pessoa que tem aba própria (Pessoa 01, Pessoa 07…)
  * aba "financeiro geral" -> contas fixas (luz, água, internet, veículo…) e status Pago/Pendente de cada pessoa

Precisa de: pip install openpyxl     Rode de dentro da pasta do projeto. Faz backup do JSON antes de gravar.
"""
import argparse, datetime, json, re, shutil, sys
from pathlib import Path
import openpyxl

MESES = {'janeiro': 1, 'fevereiro': 2, 'março': 3, 'marco': 3, 'abril': 4, 'maio': 5, 'junho': 6, 'julho': 7,
         'agosto': 8, 'setembro': 9, 'outubro': 10, 'novembro': 11, 'dezembro': 12}
# nomes de pessoa que têm aba própria -> nome da aba (qualquer aba "Financeiro X" ou com o nome da pessoa)
SECOES_BLOCO = {  # cabeçalho da aba -> chave da seção do sistema
    'investimentos': 'investments', 'descontos': 'deductions', 'alimentação x combustivel': 'food',
    'despesas veiculos': 'vehicle', 'variadas': 'misc', 'moradia': 'housing',
}
CORRECOES_ROTULO = {'Seeguro': 'Seguro', 'iPVA moto': 'IPVA moto'}


def num(v):
    return round(float(v), 2) if isinstance(v, (int, float)) else 0.0


# ───────────────────────── parcelas ─────────────────────────
def ler_parcelas(ws, ano):
    """Uma linha por parcela. Colunas: [data | descrição] [descrição | categoria] pessoa total qtd parcela mês ano cartão."""
    linhas = []
    for i, r in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        if r[6] is None or r[2] is None or r[7] is None or int(r[7]) != ano:
            continue
        tem_data = isinstance(r[0], (datetime.datetime, datetime.date))
        desc = r[1] if tem_data else r[0]
        cat = r[1]   # com data: a descrição é também a categoria; sem data: a categoria vem na coluna seguinte
        linhas.append(dict(
            row=i, date=r[0].strftime('%Y-%m-%d') if tem_data else None,
            description=str(desc).strip() if desc not in (None, '') else 'Compra',
            category=str(cat).strip() if cat not in (None, '') else None,
            person=str(r[2]).strip(), card=str(r[8] or '').strip(), total=float(r[3]), count=int(r[4]),
            year=int(r[7]), month=MESES[str(r[6]).strip().lower()], amount=r[5]))
    return linhas


def chave(p):
    return (p['date'], p['description'], p['category'], p['person'], p['card'], p['total'], p['count'])


def agrupar(linhas):
    """Linhas seguidas da mesma compra (mesma chave, meses crescentes) = uma compra."""
    out, cur = [], None
    for r in linhas:
        ym = r['year'] * 12 + r['month']
        if cur and cur['key'] == chave(r) and r['row'] == cur['row'] + 1 and ym > cur['ym']:
            cur['months'].append((r['year'], r['month']))
            cur['row'], cur['ym'] = r['row'], ym
        else:
            cur = dict(key=chave(r), months=[(r['year'], r['month'])], row=r['row'], ym=ym)
            out.append(cur)
    return out


def importar_parcelas(seed, ws, ano, rel):
    compras = seed['purchases']
    antes_ano = sum(1 for p in compras for i in p['installments'] if i['year'] == ano)
    novas = agrupar(ler_parcelas(ws, ano))
    por_chave = {}
    for p in compras:
        por_chave.setdefault(chave(p), []).append(p)
    usadas = set()
    adicionadas = 0
    for n in novas:
        achou = next((p for p in por_chave.get(n['key'], []) if id(p) not in usadas), None)
        if achou:
            usadas.add(id(achou))
            # parcelas do ano: as da planilha nova substituem as antigas
            achou['installments'] = [i for i in achou['installments'] if i['year'] != ano]
            for y, m in n['months']:
                achou['installments'].append(dict(year=y, month=m, number=0))
        else:
            d, desc, cat, pessoa, cartao, total, qtd = n['key']
            compras.append(dict(description=desc, category=cat, person=pessoa, card=cartao, date=d, total=total,
                                count=qtd, installments=[dict(year=y, month=m, number=0) for y, m in n['months']]))
            usadas.add(id(compras[-1]))
            adicionadas += 1
            rel.append(f'compra nova: {pessoa} · {desc} · {cartao} · {total} em {qtd}x ({len(n["months"])} parcelas em {ano})')
    # compras antigas que tinham parcelas em `ano` mas não estão na planilha nova: perdem essas parcelas
    for p in compras:
        if id(p) in usadas:
            continue
        ant = len(p['installments'])
        p['installments'] = [i for i in p['installments'] if i['year'] != ano]
        if len(p['installments']) != ant:
            rel.append(f'parcelas de {ano} removidas (não estão na planilha nova): {p["person"]} · {p["description"]} · {p["total"]} em {p["count"]}x')
    seed['purchases'] = [p for p in compras if p['installments']]
    # numeração: 1..N na ordem do calendário (como já era no seed)
    for p in seed['purchases']:
        p['installments'].sort(key=lambda i: (i['year'], i['month']))
        for k, i in enumerate(p['installments'], 1):
            i['number'] = k
        if len(p['installments']) > p['count']:
            rel.append(f'ATENÇÃO: {p["person"]} · {p["description"]} tem {len(p["installments"])} parcelas lançadas para {p["count"]}x')
    depois_ano = sum(1 for p in seed['purchases'] for i in p['installments'] if i['year'] == ano)
    rel.append(f'parcelas de {ano}: {antes_ano} -> {depois_ano} ({adicionadas} compra(s) nova(s))')


# ───────────────────────── planilha mensal (aba da pessoa) ─────────────────────────
def ler_aba_pessoa(ws):
    rows, secao, receitas = [], None, 0
    for r in ws.iter_rows(min_row=1, values_only=True):
        a = str(r[0]).strip() if r[0] is not None else ''
        vals = list(r[1:13])
        cab = a.lower()
        if all(v is None for v in vals) and a:
            if cab == 'receitas':
                receitas += 1
                secao = 'income' if receitas == 1 else 'benefits'
            elif cab == 'resumo geral':
                break
            elif cab in ('despesas variáveis', 'cartão de crédito'):
                secao = None if cab == 'cartão de crédito' else secao
            else:
                secao = next((v for k, v in SECOES_BLOCO.items() if cab.startswith(k)), secao)
            continue
        if not secao or not a or a in ('-', 'Total', 'Categoria'):
            continue
        de = r[17] if len(r) > 17 and r[17] not in (None, '-') else None
        obs = r[19] if len(r) > 19 and r[19] not in (None, '-') else None
        rows.append(dict(section=secao, label=a, values=[num(v) for v in vals], receivableFrom=de, obs=obs))
    return rows


def importar_abas(seed, wb, ano, relabel, rel):
    pessoas = {p.lower(): p for p in seed['people']}
    for pessoa, de, para in relabel:   # corrige aba que veio com o ano errado na planilha antiga (antes de entrar a nova)
        for b in seed['budgets']:
            if b['person'] == pessoa and b['year'] == de:
                b['year'] = para
                rel.append(f'planilha mensal {pessoa}: ano {de} -> {para}')
    for ws in wb.worksheets:
        nome = ws.title.replace('Financeiro', '').strip()
        base = pessoas.get(nome.lower())
        if not base:
            continue
        rows = ler_aba_pessoa(ws)
        if not rows:
            continue
        seed['budgets'] = [b for b in seed['budgets'] if not (b['person'] == base and b['year'] == ano)]
        seed['budgets'].append(dict(person=base, year=ano, rows=rows))
        rel.append(f'planilha mensal {base} {ano}: {len(rows)} linhas (aba "{ws.title}")')
    seed['budgets'].sort(key=lambda b: (b['year'], b['person']))


# ───────────────────────── financeiro geral (contas fixas + status) ─────────────────────────
def importar_geral(seed, ws, ano, rel):
    cartoes = {c['name'].strip().lower() for c in seed['cards']}
    pessoas = {p.lower(): p for p in seed['people']}
    fixed = [f for f in seed.get('fixed', []) if f['year'] != ano]
    status = [s for s in seed.get('statuses', []) if s['year'] != ano]
    atual = None
    for r in ws.iter_rows(values_only=True):
        a = str(r[0]).strip() if r[0] is not None else ''
        vals = list(r[1:13])
        if not a or a == 'Mês' or a == 'Total Mês':
            continue
        if a.lower() in pessoas and all(v is None for v in vals):
            atual = dict(person=pessoas[a.lower()], year=ano, rows=[])
            fixed.append(atual)
        elif a == 'Status':
            for m, v in enumerate(vals, 1):
                if atual and v:
                    status.append(dict(person=atual['person'], year=ano, month=m, status='paid' if str(v).lower().startswith('pag') else 'pending'))
        elif atual and a.lower() not in cartoes and not all(v is None for v in vals):
            label = re.sub(r'\bipva\b', 'IPVA', CORRECOES_ROTULO.get(a, a), flags=re.I)
            atual['rows'].append(dict(label=label[0].upper() + label[1:], values=[num(v) for v in vals]))
    seed['fixed'] = [f for f in fixed if f['rows']]
    seed['fixed'].sort(key=lambda f: (f['year'], f['person']))
    seed['statuses'] = status
    rel.append('contas fixas ' + str(ano) + ': ' + ', '.join(f"{f['person']} ({len(f['rows'])})" for f in seed['fixed'] if f['year'] == ano))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('xlsx')
    ap.add_argument('--ano', type=int, required=True)
    ap.add_argument('--seed', default='backend/src/db/seed-data.json')
    ap.add_argument('--relabel', action='append', default=[], metavar='PESSOA:DE=PARA',
                    help='corrige o ano de uma planilha mensal já existente (ex.: Pessoa 07:2027=2026)')
    a = ap.parse_args()
    seed_path = Path(a.seed)
    seed = json.loads(seed_path.read_text(encoding='utf-8'))
    wb = openpyxl.load_workbook(a.xlsx, data_only=True)
    rel = []
    relabel = []
    for x in a.relabel:
        pessoa, resto = x.split(':')
        de, para = resto.split('=')
        relabel.append((pessoa, int(de), int(para)))
    importar_parcelas(seed, wb['Banco De Dados'], a.ano, rel)
    importar_abas(seed, wb, a.ano, relabel, rel)
    importar_geral(seed, wb['financeiro geral'], a.ano, rel)
    shutil.copy(seed_path, seed_path.with_suffix('.json.bak'))
    seed_path.write_text(json.dumps(seed, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print('\n'.join('• ' + x for x in rel))
    print(f'\nGravado em {seed_path} (backup: {seed_path.with_suffix(".json.bak")}). Agora rode: npm run seed')


if __name__ == '__main__':
    sys.exit(main())
