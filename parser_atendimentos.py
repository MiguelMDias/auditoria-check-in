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

KNOWN_EMPRESAS = {"CFS","CFVP","CFR","CFC","CFW3","CFT","CFG","CFJB","CFPA","CFBS","CAP99"}

# apelidos por extenso das lojas (o solicitante as vezes escreve o nome da cidade
# em vez do codigo da empresa) - acento/maiuscula sao normalizados antes de comparar
ALIASES_LOJA = {
    "CFS":   ["CFS", "SAMAMBAIA"],
    "CFR":   ["CFR", "RECANTO"],
    "CFVP":  ["CFVP", "VICENTE PIRES", "VICENTE"],
    "CFC":   ["CFC", "CEILANDIA"],
    "CFW3":  ["CFW3", "ASA NORTE", "W3"],
    "CFT":   ["CFT", "TAGUATINGA"],
    "CFG":   ["CFG", "GAMA"],
    "CFJB":  ["CFJB", "JARDIM BOTANICO", "JARDIM"],
    "CFPA":  ["CFPA", "PONTE ALTA"],
    "CFBS":  ["CFBS", "BERNARDO SAYAO", "BERNADO SAYAO"],
    "CAP99": ["CAP99", "CAPITAL ATACADISTA", "CAPITAL"],
}

_ACCENT_TABLE = str.maketrans(
    'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
    'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'
)

def sem_acento_maiuscula(s):
    """remove acentos (1-por-1, preserva o tamanho da string) e poe em maiusculas"""
    return s.translate(_ACCENT_TABLE).upper()

# mapa reverso: alias normalizado (sem acento/maiuscula) -> codigo da empresa
_ALIAS_PARA_CODIGO = {}
for _codigo, _nomes in ALIASES_LOJA.items():
    for _nome in _nomes:
        _ALIAS_PARA_CODIGO[sem_acento_maiuscula(_nome)] = _codigo

def resolve_empresa(texto):
    """aceita tanto o codigo (CFS) quanto o nome da cidade (Samambaia/Ceilândia...)"""
    if not texto:
        return None
    return _ALIAS_PARA_CODIGO.get(sem_acento_maiuscula(texto.strip()))

# alternativa regex com todos os apelidos conhecidos, do mais longo pro mais curto
# (pra "JARDIM BOTANICO" nao ser cortado por um alias mais curto que apareca antes)
_TODOS_ALIASES = sorted(_ALIAS_PARA_CODIGO.keys(), key=len, reverse=True)
_PLACE_ALT = '|'.join(re.escape(a).replace(r'\ ', r'\s+') for a in _TODOS_ALIASES)
PLACE_RE_TXT = r'(?:' + _PLACE_ALT + r')'

# marcadores de rota origem->destino (varias variacoes encontradas no texto real),
# agora aceitando tanto o codigo da empresa quanto o nome da cidade por extenso
ROUTE_PATTERNS = [
    r'\bD[AO]\s+(?P<origem>' + PLACE_RE_TXT + r')\s+PARA\s+(?:O\s+|A\s+)?(?P<destino>' + PLACE_RE_TXT + r')\b',
    r'\b(?P<origem>' + PLACE_RE_TXT + r')\s*[>\-]{1,2}\s*(?P<destino>' + PLACE_RE_TXT + r')\b',
    r'\b(?P<origem>' + PLACE_RE_TXT + r')\s+P/\s*(?P<destino>' + PLACE_RE_TXT + r')\b',
    r'\b(?P<origem>' + PLACE_RE_TXT + r')\s+PARA\s+(?P<destino>' + PLACE_RE_TXT + r')\b',
    r'\bLOJA\s+(?P<origem>' + PLACE_RE_TXT + r')\s+DESTINO\s+(?P<destino>' + PLACE_RE_TXT + r')\b',
    r'\bDE:\s*(?P<origem>' + PLACE_RE_TXT + r')\b.*?\bPARA:\s*(?P<destino>' + PLACE_RE_TXT + r')\b',
]
ROUTE_RES = [re.compile(p, re.IGNORECASE) for p in ROUTE_PATTERNS]

