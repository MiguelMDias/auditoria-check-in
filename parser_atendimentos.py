# -*- coding: utf-8 -*-
"""
Protótipo de parser de Atendimentos (Santri ADM - relatório PDF).
Extrai, por atendimento:
  - numero de controle, prioridade, data, solicitante, status final, tipo (transferencia/uso e consumo)
  - texto original do pedido (a parte "Aberto" mais antiga do tramite)
  - sub-pedidos: quando o atendimento cita mais de uma rota (origem->destino) ou mais de um
    numero de PEDIDO, cada um vira um sub-registro com sua propria lista de produtos/quantidades
"""
import re
import sys
import json

# separador de BLOCO (atendimento->atendimento): comeca na coluna 0, sem indentacao.
# separadores DENTRO do bloco (entre eventos do tramite) vem indentados com espacos - nao contam.
DASH_LINE = re.compile(r'^-{20,}$')  # aplicado apenas a linha SEM strip (ver split_blocks)

# linha-resumo: "220.971      Alta     29/08/2026      4.056 - EVERTHON 430 TRANSFERENCIA CFC PARA CFS ( DAR BAIXA NA CAF    Baixado         016.002 - TRANSFERENCIA"
SUMMARY_RE = re.compile(
    r'^\s*(\d{2,3}\.\d{3})\s+(Alta|Baixa|Média|Media)\s+(\d{2}/\d{2}/\d{4})\s+(.*?)\s+'
    r'(Baixado|Cancelado|Homologado|Homologação cancelada|Atendido|Aberto|Pausado|Em atendimento|Aguardando requisição)\s+'
    r'(\d{3}\.\d{3}\s*-\s*.+)$'
)

# marcador "Aberto  DATA  HORA  SOLICITANTE" (linha de abertura original dentro do historico)
ABERTO_RE = re.compile(
    r'^\s*Aberto\s+(\d{2}/\d{2}/\d{4})\s+(\d{2}:\d{2}:\d{2})\s+(.+?)\s*$'
)

# marcadores de rota origem->destino (varias variacoes encontradas no texto real)
ROUTE_PATTERNS = [
    r'\bDA\s+(?P<origem>[A-Z]{2,5})\s+PARA\s+(?:O\s+|A\s+)?(?P<destino>[A-Z]{2,5})\b',
    r'\b(?P<origem>[A-Z]{2,5})\s*[>\-]{1,2}\s*(?P<destino>[A-Z]{2,5})\b',
    r'\b(?P<origem>[A-Z]{2,5})\s+P/\s*(?P<destino>[A-Z]{2,5})\b',
    r'\b(?P<origem>[A-Z]{2,5})\s+PARA\s+(?P<destino>[A-Z]{2,5})\b',
    r'\bLOJA\s+(?P<origem>[A-Z]{2,5})\s+DESTINO\s+(?P<destino>[A-Z]{2,5})\b',
    r'\bDE:\s*(?P<origem>[A-Z]{2,5})\b.*?\bPARA:\s*(?P<destino>[A-Z]{2,5})\b',
]
ROUTE_RES = [re.compile(p, re.IGNORECASE) for p in ROUTE_PATTERNS]

KNOWN_EMPRESAS = {"CFS","CFVP","CFR","CFC","CFW3","CFT","CFG","CFJB","CFPA","CFBS"}

PEDIDO_RE = re.compile(r'PEDIDO[:\s]*([0-9]{6,})', re.IGNORECASE)

# produto + quantidade em varios formatos encontrados no texto real:
#  "4234>6 und", "119927---------7 und", "COD:130232", "ADM 137.853 QUANT 5",
#  "130931 QT 03", "51.188----- 1", "COD:137.997 4 INID", "126922 QT: 17,93 MTS"
PRODUCT_LINE_RE = re.compile(
    r'(?:COD|ADM|CODIGO)?\.?:?\s*'
    r'\(?'                                                  # parenteses opcionais em volta (ex: "68.945(04 UNID.)")
    r'(\d{1,3}(?:\.\d{3})+|\d{4,8})'                      # codigo do produto
    r'\)?'
    r'\s*(?:[-\.>=/]{1,25}|QT\.?D?\.?|QUANT\.?|QUANTIDADE|QDT\.?)?\s*[:=]?\s*'  # separador (simbolo, palavra, ou so espaco)
    r'\(?'
    r'(\d+(?:[.,]\d+)?)\s*'                                # quantidade
    r'(UND\.?|UN\.?|UNID\.?|UNIDADES?|UNI\.?|MTS?|M2|M3|SC|KG|LT|LITROS?|PCT|CX|PE[ÇC]AS?)?'
    r'\)?',
    re.IGNORECASE
)

