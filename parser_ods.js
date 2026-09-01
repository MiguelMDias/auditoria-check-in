// Porta fiel de parser_ods.py para JavaScript (usa a biblioteca XLSX/SheetJS,
// carregada via CDN no navegador, pra ler os .ods do Santri ADM).

const KNOWN_EMPRESAS_ODS = new Set(["CFS","CFVP","CFR","CFC","CFW3","CFT","CFG","CFJB","CFPA","CFBS"]);
const CODE_SUMMARY_RE = /^\d{1,3}\.\d{3}$/;

function clean(v){
  if (v === null || v === undefined) return '';
  return String(v).replace(/\n/g, ' ').trim();
}
function isBlankRow(row){
  return row.every(v => clean(v) === '');
}
function toFloat(v){
  v = clean(v);
  if (!v) return null;
  v = v.split('.').join('').replace(',', '.');
  const n = parseFloat(v);
  return Number.isNaN(n) ? null : n;
}

// XLSX (SheetJS) precisa estar disponivel globalmente (window.XLSX) quando
// rodando no navegador; em Node, e' passado explicitamente via parametro.
function sheetToRows(XLSX, arrayBuffer){
  const wb = XLSX.read(arrayBuffer, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
}

function parseTransferencias(XLSX, arrayBuffer){
  const rows = sheetToRows(XLSX, arrayBuffer);
  const registros = [];
  let atual = null;
  for (const row of rows){
    const c0 = clean(row[0]), c1 = clean(row[1]);
    if (isBlankRow(row)) continue;
    if (c1 === 'Produto') continue;
    if (CODE_SUMMARY_RE.test(c0) && KNOWN_EMPRESAS_ODS.has(c1)){
      if (atual) registros.push(atual);
      const v = row.map(clean);
      atual = {
        codigo: v[0], empresa_origem: v[1], empresa_destino: v[2], motivo: v[3], status: v[4],
        valor_transferencia: toFloat(v[10]), peso: toFloat(v[12]),
        data_cadastro: v[15]||'', data_transporte: v[16]||'', data_entrada: v[17]||'',
        usuario_insercao: v[18]||'', manifesto: v[20]||'', itens: [],
      };
    } else if (atual !== null && c0 === '' && c1 !== ''){
      const v = row.map(clean);
      atual.itens.push({
        produto: v[1], nome: v[2]||'', marca: v[3]||'', unidade: v[4]||'',
        quantidade: toFloat(v[7]), preco: toFloat(v[9]), total: toFloat(v[10]),
      });
    }
  }
  if (atual) registros.push(atual);
  return registros;
}

function parseCorrecoes(XLSX, arrayBuffer){
  const rows = sheetToRows(XLSX, arrayBuffer);
  const registros = [];
  let atual = null;
  for (const row of rows){
    const c0 = clean(row[0]), c1 = clean(row[1]);
    if (isBlankRow(row)) continue;
    if (c1 === 'Produto') continue;
    if (CODE_SUMMARY_RE.test(c0) && KNOWN_EMPRESAS_ODS.has(c1)){
      if (atual) registros.push(atual);
      const v = row.map(clean);
      atual = {
        codigo: v[0], empresa: v[1], data: v[2], tipo_correcao: v[3], usuario_insercao: v[4],
        qtd_itens: v[5], valor_saida: toFloat(v[7]), peso_total: toFloat(v[9]),
        observacao: v[10]||'', usuario_requisicao: v[11]||'', usuario_retirou: v[12]||'', itens: [],
      };
    } else if (atual !== null && c0 === '' && c1 !== ''){
      const v = row.map(clean);
      atual.itens.push({
        produto: v[1], descricao: v[2]||'', local: v[4]||'', motivo: v[6]||'', tipo: v[7]||'',
        custo: toFloat(v[8]), quantidade: toFloat(v[9]), novo_estoque_fisico: toFloat(v[10]),
      });
    }
  }
  if (atual) registros.push(atual);
  return registros;
}

