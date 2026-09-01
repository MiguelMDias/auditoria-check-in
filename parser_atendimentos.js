// Porta fiel de parser_atendimentos.py para JavaScript (roda no navegador).
// Qualquer mudanca aqui deve ser espelhada la, e vice-versa.

const DASH_LINE = /^-{20,}$/;

const SUMMARY_RE = new RegExp(
  '^\\s*(\\d{2,3}\\.\\d{3})\\s+(Alta|Baixa|Média|Media)\\s+(\\d{2}/\\d{2}/\\d{4})\\s+(.*?)\\s+' +
  '(Baixado|Cancelado|Homologado|Homologação cancelada|Atendido|Aberto|Pausado|Em atendimento|Aguardando requisição)\\s+' +
  '(\\d{3}\\.\\d{3}\\s*-\\s*.+)$'
);

const ABERTO_RE = /^\s*Aberto\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}:\d{2})\s+(.+?)\s*$/;

const FURNITURE_EXACT = new Set([
  'Status','Baixado','Homologado','Homologação cancelada','Em homologação',
  'Atendido','Pausado','Em atendimento','Aguardando requisição','Aberto',
]);

function isFurniture(line){
  const s = line.trim();
  if (!s) return true;
  if (DASH_LINE.test(s)) return true;
  if (s.startsWith('Acompanhamento de Controles')) return true;
  if (s.startsWith('ADM 1.1.5.9')) return true;
  if (s.includes('F I L T R O S') || s.startsWith('Ordenação')) return true;
  if (s.startsWith('Controle atend.') && s.includes('Tipo de controle')) return true;
  if (FURNITURE_EXACT.has(s)) return true;
  return false;
}

function splitBlocks(rawText){
  rawText = rawText.split('\f').join('\n');
  const lines = rawText.split('\n').filter(l => !isFurniture(l));
  const blocks = [];
  let current = [];
  for (const line of lines){
    if (SUMMARY_RE.test(line)){
      if (current.length) blocks.push(current);
      current = [line];
    } else if (current.length) {
      current.push(line);
    }
  }
  if (current.length) blocks.push(current);
  return blocks;
}

function findSummary(blockLines){
  for (const line of blockLines){
    const m = SUMMARY_RE.exec(line);
    if (m){
      return {
        controle: m[1], prioridade: m[2], data: m[3],
        solicitante_assunto_raw: m[4].trim(), status_final: m[5],
        tipo_controle: m[6].trim(),
      };
    }
  }
  return null;
}

function findUsuarioBaixa(blockLines){
  const re = /^\s*Baixado\s+\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2}\s+(.+?)\s*$/;
  for (const line of blockLines){
    const m = re.exec(line);
    if (m) return m[1].trim();
  }
  return null;
}

function findOriginalRequestText(blockLines){
  let abertoIdx = null;
  for (let i = 0; i < blockLines.length; i++){
    if (ABERTO_RE.test(blockLines[i])) abertoIdx = i;
  }
  if (abertoIdx === null) return '';
  return blockLines.slice(abertoIdx + 1).map(l => l.trim()).filter(Boolean).join('\n');
}

const PEDIDO_RE = /PEDIDO[:\s]*([0-9]{6,})/gi;

function extractPedidosNumbers(text){
  const out = [];
  let m;
  const re = new RegExp(PEDIDO_RE.source, 'gi');
  while ((m = re.exec(text)) !== null) out.push(m[1]);
  return out;
}

// ---------------- lojas / rotas ----------------
const KNOWN_EMPRESAS = new Set(["CFS","CFVP","CFR","CFC","CFW3","CFT","CFG","CFJB","CFPA","CFBS","CAP99"]);

