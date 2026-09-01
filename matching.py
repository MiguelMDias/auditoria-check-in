# -*- coding: utf-8 -*-
"""
Motor de cruzamento da auditoria: liga Atendimento (solicitacao) <-> Transferencia/
Correcao (execucao). Gera o veredito final de cada atendimento auditavel:

  BATIDO       -> achou 1 execucao que bate produto + quantidade (+ rota, quando aplicavel)
  DIVERGENTE   -> achou uma execucao candidata, mas algo nao bate (quantidade, motivo,
                  ou rota) - listado com o motivo especifico da divergencia
  AMBIGUO      -> mais de 1 candidato igualmente valido -> fica pra revisao humana
  NAO_ENCONTRADO -> nenhuma execucao correspondente
"""
import json
import re
import unicodedata

STOPWORDS = {
    'de','da','do','das','dos','para','com','sem','tamanho','cor','uso','consumo',
    'e','o','a','os','as','um','uma','n','no','na',
}

# so' transferencias feitas por esses funcionarios entram na auditoria - qualquer
# transferencia executada por outra pessoa e' ignorada por completo (nem casa com
# atendimento, nem vira "execucao orfa" - some da contagem inteira).
FUNCIONARIOS_PERMITIDOS = {
    "4023",  # Miguel
    "4121",  # Marcos Vinicius
    "4140",  # Ramos
    "2696",  # Dias
    "4260",  # Deyvid
    "4645",  # Tavares
    "3725",  # Queiroz
}

def _codigo_usuario(usuario_str):
    """extrai o codigo numerico do inicio de 'usuario_insercao', ex: '4.023 - MIGUEL 1247' -> '4023'"""
    if not usuario_str:
        return None
    primeiro_token = str(usuario_str).strip().split(' ')[0] if str(usuario_str).strip() else ''
    return primeiro_token.replace('.', '')

def eh_funcionario_permitido(usuario_str):
    return _codigo_usuario(usuario_str) in FUNCIONARIOS_PERMITIDOS

# palavras genericas demais pra sozinhas confirmarem que dois produtos sao o mesmo
# (cor sozinha nao prova nada: "agasalho azul" e "luva azul" nao sao o mesmo item)
TOKENS_GENERICOS = {
    'azul','vermelho','vermelha','preto','preta','branco','branca','verde','amarelo',
    'amarela','cinza','rosa','laranja','marrom','roxo','grande','pequeno','medio',
    'novo','nova','tam','xg','gg','g','m','p','pp',
}

def normaliza_texto(s):
    """minusculas, sem acento, sem pontuacao - pra comparar nomes de produto"""
    if not s:
        return []
    s = unicodedata.normalize('NFKD', str(s)).encode('ascii', 'ignore').decode('ascii')
    s = re.sub(r'["\'\(\)]', ' ', s.lower())
    tokens = re.findall(r'[a-z0-9]+', s)
    tokens = [t[:-1] if t.endswith('s') and len(t) > 4 and not t.isdigit() else t for t in tokens]  # plural simples
    return [t for t in tokens if t not in STOPWORDS and len(t) > 1]

def score_nome(nome_pedido, descricao_execucao):
    """
    Conta tokens em comum entre o nome do pedido e a descricao do item executado.
    Um match sustentado APENAS por palavras genericas (cor, tamanho...) nao conta -
    senao "agasalho azul" bateria com "luva azul" so pela cor. Precisa de pelo menos
    1 palavra especifica em comum (ex: o nome do produto em si).
    """
    t1, t2 = set(normaliza_texto(nome_pedido)), set(normaliza_texto(descricao_execucao))
    overlap = t1 & t2
    especificos = overlap - TOKENS_GENERICOS
    if not especificos:
        return 0
    return len(overlap)

def norm_produto(p):
    return str(p).replace('.', '').lstrip('0') or '0'

def qtd_bate(q1, q2, tolerancia=0.001):
    if q1 is None or q2 is None:
        return False
    try:
        return abs(float(q1) - float(q2)) <= tolerancia
    except (TypeError, ValueError):
        return False

