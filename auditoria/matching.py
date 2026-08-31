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
                    'origem': sub['origem'], 'destino': sub['destino'],
                    'produto': prod['codigo'], 'quantidade_pedida': prod['quantidade'],
                    'pedido_cliente': sub['pedido_cliente'],
                }

                if not candidatos:
                    registro['veredito'] = 'NAO_ENCONTRADO'
                    registro['detalhe'] = 'nenhuma transferência encontrada com este produto'
                    resultado.append(registro)
                    continue

                candidatos.sort(key=lambda c: -c['score'])
                melhores = [c for c in candidatos if c['score'] == candidatos[0]['score']]

                if len(melhores) > 1 and candidatos[0]['score'] < 2:
                    registro['veredito'] = 'AMBIGUO'
                    registro['detalhe'] = f'{len(melhores)} transferências candidatas, nenhuma bate 100% (rota+quantidade)'
                    registro['candidatos'] = [c['transferencia']['codigo'] for c in melhores[:5]]
                    resultado.append(registro)
                    continue
                if len(melhores) > 1 and candidatos[0]['score'] == 2:
                    registro['veredito'] = 'AMBIGUO'
                    registro['detalhe'] = f'{len(melhores)} transferências batem exatamente (produto+rota+quantidade) - possível duplicidade'
                    registro['candidatos'] = [c['transferencia']['codigo'] for c in melhores[:5]]
                    resultado.append(registro)
                    continue

                c = melhores[0]
                t, it = c['transferencia'], c['item']
                usados.add((t['codigo'], p))
                registro['transferencia_codigo'] = t['codigo']
                registro['transferencia_motivo'] = t['motivo']
                registro['transferencia_status'] = t['status']
                registro['quantidade_executada'] = it['quantidade']

                problemas = []
                if not c['rota_ok']:
                    problemas.append(f"rota diverge (pedido: {sub['origem']}->{sub['destino']}, executado: {t['empresa_origem']}->{t['empresa_destino']})")
                if not c['qtd_ok']:
                    problemas.append(f"quantidade diverge (pedido: {prod['quantidade']}, executado: {it['quantidade']})")
                if sub['pedido_cliente'] and not t['motivo'].strip().startswith('2'):
                    problemas.append(f"tem número de PEDIDO de cliente ({sub['pedido_cliente']}) mas motivo da transferência não é '2 - atender pedido' (motivo real: {t['motivo']})")
                if not sub['pedido_cliente'] and t['motivo'].strip().startswith('2'):
                    problemas.append("transferência veio com motivo '2 - atender pedido' mas atendimento não cita PEDIDO de cliente")

                if problemas:
                    registro['veredito'] = 'DIVERGENTE'
                    registro['detalhe'] = '; '.join(problemas)
                else:
                    registro['veredito'] = 'BATIDO'
                    registro['detalhe'] = 'produto, quantidade e rota conferem'
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
                    'veredito': 'SEM_ATENDIMENTO',
                    'detalhe': 'transferência executada no sistema sem atendimento de solicitação correspondente encontrado',
                })
    return resultado, orfas


def match_uso_consumo(atendimentos, correcoes):
    """Mesma logica, mas para atendimentos tipo USO E CONSUMO x correcoes de estoque tipo 'Uso e consumo'."""
    idx = {}
    usos = [c for c in correcoes if c['tipo_correcao'] == 'Uso e consumo']
    for c in usos:
        for it in c['itens']:
            idx.setdefault(norm_produto(it['produto']), []).append((c, it))

    usados = set()
    resultado = []
    for at in atendimentos:
        for sub in at['sub_pedidos']:
            for prod in sub['produtos']:
                p = norm_produto(prod['codigo'])
                candidatos_brutos = idx.get(p, [])
                candidatos = []
                for c, it in candidatos_brutos:
                    chave = (c['codigo'], p)
                    if chave in usados:
                        continue
                    qtd_ok = qtd_bate(prod['quantidade'], it['quantidade'])
                    candidatos.append({'correcao': c, 'item': it, 'qtd_ok': qtd_ok})

                registro = {
                    'atendimento_controle': at['controle'], 'atendimento_data': at['data'],
                    'produto': prod['codigo'], 'quantidade_pedida': prod['quantidade'],
                }
                if not candidatos:
                    registro['veredito'] = 'NAO_ENCONTRADO'
                    registro['detalhe'] = 'nenhuma saída de uso/consumo encontrada com este produto'
                    resultado.append(registro)
                    continue

                exatos = [c for c in candidatos if c['qtd_ok']]
                escolhidos = exatos if exatos else candidatos
                if len(escolhidos) > 1:
                    registro['veredito'] = 'AMBIGUO'
                    registro['detalhe'] = f'{len(escolhidos)} correções candidatas para o mesmo produto'
                    registro['candidatos'] = [c['correcao']['codigo'] for c in escolhidos[:5]]
                    resultado.append(registro)
                    continue

                c = escolhidos[0]
                cor, it = c['correcao'], c['item']
                usados.add((cor['codigo'], p))
                registro['correcao_codigo'] = cor['codigo']
                registro['correcao_empresa'] = cor['empresa']
                registro['quantidade_executada'] = it['quantidade']
                if not c['qtd_ok']:
                    registro['veredito'] = 'DIVERGENTE'
                    registro['detalhe'] = f"quantidade diverge (pedido: {prod['quantidade']}, executado: {it['quantidade']})"
                else:
                    registro['veredito'] = 'BATIDO'
                    registro['detalhe'] = 'produto e quantidade conferem'
                resultado.append(registro)

    orfas = []
    for c in usos:
        for it in c['itens']:
            chave = (c['codigo'], norm_produto(it['produto']))
            if chave not in usados:
                orfas.append({
                    'correcao_codigo': c['codigo'], 'produto': it['produto'],
                    'quantidade': it['quantidade'], 'empresa': c['empresa'], 'data': c['data'],
                    'veredito': 'SEM_ATENDIMENTO',
                    'detalhe': 'saída de uso/consumo lançada no sistema sem atendimento de solicitação correspondente',
                })
    return resultado, orfas