# marcadores que so citam a ORIGEM (o destino fica implicito - normalmente a
# propria loja de quem esta' atendendo o pedido). Ex: "TRAZER DA LOJA DE TAGUATINGA",
# "DA LOJA DA CEILANDIA", "VEM DA LOJA GAMA"
ORIGIN_ONLY_PATTERNS = [
    r'\bDA\s+LOJA\s+(?:DE\s+|DA\s+|DO\s+)?(?P<origem>' + PLACE_RE_TXT + r')\b',
    r'\bDA\s+LOJA\s+(?P<origem>' + PLACE_RE_TXT + r')\b',
]
ORIGIN_ONLY_RES = [re.compile(p, re.IGNORECASE) for p in ORIGIN_ONLY_PATTERNS]

PEDIDO_RE = re.compile(r'PEDIDO[:\s]*([0-9]{6,})', re.IGNORECASE)

# produto + quantidade em varios formatos encontrados no texto real:
#  "4234>6 und", "119927---------7 und", "COD:130232", "ADM 137.853 QUANT 5",
#  "130931 QT 03", "51.188----- 1", "COD:137.997 4 INID", "126922 QT: 17,93 MTS"
PRODUCT_LINE_RE = re.compile(
    r'(?:COD|ADM|CODIGO)?\.?:?\s*'
    r'\(?'                                                  # parenteses opcionais em volta (ex: "68.945(04 UNID.)")
    r'(?<!\d)(\d{1,3}(?:\.\d{3})+|\d{4,6})(?!\d)'                 # codigo do produto (lookahead evita comer digito demais)
    r'\)?'
    r'\s*(?:[-\.>=/]{1,25}|QT\.?D?\.?|QUANT\.?|QUANTIDADE|QDT\.?|QUAT\.?)?\s*[:=]?\s*'  # separador (simbolo, palavra, ou so espaco)
    r'\(?\s*'                                              # "( quantidade" - parenteses com espaco depois, ex: "106246 ( 3 und )"
    r'(\d+(?:[.,]\d+)?)\s*'                                # quantidade
    r'(UND\.?|UN\.?|UNID\.?|UNIDADES?|UNI\.?|MTS?|M2|M3|SC|KG|LT|LITROS?|PCT|CX|PE[ÇC]AS?)?'
    r'\s*\)?',
    re.IGNORECASE
)

def norm_code(s):
    return s.replace('.', '')

# ---------------------------------------------------------------- FALLBACK (2o padrao)
# Cobre pedidos de uniforme/EPI/material de escritorio, que seguem uma gramatica
# diferente da transferencia normal: quantidade PRIMEIRO, nome do produto por
# extenso, codigo (quando existe) no FINAL da linha - as vezes sem codigo nenhum.
# So roda quando o padrao principal (PRODUCT_LINE_RE) nao achou nada no segmento,
# pra nao arriscar falso positivo em texto que ja foi bem interpretado.

NOISE_LINES = re.compile(
    r'^(BOM DIA|BOA TARDE|BOA NOITE|OBRIGAD[AO]|GRATO|GRATA|ATT\.?!?|ATENCIOSAMENTE|'
    r'OBS\.?:?.*|OBSERVA[ÇC][AÃ]O:?.*|SOLICITO A RETIRADA.*|POR FAVOR.*)$',
    re.IGNORECASE
)

# "02 Camiseta vermelha masculina tamanho"G"" ou "01 Botina Ocupacional tamanho"41" 122.164"
QTY_FIRST_RE = re.compile(
    r'^\s*(\d{1,2})\s+'                                     # quantidade (1-2 digitos, sempre no comeco da linha)
    r'([A-Za-zÀ-Ÿà-ÿ][A-Za-zÀ-Ÿà-ÿ0-9"\'\s]{2,55}?)'          # nome do produto por extenso
    r'(?:\s+(?<!\d)(\d{1,3}(?:\.\d{3})+|\d{4,6})(?!\d))?'                # codigo opcional no final
    r'\s*$'
)