def match_transferencias(atendimentos, transferencias):
    """
    atendimentos: lista do parser_atendimentos (status_extracao == 'ok', tipo TRANSFERENCIA)
    transferencias: lista do parser_ods.parse_transferencias
    """
    # ignora por completo transferencias feitas por quem nao esta na lista de
    # funcionarios permitidos - nem entram no cruzamento, nem sobram como orfa
    transferencias = [t for t in transferencias if eh_funcionario_permitido(t.get('usuario_insercao'))]

    # indice por (produto normalizado) -> lista de transferencias que tem esse produto num item
    idx = {}
    for t in transferencias:
        for it in t['itens']:
            idx.setdefault(norm_produto(it['produto']), []).append((t, it))

    usados = set()  # (codigo_transferencia, produto) ja consumidos por um atendimento, evita reuso duplo
    resultado = []

    for at in atendimentos:
        for sub in at['sub_pedidos']:
            for prod in sub['produtos']:
                p = norm_produto(prod['codigo'])
                candidatos_brutos = idx.get(p, [])
                candidatos = []
                for t, it in candidatos_brutos:
                    chave = (t['codigo'], p)
                    if chave in usados:
                        continue
                    rota_ok = (sub['origem'] is None or sub['origem'] == t['empresa_origem']) and \
                              (sub['destino'] is None or sub['destino'] == t['empresa_destino'])
                    qtd_ok = qtd_bate(prod['quantidade'], it['quantidade'])
                    candidatos.append({
                        'transferencia': t, 'item': it,
                        'rota_ok': rota_ok, 'qtd_ok': qtd_ok,
                        'score': int(rota_ok) + int(qtd_ok),
                    })

                registro = {
                    'atendimento_controle': at['controle'],
                    'atendimento_data': at['data'],
                    'atendimento_usuario_baixa': at.get('usuario_baixa'),
                    'origem': sub['origem'], 'destino': sub['destino'],
                    'produto': prod['codigo'], 'quantidade_pedida': prod['quantidade'],
                    'pedido_cliente': sub['pedido_cliente'],
                }

                if not candidatos:
                    registro['veredito'] = 'NAO_ENCONTRADO'
                    registro['detalhe'] = 'Nenhuma transferência no sistema tem esse produto — o pedido pode não ter sido executado ainda, ou foi lançado com um código de produto diferente.'
                    resultado.append(registro)
                    continue

                candidatos.sort(key=lambda c: -c['score'])
                melhores = [c for c in candidatos if c['score'] == candidatos[0]['score']]

                if len(melhores) > 1 and candidatos[0]['score'] < 2:
                    registro['veredito'] = 'AMBIGUO'
                    registro['detalhe'] = f'Encontrei {len(melhores)} transferências com este produto, mas nenhuma bate exatamente em rota e quantidade ao mesmo tempo — confira manualmente qual delas corresponde a este pedido.'
                    registro['candidatos'] = [c['transferencia']['codigo'] for c in melhores[:5]]
                    resultado.append(registro)
                    continue
                if len(melhores) > 1 and candidatos[0]['score'] == 2:
                    registro['veredito'] = 'AMBIGUO'
                    registro['detalhe'] = f'Encontrei {len(melhores)} transferências que batem exatamente (produto, rota e quantidade) — pode ser duplicidade de lançamento, ou duas transferências reais e idênticas no mesmo dia. Confirme qual pertence a este pedido.'
                    registro['candidatos'] = [c['transferencia']['codigo'] for c in melhores[:5]]
                    resultado.append(registro)
                    continue

                c = melhores[0]
                t, it = c['transferencia'], c['item']
                usados.add((t['codigo'], p))
                registro['transferencia_codigo'] = t['codigo']
                registro['transferencia_motivo'] = t['motivo']
                registro['transferencia_status'] = t['status']
                registro['transferencia_usuario'] = t.get('usuario_insercao')
                registro['quantidade_executada'] = it['quantidade']

                problemas = []
                tipos = []
                if not c['rota_ok']:
                    tipos.append('rota')
                    problemas.append(
                        f"Rota diferente da pedida: o atendimento pediu {sub['origem'] or '?'} → {sub['destino'] or '?'}, "
                        f"mas a transferência encontrada foi de {t['empresa_origem']} → {t['empresa_destino']}."
                    )
                if not c['qtd_ok']:
                    tipos.append('quantidade')
                    try:
                        falta = float(str(prod['quantidade']).replace(',', '.')) - float(it['quantidade'])
                        falta_txt = f" (diferença de {abs(round(falta, 3))})" if falta != 0 else ""
                    except (TypeError, ValueError):
                        falta_txt = ""
                    problemas.append(
                        f"Quantidade diferente: pedido pediu {prod['quantidade']}, "
                        f"transferência executou {it['quantidade']}{falta_txt}."
                    )
                # (nao checa mais pareamento motivo "2 - atender pedido" x numero de PEDIDO
                # no atendimento - dava falso positivo demais, pedido do parser nem sempre
                # cita o numero do PEDIDO mesmo quando a transferencia e' motivo 2 de verdade)

                if problemas:
                    registro['veredito'] = 'DIVERGENTE'
                    registro['tipos_divergencia'] = tipos
                    registro['detalhe'] = ' '.join(problemas)
                else:
                    registro['veredito'] = 'BATIDO'
                    registro['detalhe'] = 'Produto, quantidade e rota conferem entre o pedido e a execução.'
                resultado.append(registro)

    # transferencias executadas sem NENHUM atendimento de origem (execucao "orfa")
    orfas = []
    for t in transferencias:
        for it in t['itens']:
            chave = (t['codigo'], norm_produto(it['produto']))
            if chave not in usados:
                orfas.append({
                    'transferencia_codigo': t['codigo'], 'produto': it['produto'],
                    'quantidade': it['quantidade'],
                    'origem': t['empresa_origem'], 'destino': t['empresa_destino'],
                    'motivo': t['motivo'], 'data': t['data_cadastro'],
                    'transferencia_usuario': t.get('usuario_insercao'),
                    'veredito': 'SEM_ATENDIMENTO',
                    'detalhe': 'Esta transferência foi executada no sistema, mas não encontrei nenhum atendimento (solicitação) que a originou.',
                })
    return resultado, orfas