const ALIASES_LOJA = {
  CFS:   ["CFS", "SAMAMBAIA"],
  CFR:   ["CFR", "RECANTO"],
  CFVP:  ["CFVP", "VICENTE PIRES", "VICENTE"],
  CFC:   ["CFC", "CEILANDIA"],
  CFW3:  ["CFW3", "ASA NORTE", "W3"],
  CFT:   ["CFT", "TAGUATINGA"],
  CFG:   ["CFG", "GAMA"],
  CFJB:  ["CFJB", "JARDIM BOTANICO"],
  CFPA:  ["CFPA", "PONTE ALTA"],
  CFBS:  ["CFBS", "BERNARDO SAYAO", "BERNADO SAYAO"],
  CAP99: ["CAP99", "CAPITAL ATACADISTA", "CAPITAL"],
};

const ACCENT_MAP = {
  'á':'a','à':'a','â':'a','ã':'a','ä':'a','é':'e','è':'e','ê':'e','ë':'e',
  'í':'i','ì':'i','î':'i','ï':'i','ó':'o','ò':'o','ô':'o','õ':'o','ö':'o',
  'ú':'u','ù':'u','û':'u','ü':'u','ç':'c',
  'Á':'A','À':'A','Â':'A','Ã':'A','Ä':'A','É':'E','È':'E','Ê':'E','Ë':'E',
  'Í':'I','Ì':'I','Î':'I','Ï':'I','Ó':'O','Ò':'O','Ô':'O','Õ':'O','Ö':'O',
  'Ú':'U','Ù':'U','Û':'U','Ü':'U','Ç':'C',
};

function semAcentoMaiuscula(s){
  return s.split('').map(c => ACCENT_MAP[c] || c).join('').toUpperCase();
}

const ALIAS_PARA_CODIGO = {};
for (const [codigo, nomes] of Object.entries(ALIASES_LOJA)){
  for (const nome of nomes) ALIAS_PARA_CODIGO[semAcentoMaiuscula(nome)] = codigo;
}

function resolveEmpresa(texto){
  if (!texto) return null;
  return ALIAS_PARA_CODIGO[semAcentoMaiuscula(texto.trim())] || null;
}