# "115.598 = luva preta = 01"
CODE_EQ_NAME_EQ_QTY_RE = re.compile(
    r'(?<!\d)(\d{1,3}(?:\.\d{3})+|\d{4,6})(?!\d)\s*=\s*([^=\n]{2,55}?)\s*=\s*(\d+(?:[.,]\d+)?)'
)

# "147 > 1 unidade" - mesmo padrao do principal mas aceitando codigo curto (2-3 digitos)
# quando o separador ">" deixa claro que e' um par codigo/quantidade
SHORT_CODE_RE = re.compile(
    r'^\s*(\d{2,3})\s*>\s*(\d+(?:[.,]\d+)?)\s*(UND\.?|UNIDADES?|UN\.?)?\s*$',
    re.IGNORECASE
)

# "...FITILHO 3 UNIDADES" / "...04 CANETAS AZUL" - nome + quantidade + unidade no
# final da frase (as vezes com a unidade omitida, ex: "ENVIAR 04 CANETAS AZUL")
TRAILING_QTY_RE = re.compile(
    r'([A-ZÀ-Úa-zà-ú][A-Za-zÀ-Ÿà-ÿ]*(?:\s+[A-ZÀ-Úa-zà-ú][A-Za-zÀ-Ÿà-ÿ]*){0,2})'
    r'\s+(\d{1,3}(?:[.,]\d+)?)\s+(UNIDADES?|UND\.?|UN\.?)\b',
    re.IGNORECASE
)
LEADING_QTY_NAME_RE = re.compile(
    r'\b(\d{1,2})\s+([A-ZÀ-Ú]{3,}(?:\s+[A-ZÀ-Ú]{2,}){0,2})\s*$'
)

# produto com nome longo no meio: "CODIGO  NOME DO PRODUTO POR EXTENSO (pode ter
# dimensao tipo 62X62 no meio)  [CX]  QUANTIDADE  UNIDADE" - a quantidade+unidade
# sempre no FINAL da linha. Cobre piso/porcelanato/revestimento (unidade M2/MT) e
# qualquer outro produto com nome/descricao comprida antes da quantidade real
# (ex: "136.197 TELHA RESIDENCIAL 3,66 X 1,10M 6M MULT 01 UN").
CODE_NOME_QTD_RE = re.compile(
    r'^\s*(?<!\d)(\d{1,3}(?:\.\d{3})+|\d{4,6})(?!\d)\s+'      # codigo do produto
    r'.+?'                                        # nome do produto (nao-guloso, pode ter "NNxNN")
    r'\s+(?:CX\s+)?'                              # "CX" opcional antes da quantidade
    r'(\d+(?:[.,]\d+)?)\s*'                       # quantidade
    r'(UND\.?|UN\.?|UNID\.?|UNIDADES?|UNI\.?|MTS?|M2|M3|SC|KG|LT|LITROS?|PCT|PE[ÇC]AS?)\.?\s*$',  # unidade, sempre no final
    re.IGNORECASE
)

def extract_products_codigo_nome_qtd(text):
    produtos = []
    for linha in text.split('\n'):
        linha = linha.strip()
        if not linha:
            continue
        m = CODE_NOME_QTD_RE.match(linha)
        if m:
            codigo, qtd, und = m.groups()
            produtos.append({'codigo': norm_code(codigo), 'nome': None,
                              'quantidade': qtd.replace(',', '.'), 'unidade': und.upper(),
                              'metodo': 'codigo_nome_qtd'})
    return produtos

