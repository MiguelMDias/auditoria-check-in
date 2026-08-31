# -*- coding: utf-8 -*-
"""
Protótipo de parser dos exports .ods do Santri ADM:
  - Relação de Transferências - Analítico
  - Relação de Correções de Estoque - Analítico (inclui o tipo "Uso e consumo")

Ambos seguem o mesmo layout em blocos: 1 linha-resumo do registro + N linhas de item,
separados por 1 linha em branco. Aqui a gente detecta os blocos de forma generica.
"""
import re
import json
import pandas as pd

KNOWN_EMPRESAS = {"CFS","CFVP","CFR","CFC","CFW3","CFT","CFG","CFJB","CFPA","CFBS"}

def clean(v):
    if pd.isna(v):
        return ''
    return str(v).replace('\n', ' ').strip()

def is_blank_row(row):
    return all(clean(v) == '' for v in row)

def to_float(v):
    v = clean(v)
    if not v:
        return None
    v = v.replace('.', '').replace(',', '.')
    try:
        return float(v)
    except ValueError:
        return None

# ---------------------------------------------------------------- TRANSFERENCIAS
TRANSF_COLS = ['codigo','empresa_origem','empresa_destino','motivo','status','motorista_cod',
               'motorista_nome','valor_produtos','valor_st','valor_ipi','valor_transferencia',
               'valor_frete','peso','valor_rpa','valor_frete_pago','data_cadastro',
               'data_transporte','data_entrada','usuario_insercao','controla_manifesto',
               'manifesto','gerada_automaticamente']

CODE_SUMMARY_RE = re.compile(r'^\d{1,3}\.\d{3}$')

def parse_transferencias(path):
    df = pd.read_excel(path, engine='odf', header=None)
    registros = []
    atual = None
    for i in range(len(df)):
        row = df.iloc[i].tolist()
        c0, c1 = clean(row[0]), clean(row[1])
        if is_blank_row(row):
            continue
        if c1 == 'Produto':          # cabecalho de item (repete a cada bloco) - ignora
            continue
        if CODE_SUMMARY_RE.match(c0) and c1 in KNOWN_EMPRESAS:
            # nova transferencia
            if atual:
                registros.append(atual)
            vals = [clean(v) for v in row]
            atual = {
                'codigo': vals[0],
                'empresa_origem': vals[1],
                'empresa_destino': vals[2],
                'motivo': vals[3],
                'status': vals[4],
                'valor_transferencia': to_float(vals[10]) if len(vals) > 10 else None,
                'peso': to_float(vals[12]) if len(vals) > 12 else None,
                'data_cadastro': vals[15] if len(vals) > 15 else '',
                'data_transporte': vals[16] if len(vals) > 16 else '',
                'data_entrada': vals[17] if len(vals) > 17 else '',
                'usuario_insercao': vals[18] if len(vals) > 18 else '',
                'manifesto': vals[20] if len(vals) > 20 else '',
                'itens': [],
            }
        elif atual is not None and c0 == '' and c1 != '':
            # linha de item: Produto, Nome, Marca, Und., Cod original, Lote, Quantidade, Peso, Preco, Total...
            vals = [clean(v) for v in row]
            atual['itens'].append({
                'produto': vals[1],
                'nome': vals[2] if len(vals) > 2 else '',
                'marca': vals[3] if len(vals) > 3 else '',
                'unidade': vals[4] if len(vals) > 4 else '',
                'quantidade': to_float(vals[7]) if len(vals) > 7 else None,
                'preco': to_float(vals[9]) if len(vals) > 9 else None,
                'total': to_float(vals[10]) if len(vals) > 10 else None,
            })
    if atual:
        registros.append(atual)
    return registros

# ---------------------------------------------------------------- CORRECOES / USO E CONSUMO
def parse_correcoes(path):
    df = pd.read_excel(path, engine='odf', header=None)
    registros = []
    atual = None
    for i in range(len(df)):
        row = df.iloc[i].tolist()
        c0, c1 = clean(row[0]), clean(row[1])
        if is_blank_row(row):
            continue
        if c1 == 'Produto':
            continue
        if CODE_SUMMARY_RE.match(c0) and c1 in KNOWN_EMPRESAS:
            if atual:
                registros.append(atual)
            vals = [clean(v) for v in row]
            atual = {
                'codigo': vals[0],
                'empresa': vals[1],
                'data': vals[2],
                'tipo_correcao': vals[3],          # ex: "Uso e consumo", "Brinde"
                'usuario_insercao': vals[4],
                'qtd_itens': vals[5],
                'valor_saida': to_float(vals[7]) if len(vals) > 7 else None,
                'peso_total': to_float(vals[9]) if len(vals) > 9 else None,
                'observacao': vals[10] if len(vals) > 10 else '',
                'usuario_requisicao': vals[11] if len(vals) > 11 else '',
                'usuario_retirou': vals[12] if len(vals) > 12 else '',
                'itens': [],
            }
        elif atual is not None and c0 == '' and c1 != '':
            vals = [clean(v) for v in row]
            atual['itens'].append({
                'produto': vals[1],
                'descricao': vals[2] if len(vals) > 2 else '',
                'local': vals[4] if len(vals) > 4 else '',
                'motivo': vals[6] if len(vals) > 6 else '',
                'tipo': vals[7] if len(vals) > 7 else '',
                'custo': to_float(vals[8]) if len(vals) > 8 else None,
                'quantidade': to_float(vals[9]) if len(vals) > 9 else None,
                'novo_estoque_fisico': to_float(vals[10]) if len(vals) > 10 else None,
            })
    if atual:
        registros.append(atual)
    return registros

if __name__ == '__main__':
    import sys
    tipo, path = sys.argv[1], sys.argv[2]
    fn = parse_transferencias if tipo == 'transferencias' else parse_correcoes
    regs = fn(path)
    print(f"Registros: {len(regs)}")
    print(json.dumps(regs[:3], ensure_ascii=False, indent=2))