def norm_code(s):
    return s.replace('.', '')

FURNITURE_EXACT = {
    'Status','Baixado','Homologado','Homologação cancelada','Em homologação',
    'Atendido','Pausado','Em atendimento','Aguardando requisição','Aberto',
}

def is_furniture(line):
    s = line.strip()
    if not s:
        return True
    if DASH_LINE.match(s):                       # qualquer linha de tracejado (titulo OU separador de atend.)
        return True
    if s.startswith('Acompanhamento de Controles'):
        return True
    if s.startswith('ADM 1.1.5.9'):               # rodape "ADM 1.1.5.9 R1 Emitido em ... Página NNNN/0042"
        return True
    if 'F I L T R O S' in s or s.startswith('Ordenação'):
        return True
    if s.startswith('Controle atend.') and 'Tipo de controle' in s:  # cabecalho de coluna (repete a cada pagina)
        return True
    if s in FURNITURE_EXACT:                      # legenda de status isolada (bloco de filtros no fim do doc)
        return True
    return False

def split_blocks(raw_text):
    """
    Estrategia robusta a quebra de pagina: remove toda a "mobilia" do relatorio
    (titulo, cabecalho de coluna repetido a cada pagina, rodape, form-feed, linhas
    de tracejado) e depois usa a propria linha-resumo (SUMMARY_RE) como ancora de
    inicio de cada atendimento — assim, se o texto original de um atendimento for
    longo o suficiente pra atravessar uma quebra de pagina, ele continua sendo
    tratado como UM UNICO bloco (a mobilia no meio e' descartada, nao quebra o bloco).
    """
    raw_text = raw_text.replace('\f', '\n')
    lines = [l for l in raw_text.split('\n') if not is_furniture(l)]

    blocks = []
    current = []
    for line in lines:
        if SUMMARY_RE.match(line):
            if current:
                blocks.append(current)
            current = [line]
        else:
            if current:  # ignora qualquer coisa antes do primeiro resumo encontrado
                current.append(line)
    if current:
        blocks.append(current)
    return blocks

def find_summary(block_lines):
    for line in block_lines:
        m = SUMMARY_RE.match(line)
        if m:
            return {
                'controle': m.group(1),
                'prioridade': m.group(2),
                'data': m.group(3),
                'solicitante_assunto_raw': m.group(4).strip(),
                'status_final': m.group(5),
                'tipo_controle': m.group(6).strip(),
            }
    return None

def find_original_request_text(block_lines):
    """
    O texto original do pedido fica ENTRE a ultima linha 'Aberto DATA HORA SOLICITANTE'
    (mais antiga, no fim do bloco no layout deste relatorio) e o fim do bloco.
    """
    aberto_idx = None
    for i, line in enumerate(block_lines):
        if ABERTO_RE.match(line):
            aberto_idx = i  # mantem a ULTIMA ocorrencia (a mais antiga = pedido original)
    if aberto_idx is None:
        return ''
    text_lines = block_lines[aberto_idx+1:]
    text_lines = [l.strip() for l in text_lines if l.strip()]
    return '\n'.join(text_lines)

def extract_pedidos_numbers(text):
    return PEDIDO_RE.findall(text)