def extract_products_fallback(text):
    produtos = []
    achados_qtd_pos = set()

    for linha in text.split('\n'):
        linha = linha.strip()
        if not linha or NOISE_LINES.match(linha):
            continue

        m = CODE_EQ_NAME_EQ_QTY_RE.search(linha)
        if m:
            codigo, nome, qtd = m.groups()
            produtos.append({'codigo': norm_code(codigo), 'nome': nome.strip(),
                              'quantidade': qtd.replace(',', '.'), 'unidade': None,
                              'metodo': 'codigo=nome=qtd'})
            continue

        m = QTY_FIRST_RE.match(linha)
        if m:
            qtd, nome, codigo = m.groups()
            produtos.append({'codigo': norm_code(codigo) if codigo else None,
                              'nome': nome.strip(), 'quantidade': qtd.replace(',', '.'),
                              'unidade': None, 'metodo': 'qtd_primeiro'})
            continue

        m = SHORT_CODE_RE.match(linha)
        if m:
            codigo, qtd, und = m.groups()
            produtos.append({'codigo': norm_code(codigo), 'nome': None,
                              'quantidade': qtd.replace(',', '.'),
                              'unidade': (und or '').upper() or None,
                              'metodo': 'codigo_curto'})
            continue

    if not produtos:
        # ultimo recurso: procura "NOME ... QTD UNIDADE" em qualquer lugar do texto
        # (cobre "SOLICITO A SAIDA DE USO E CONSUMO FITILHO 3 UNIDADES")
        for m in TRAILING_QTY_RE.finditer(text):
            nome, qtd, und = m.groups()
            nome = nome.strip()
            if NOISE_LINES.match(nome) or len(nome) < 3:
                continue
            produtos.append({'codigo': None, 'nome': nome, 'quantidade': qtd.replace(',', '.'),
                              'unidade': und.upper(), 'metodo': 'nome+qtd_final'})
        if not produtos:
            # ultimo-ultimo recurso: "FAVOR NOS ENVIAR 04 CANETAS AZUL" (sem unidade)
            for m in LEADING_QTY_NAME_RE.finditer(text):
                qtd, nome = m.groups()
                if NOISE_LINES.match(nome):
                    continue
                produtos.append({'codigo': None, 'nome': nome.strip().title(),
                                  'quantidade': qtd, 'unidade': None, 'metodo': 'qtd+nome_maiusculo'})
    return produtos

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

def find_usuario_baixa(block_lines):
    """
    O primeiro evento 'Baixado' encontrado no bloco e' o mais recente (o historico
    vem em ordem reversa) - ou seja, e' quem de fato deu baixa no atendimento.
    """
    for line in block_lines:
        m = re.match(r'^\s*Baixado\s+\d{2}/\d{2}/\d{4}\s+\d{2}:\d{2}:\d{2}\s+(.+?)\s*$', line)
        if m:
            return m.group(1).strip()
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

def _dedup_overlaps(matches):
    """recebe lista de (start, end, ...) ja ordenada e remove sobreposicoes"""
    dedup = []
    for m in matches:
        if dedup and m[0] < dedup[-1][1]:
            continue
        dedup.append(m)
    return dedup

def _find_route_matches(text):
    """acha todos os marcadores de rota (completos ou so-origem) no texto, deduplicados"""
    texto_norm = sem_acento_maiuscula(text)
    matches = []
    for rx in ROUTE_RES:
        for m in rx.finditer(texto_norm):
            o, d = resolve_empresa(m.group('origem')), resolve_empresa(m.group('destino'))
            if o and d:
                matches.append((m.start(), m.end(), o, d))
    for rx in ORIGIN_ONLY_RES:
        for m in rx.finditer(texto_norm):
            o = resolve_empresa(m.group('origem'))
            if o:
                matches.append((m.start(), m.end(), o, None))
    matches.sort(key=lambda x: (x[0], -(x[1] - x[0])))
    return _dedup_overlaps(matches)

def _segments_forward(text, matches):
    """o rotulo vale pro texto que vem DEPOIS dele, ate o proximo rotulo (padrao
    'DA X PARA Y' \\n item \\n item \\n 'DA W PARA Z' \\n item...)"""
    segments = []
    for i, (start, end, o, d) in enumerate(matches):
        seg_start = end
        seg_end = matches[i+1][0] if i+1 < len(matches) else len(text)
        segments.append({'origem': o, 'destino': d, 'texto': text[seg_start:seg_end].strip()})
    pre_text = text[:matches[0][0]].strip()
    if pre_text:
        segments[0]['texto'] = pre_text + '\n' + segments[0]['texto']
    return segments