def match_uso_consumo(atendimentos, correcoes):
    """
    Mesma logica de match_transferencias, mas para atendimentos tipo USO E CONSUMO x
    correcoes de estoque tipo 'Uso e consumo'. Produtos com codigo casam por indice
    (rapido e exato); produtos sem codigo (pedidos de uniforme/EPI em texto livre,
    ex: "02 Camiseta vermelha tamanho G") casam pelo NOME, comparando contra a
    descricao do item na correcao de estoque (normalizando acento/maiuscula/plural).
    """
    usos = [c for c in correcoes if c['tipo_correcao'] == 'Uso e consumo']

    idx_codigo = {}
    lista_itens = []  # (correcao, item) - usado na busca por nome
    for c in usos:
        for it in c['itens']:
            idx_codigo.setdefault(norm_produto(it['produto']), []).append((c, it))
            lista_itens.append((c, it))

    usados = set()
    resultado = []

    def candidatos_por_codigo(prod):
        p = norm_produto(prod['codigo'])
        out = []
        for c, it in idx_codigo.get(p, []):
            chave = (c['codigo'], p)
            if chave in usados:
                continue
            out.append({'correcao': c, 'item': it, 'qtd_ok': qtd_bate(prod['quantidade'], it['quantidade']),
                        'chave': chave, 'metodo': 'codigo'})
        return out

    def candidatos_por_nome(prod):
        melhores, melhor_score = [], 0
        for c, it in lista_itens:
            chave = (c['codigo'], 'nome:' + norm_produto(it['produto']))
            if chave in usados:
                continue
            score = score_nome(prod.get('nome'), it['descricao'])
            if score == 0:
                continue
            if score > melhor_score:
                melhores, melhor_score = [{'correcao': c, 'item': it,
                                            'qtd_ok': qtd_bate(prod['quantidade'], it['quantidade']),
                                            'chave': chave, 'metodo': 'nome', 'score': score}], score
            elif score == melhor_score:
                melhores.append({'correcao': c, 'item': it,
                                  'qtd_ok': qtd_bate(prod['quantidade'], it['quantidade']),
                                  'chave': chave, 'metodo': 'nome', 'score': score})
        return melhores

    for at in atendimentos:
        for sub in at['sub_pedidos']:
            for prod in sub['produtos']:
                usa_nome = not prod.get('codigo')
                candidatos = candidatos_por_nome(prod) if usa_nome else candidatos_por_codigo(prod)

                registro = {
                    'atendimento_controle': at['controle'], 'atendimento_data': at['data'],
                    'atendimento_usuario_baixa': at.get('usuario_baixa'),
                    'produto': prod['codigo'] or (prod.get('nome') or '(sem identificação)'),
                    'quantidade_pedida': prod['quantidade'],
                    'metodo_extracao': prod.get('metodo', 'codigo>qtd'),
                }
                if not candidatos:
                    registro['veredito'] = 'NAO_ENCONTRADO'
                    registro['detalhe'] = (
                        'Nenhuma saída de uso/consumo com este produto no sistema.'
                        if not usa_nome else
                        f'Nenhuma saída de uso/consumo com descrição parecida com "{prod.get("nome")}".'
                    )
                    resultado.append(registro)
                    continue

                exatos = [c for c in candidatos if c['qtd_ok']]
                escolhidos = exatos if exatos else candidatos
                if len(escolhidos) > 1:
                    registro['veredito'] = 'AMBIGUO'
                    registro['detalhe'] = f'Encontrei {len(escolhidos)} correções de estoque candidatas para o mesmo produto' + \
                        (' — casamento por nome, confira manualmente qual é a correta.' if usa_nome else ' — confira manualmente qual pertence a este pedido.')
                    registro['candidatos'] = [c['correcao']['codigo'] for c in escolhidos[:5]]
                    resultado.append(registro)
                    continue

                c = escolhidos[0]
                cor, it = c['correcao'], c['item']
                usados.add(c['chave'])
                registro['correcao_codigo'] = cor['codigo']
                registro['correcao_empresa'] = cor['empresa']
                registro['correcao_descricao'] = it['descricao']
                registro['quantidade_executada'] = it['quantidade']
                registro['correcao_usuario'] = cor.get('usuario_retirou') or cor.get('usuario_insercao')
                registro['casado_por'] = 'nome (sem código no pedido)' if usa_nome else 'código'
                if not c['qtd_ok']:
                    registro['veredito'] = 'DIVERGENTE'
                    registro['tipos_divergencia'] = ['quantidade']
                    registro['detalhe'] = f"Quantidade diferente: pedido pediu {prod['quantidade']}, saída de estoque registrou {it['quantidade']}."
                else:
                    registro['veredito'] = 'BATIDO'
                    registro['detalhe'] = 'Produto e quantidade conferem.' + (' Casado por nome (sem código no pedido).' if usa_nome else '')
                resultado.append(registro)

    orfas = []
    for c in usos:
        for it in c['itens']:
            chave_cod = (c['codigo'], norm_produto(it['produto']))
            chave_nome = (c['codigo'], 'nome:' + norm_produto(it['produto']))
            if chave_cod not in usados and chave_nome not in usados:
                orfas.append({
                    'correcao_codigo': c['codigo'], 'produto': it['produto'],
                    'descricao': it['descricao'],
                    'quantidade': it['quantidade'], 'empresa': c['empresa'], 'data': c['data'],
                    'correcao_usuario': c.get('usuario_retirou') or c.get('usuario_insercao'),
                    'veredito': 'SEM_ATENDIMENTO',
                    'detalhe': 'Esta saída de uso/consumo foi lançada no sistema, mas não encontrei nenhum atendimento (solicitação) que a originou.',
                })
    return resultado, orfas