function escapeRegex(s){ return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

const TODOS_ALIASES = Object.keys(ALIAS_PARA_CODIGO).sort((a,b) => b.length - a.length);
const PLACE_ALT = TODOS_ALIASES.map(a => escapeRegex(a).replace(/\\ /g, '\\s+')).join('|');
const PLACE_RE_TXT = '(?:' + PLACE_ALT + ')';

const ROUTE_PATTERNS = [
  '\\bDA\\s+(?<origem>' + PLACE_RE_TXT + ')\\s+PARA\\s+(?:O\\s+|A\\s+)?(?<destino>' + PLACE_RE_TXT + ')\\b',
  '\\b(?<origem>' + PLACE_RE_TXT + ')\\s*[>\\-]{1,2}\\s*(?<destino>' + PLACE_RE_TXT + ')\\b',
  '\\b(?<origem>' + PLACE_RE_TXT + ')\\s+P\\/\\s*(?<destino>' + PLACE_RE_TXT + ')\\b',
  '\\b(?<origem>' + PLACE_RE_TXT + ')\\s+PARA\\s+(?<destino>' + PLACE_RE_TXT + ')\\b',
  '\\bLOJA\\s+(?<origem>' + PLACE_RE_TXT + ')\\s+DESTINO\\s+(?<destino>' + PLACE_RE_TXT + ')\\b',
  '\\bDE:\\s*(?<origem>' + PLACE_RE_TXT + ')\\b.*?\\bPARA:\\s*(?<destino>' + PLACE_RE_TXT + ')\\b',
];
const ROUTE_RES = ROUTE_PATTERNS.map(p => new RegExp(p, 'gi'));

const ORIGIN_ONLY_PATTERNS = [
  '\\bDA\\s+LOJA\\s+(?:DE\\s+|DA\\s+|DO\\s+)?(?<origem>' + PLACE_RE_TXT + ')\\b',
  '\\bDA\\s+LOJA\\s+(?<origem>' + PLACE_RE_TXT + ')\\b',
];
const ORIGIN_ONLY_RES = ORIGIN_ONLY_PATTERNS.map(p => new RegExp(p, 'gi'));

function dedupOverlaps(matches){
  const dedup = [];
  for (const m of matches){
    if (dedup.length && m[0] < dedup[dedup.length-1][1]) continue;
    dedup.push(m);
  }
  return dedup;
}

function findRouteMatches(text){
  const textoNorm = semAcentoMaiuscula(text);
  let matches = [];
  for (const rx of ROUTE_RES){
    rx.lastIndex = 0;
    let m;
    while ((m = rx.exec(textoNorm)) !== null){
      const o = resolveEmpresa(m.groups.origem), d = resolveEmpresa(m.groups.destino);
      if (o && d) matches.push([m.index, m.index + m[0].length, o, d]);
      if (m[0].length === 0) rx.lastIndex++;
    }
  }
  for (const rx of ORIGIN_ONLY_RES){
    rx.lastIndex = 0;
    let m;
    while ((m = rx.exec(textoNorm)) !== null){
      const o = resolveEmpresa(m.groups.origem);
      if (o) matches.push([m.index, m.index + m[0].length, o, null]);
      if (m[0].length === 0) rx.lastIndex++;
    }
  }
  matches.sort((a,b) => a[0] - b[0] || (b[1]-b[0]) - (a[1]-a[0]));
  return dedupOverlaps(matches);
}

function segmentsForward(text, matches){
  const segments = [];
  for (let i = 0; i < matches.length; i++){
    const [start, end, o, d] = matches[i];
    const segStart = end;
    const segEnd = i+1 < matches.length ? matches[i+1][0] : text.length;
    segments.push({ origem: o, destino: d, texto: text.slice(segStart, segEnd).trim() });
  }
  const preText = text.slice(0, matches[0][0]).trim();
  if (preText) segments[0].texto = preText + '\n' + segments[0].texto;
  return segments;
}

function segmentsBackward(text, matches){
  const segments = [];
  let prevEnd = 0;
  for (const [start, end, o, d] of matches){
    segments.push({ origem: o, destino: d, texto: text.slice(prevEnd, start).trim() });
    prevEnd = end;
  }
  const trailing = text.slice(prevEnd).trim();
  if (trailing && segments.length) segments[segments.length-1].texto = (segments[segments.length-1].texto + '\n' + trailing).trim();
  return segments;
}

function extractRouteSegments(text){
  const matches = findRouteMatches(text);
  if (!matches.length) return [{ origem: null, destino: null, texto: text }];
  if (matches.length === 1) return segmentsForward(text, matches);

  const forward = segmentsForward(text, matches);
  const backward = segmentsBackward(text, matches);
  const vazios = segs => segs.filter(s => s.origem && !extractProducts(s.texto).length).length;
  return vazios(forward) <= vazios(backward) ? forward : backward;
}

// ---------------- produtos ----------------
function normCode(s){ return s.split('.').join(''); }

const PRODUCT_LINE_RE = new RegExp(
  '(?:COD|ADM|CODIGO)?\\.?:?\\s*' +
  '\\(?' +
  '(?<!\\d)(\\d{1,3}(?:\\.\\d{3})+|\\d{4,6})(?!\\d)' +
  '\\)?' +
  '\\s*(?:[-.>=\\/]{1,25}|QT\\.?D?\\.?|QUANT\\.?|QUANTIDADE|QDT\\.?|QUAT\\.?)?\\s*[:=]?\\s*' +
  '\\(?\\s*' +
  '(\\d+(?:[.,]\\d+)?)\\s*' +
  '(UND\\.?|UN\\.?|UNID\\.?|UNIDADES?|UNI\\.?|MTS?|M2|M3|SC|KG|LT|LITROS?|PCT|CX|PE[ÇC]AS?)?' +
  '\\s*\\)?',
  'gi'
);

const NOISE_LINES = /^(BOM DIA|BOA TARDE|BOA NOITE|OBRIGAD[AO]|GRATO|GRATA|ATT\.?!?|ATENCIOSAMENTE|OBS\.?:?.*|OBSERVA[ÇC][AÃ]O:?.*|SOLICITO A RETIRADA.*|POR FAVOR.*)$/i;

const QTY_FIRST_RE = /^\s*(\d{1,2})\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9"'\s]{2,55}?)(?:\s+(?<!\d)(\d{1,3}(?:\.\d{3})+|\d{4,6})(?!\d))?\s*$/;
const CODE_EQ_NAME_EQ_QTY_RE = /(?<!\d)(\d{1,3}(?:\.\d{3})+|\d{4,6})(?!\d)\s*=\s*([^=\n]{2,55}?)\s*=\s*(\d+(?:[.,]\d+)?)/;
const SHORT_CODE_RE = /^\s*(\d{2,3})\s*>\s*(\d+(?:[.,]\d+)?)\s*(UND\.?|UNIDADES?|UN\.?)?\s*$/i;
const TRAILING_QTY_RE = /([A-ZÀ-Úa-zà-ú][A-Za-zÀ-ÿ]*(?:\s+[A-ZÀ-Úa-zà-ú][A-Za-zÀ-ÿ]*){0,2})\s+(\d{1,3}(?:[.,]\d+)?)\s+(UNIDADES?|UND\.?|UN\.?)\b/gi;
const LEADING_QTY_NAME_RE = /\b(\d{1,2})\s+([A-ZÀ-Ú]{3,}(?:\s+[A-ZÀ-Ú]{2,}){0,2})\s*$/gm;

// produto com nome longo no meio: "CODIGO  NOME DO PRODUTO POR EXTENSO (pode ter
// dimensao tipo 62X62 no meio)  [CX]  QUANTIDADE  UNIDADE" - a quantidade+unidade
// sempre no FINAL da linha. Cobre piso/porcelanato/revestimento (M2/MT) e qualquer
// outro produto com nome/descricao comprida antes da quantidade real (ex:
// "136.197 TELHA RESIDENCIAL 3,66 X 1,10M 6M MULT 01 UN").
const CODE_NOME_QTD_RE = /^\s*(?<!\d)(\d{1,3}(?:\.\d{3})+|\d{4,6})(?!\d)\s+.+?\s+(?:CX\s+)?(\d+(?:[.,]\d+)?)\s*(UND\.?|UN\.?|UNID\.?|UNIDADES?|UNI\.?|MTS?|M2|M3|SC|KG|LT|LITROS?|PCT|PE[ÇC]AS?)\.?\s*$/i;

function extractProductsCodigoNomeQtd(text){
  const produtos = [];
  for (let linha of text.split('\n')){
    linha = linha.trim();
    if (!linha) continue;
    const m = CODE_NOME_QTD_RE.exec(linha);
    if (m){
      produtos.push({ codigo: normCode(m[1]), nome: null, quantidade: m[2].replace(',', '.'), unidade: m[3].toUpperCase(), metodo: 'codigo_nome_qtd' });
    }
  }
  return produtos;
}

function extractProductsFallback(text){
  let produtos = [];
  for (let linha of text.split('\n')){
    linha = linha.trim();
    if (!linha || NOISE_LINES.test(linha)) continue;

    let m = CODE_EQ_NAME_EQ_QTY_RE.exec(linha);
    if (m){
      produtos.push({ codigo: normCode(m[1]), nome: m[2].trim(), quantidade: m[3].replace(',', '.'), unidade: null, metodo: 'codigo=nome=qtd' });
      continue;
    }
    m = QTY_FIRST_RE.exec(linha);
    if (m){
      produtos.push({ codigo: m[3] ? normCode(m[3]) : null, nome: m[2].trim(), quantidade: m[1].replace(',', '.'), unidade: null, metodo: 'qtd_primeiro' });
      continue;
    }
    m = SHORT_CODE_RE.exec(linha);
    if (m){
      produtos.push({ codigo: normCode(m[1]), nome: null, quantidade: m[2].replace(',', '.'), unidade: (m[3]||'').toUpperCase() || null, metodo: 'codigo_curto' });
      continue;
    }
  }
  if (!produtos.length){
    const re1 = new RegExp(TRAILING_QTY_RE.source, 'gi');
    let m;
    while ((m = re1.exec(text)) !== null){
      const nome = m[1].trim();
      if (NOISE_LINES.test(nome) || nome.length < 3) continue;
      produtos.push({ codigo: null, nome, quantidade: m[2].replace(',', '.'), unidade: m[3].toUpperCase(), metodo: 'nome+qtd_final' });
    }
    if (!produtos.length){
      const re2 = new RegExp(LEADING_QTY_NAME_RE.source, 'gm');
      while ((m = re2.exec(text)) !== null){
        const nome = m[2];
        if (NOISE_LINES.test(nome)) continue;
        produtos.push({ codigo: null, nome: nome.trim().replace(/\w\S*/g, t => t.charAt(0).toUpperCase()+t.substr(1).toLowerCase()), quantidade: m[1], unidade: null, metodo: 'qtd+nome_maiusculo' });
      }
    }
  }
  return produtos;
}

function extractProducts(text){
  const textSemPedido = text.replace(new RegExp(PEDIDO_RE.source, 'gi'), '');
  const produtos = [];
  const re = new RegExp(PRODUCT_LINE_RE.source, 'gi');
  let m;
  while ((m = re.exec(textSemPedido)) !== null){
    produtos.push({ codigo: normCode(m[1]), nome: null, quantidade: m[2].replace(',', '.'), unidade: (m[3]||'').toUpperCase() || null, metodo: 'codigo>qtd' });
    if (m[0].length === 0) re.lastIndex++;
  }
  if (!produtos.length){
    const piso = extractProductsCodigoNomeQtd(textSemPedido);
    return piso.length ? piso : extractProductsFallback(textSemPedido);
  }
  return produtos;
}

function parseAtendimentoBlock(blockLines){
  const summary = findSummary(blockLines);
  if (!summary) return null;
  const originalText = findOriginalRequestText(blockLines);
  const pedidos = extractPedidosNumbers(originalText);
  const segments = extractRouteSegments(originalText);

  const subPedidos = segments.map(seg => {
    const produtos = extractProducts(seg.texto);
    const segPedidos = extractPedidosNumbers(seg.texto);
    return {
      origem: seg.origem, destino: seg.destino,
      pedido_cliente: segPedidos.length ? segPedidos[0] : null,
      produtos,
      texto_bruto: seg.texto.slice(0, 300),
    };
  });

  const temProduto = subPedidos.some(sp => sp.produtos.length);

  return {
    controle: summary.controle, data: summary.data, status_final: summary.status_final,
    tipo_controle: summary.tipo_controle, usuario_baixa: findUsuarioBaixa(blockLines),
    tem_pedido_cliente: pedidos.length > 0, pedidos_clientes: pedidos,
    qtd_sub_rotas: subPedidos.filter(s => s.origem).length,
    sub_pedidos: subPedidos, texto_original: originalText.slice(0, 500),
    status_extracao: temProduto ? 'ok' : 'revisao_manual',
    motivo_revisao: temProduto ? null : 'nenhum produto/quantidade identificado no texto do pedido',
  };
}

function parseAtendimentosTexto(rawText){
  const blocks = splitBlocks(rawText);
  const auditaveis = [], revisaoManual = [];
  let semResumo = 0;
  for (const b of blocks){
    const parsed = parseAtendimentoBlock(b);
    if (!parsed){
      if (b.join('\n').trim()) semResumo++;
      continue;
    }
    if (parsed.status_extracao === 'ok') auditaveis.push(parsed);
    else revisaoManual.push(parsed);
  }
  return { auditaveis, revisaoManual, semResumo };
}