def extract_route_segments(text):
    """
    Divide o texto em segmentos por marcador de rota. Retorna lista de dicts:
    {origem, destino, texto_produtos}
    Se nao achar nenhuma rota, retorna 1 segmento sem origem/destino (rota indefinida).
    """
    matches = []
    for rx in ROUTE_RES:
        for m in rx.finditer(text):
            o, d = m.group('origem').upper(), m.group('destino').upper()
            if o in KNOWN_EMPRESAS and d in KNOWN_EMPRESAS:
                matches.append((m.start(), m.end(), o, d))
    matches.sort(key=lambda x: x[0])
    # dedup por posicao proxima (regex sobrepostas)
    dedup = []
    for m in matches:
        if dedup and m[0] - dedup[-1][1] < 3:
            continue
        dedup.append(m)

    if not dedup:
        return [{'origem': None, 'destino': None, 'texto': text}]

    segments = []
    for i, (start, end, o, d) in enumerate(dedup):
        seg_start = end
        seg_end = dedup[i+1][0] if i+1 < len(dedup) else len(text)
        segments.append({'origem': o, 'destino': d, 'texto': text[seg_start:seg_end].strip()})
    # texto antes da primeira rota (pode conter produtos que pertencem a ela, dependendo do padrao)
    pre_text = text[:dedup[0][0]].strip()
    if pre_text:
        segments[0]['texto'] = pre_text + '\n' + segments[0]['texto']
    return segments

def extract_products(text):
    # remove linhas de "PEDIDO: NNNNN" antes de procurar produtos, senao o proprio
    # numero do pedido de cliente e capturado como se fosse codigo de produto
    text_sem_pedido = PEDIDO_RE.sub('', text)
    produtos = []
    for m in PRODUCT_LINE_RE.finditer(text_sem_pedido):
        codigo, qtd, und = m.groups()
        produtos.append({
            'codigo': norm_code(codigo),
            'quantidade': qtd.replace(',', '.'),
            'unidade': (und or '').upper() or None,
        })
    return produtos

def parse_atendimento_block(block_lines):
    summary = find_summary(block_lines)
    if not summary:
        return None
    original_text = find_original_request_text(block_lines)
    pedidos = extract_pedidos_numbers(original_text)
    segments = extract_route_segments(original_text)

    sub_pedidos = []
    for seg in segments:
        produtos = extract_products(seg['texto'])
        seg_pedidos = extract_pedidos_numbers(seg['texto'])
        sub_pedidos.append({
            'origem': seg['origem'],
            'destino': seg['destino'],
            'pedido_cliente': seg_pedidos[0] if seg_pedidos else None,
            'produtos': produtos,
            'texto_bruto': seg['texto'][:300],
        })

    tem_produto = any(sp['produtos'] for sp in sub_pedidos)

    return {
        'controle': summary['controle'],
        'data': summary['data'],
        'status_final': summary['status_final'],
        'tipo_controle': summary['tipo_controle'],
        'tem_pedido_cliente': len(pedidos) > 0,
        'pedidos_clientes': pedidos,
        'qtd_sub_rotas': len([s for s in sub_pedidos if s['origem']]),
        'sub_pedidos': sub_pedidos,
        'texto_original': original_text[:500],
        # marca se o atendimento entra na auditoria automatica ou precisa de revisao manual
        'status_extracao': 'ok' if tem_produto else 'revisao_manual',
        'motivo_revisao': None if tem_produto else 'nenhum produto/quantidade identificado no texto do pedido',
    }

def parse_file(path):
    """
    Retorna (auditaveis, revisao_manual, blocos_sem_resumo)
      auditaveis     -> atendimentos com pelo menos 1 produto extraido, prontos pro cruzamento
      revisao_manual -> atendimentos parseados mas sem produto identificado (isolados, nao entram
                         no cruzamento automatico ate alguem confirmar manualmente o conteudo)
      blocos_sem_resumo -> nao foi nem possivel identificar o resumo do atendimento (corrupcao no PDF fonte)
    """
    with open(path, encoding='utf-8') as f:
        raw = f.read()
    blocks = split_blocks(raw)
    auditaveis, revisao_manual = [], []
    sem_resumo = 0
    for b in blocks:
        parsed = parse_atendimento_block(b)
        if parsed is None:
            joined = '\n'.join(b).strip()
            if joined:
                sem_resumo += 1
            continue
        if parsed['status_extracao'] == 'ok':
            auditaveis.append(parsed)
        else:
            revisao_manual.append(parsed)
    return auditaveis, revisao_manual, sem_resumo

if __name__ == '__main__':
    path = sys.argv[1]
    auditaveis, revisao_manual, sem_resumo = parse_file(path)
    print(f"Auditaveis (com produto): {len(auditaveis)}")
    print(f"Revisao manual (sem produto): {len(revisao_manual)}")
    print(f"Corrompidos no PDF fonte (sem resumo identificavel): {sem_resumo}")