def _segments_backward(text, matches):
    """o rotulo vale pro texto que vem ANTES dele, desde o rotulo anterior (padrao
    item \\n 'DE X PARA Y' \\n item \\n 'DE W PARA Z'...) - tao comum quanto o forward"""
    segments = []
    prev_end = 0
    for (start, end, o, d) in matches:
        segments.append({'origem': o, 'destino': d, 'texto': text[prev_end:start].strip()})
        prev_end = end
    trailing = text[prev_end:].strip()
    if trailing and segments:
        segments[-1]['texto'] = (segments[-1]['texto'] + '\n' + trailing).strip()
    return segments

def extract_route_segments(text):
    """
    Divide o texto em segmentos por marcador de rota. Retorna lista de dicts:
    {origem, destino, texto_produtos}
    Se nao achar nenhuma rota, retorna 1 segmento sem origem/destino (rota indefinida).

    Roda o casamento numa versao do texto sem acento/maiuscula (mesmo tamanho da
    original, char a char) pra aceitar "Ceilândia"/"CEILANDIA"/"ceilandia" igual,
    mas fatiar o texto ORIGINAL nas mesmas posicoes (os indices batem 1-a-1).

    O rotulo de rota pode vir ANTES do item que descreve ("DA X PARA Y" seguido da
    lista) ou DEPOIS ("item" seguido de "DE X PARA Y") - as duas formas aparecem na
    pratica, dependendo de quem digitou o pedido. Por isso tenta as duas direcoes
    (forward e backward) e escolhe a que deixa CADA rota com pelo menos 1 produto
    reconhecido e sem sobra - a direcao errada tende a duplicar item em uma rota e
    deixar outra vazia.
    """
    matches = _find_route_matches(text)
    if not matches:
        return [{'origem': None, 'destino': None, 'texto': text}]
    if len(matches) == 1:
        return _segments_forward(text, matches)  # com 1 rota so, forward e backward dao no mesmo

    forward = _segments_forward(text, matches)
    backward = _segments_backward(text, matches)

    def vazios(segments):
        return sum(1 for s in segments if s['origem'] and not extract_products(s['texto']))

    return forward if vazios(forward) <= vazios(backward) else backward

def extract_products(text):
    # remove linhas de "PEDIDO: NNNNN" antes de procurar produtos, senao o proprio
    # numero do pedido de cliente e capturado como se fosse codigo de produto
    text_sem_pedido = PEDIDO_RE.sub('', text)
    produtos = []
    for m in PRODUCT_LINE_RE.finditer(text_sem_pedido):
        codigo, qtd, und = m.groups()
        produtos.append({
            'codigo': norm_code(codigo),
            'nome': None,
            'quantidade': qtd.replace(',', '.'),
            'unidade': (und or '').upper() or None,
            'metodo': 'codigo>qtd',
        })
    if not produtos:
        produtos = extract_products_codigo_nome_qtd(text_sem_pedido)
    if not produtos:
        produtos = extract_products_fallback(text_sem_pedido)
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

    # se so' existe UM numero de pedido pra todo o atendimento (comum quando o mesmo
    # pedido de cliente e' atendido a partir de varias lojas de origem por falta de
    # estoque - o PEDIDO aparece uma vez so, no topo, valendo pra todas as rotas),
    # propaga esse numero pras rotas que nao tem pedido proprio no seu segmento.
    # Se houver mais de um numero de pedido distinto, NAO propaga (cada um ja deve
    # estar no segmento certo, propagar seria arriscar atribuir errado).
    if len(pedidos) == 1:
        for sp in sub_pedidos:
            if sp['pedido_cliente'] is None:
                sp['pedido_cliente'] = pedidos[0]

    tem_produto = any(sp['produtos'] for sp in sub_pedidos)

    return {
        'controle': summary['controle'],
        'data': summary['data'],
        'status_final': summary['status_final'],
        'tipo_controle': summary['tipo_controle'],
        'usuario_baixa': find_usuario_baixa(block_lines),
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
