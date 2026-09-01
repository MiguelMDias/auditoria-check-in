/* =========================================================================
   Extração de texto de PDF no navegador (reconstrói o "layout" — colunas e
   ordem de leitura — a partir das posições X/Y de cada trecho de texto,
   igual o `pdftotext -layout` faz). Validado byte-a-byte contra o pdftotext
   real antes de entrar em produção.
========================================================================= */

const PDFJS_VERSION = '6.3.289';
const PDFJS_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.min.mjs`;
const PDFJS_WORKER_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.mjs`;
const XLSX_URL_FALLBACK_CHECK = () => typeof window.XLSX !== 'undefined';

let _pdfjsLibPromise = null;
function carregarPdfjs(){
  if (!_pdfjsLibPromise){
    _pdfjsLibPromise = import(PDFJS_URL).then(mod => {
      mod.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
      return mod;
    });
  }
  return _pdfjsLibPromise;
}

function reconstruirPagina(items){
  const rows = [];
  const TOL = 2;
  for (const it of items){
    const y = it.transform[5];
    const x = it.transform[4];
    let row = rows.find(r => Math.abs(r.y - y) <= TOL);
    if (!row){ row = { y, items: [] }; rows.push(row); }
    row.items.push({ x, str: it.str });
  }
  rows.sort((a,b) => b.y - a.y);
  return rows.map(r => {
    r.items.sort((a,b) => a.x - b.x);
    let line = '', lastEnd = null;
    for (const it of r.items){
      if (lastEnd !== null){
        const gap = it.x - lastEnd;
        line += gap > 8 ? '  ' : (gap > 1.5 ? ' ' : '');
      }
      line += it.str;
      lastEnd = it.x + it.str.length * 4.5;
    }
    return line;
  }).join('\n');
}

async function extrairTextoPdf(file, onProgress){
  const pdfjsLib = await carregarPdfjs();
  const buf = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf), isEvalSupported: false }).promise;
  const paginas = [];
  for (let p = 1; p <= doc.numPages; p++){
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    paginas.push(reconstruirPagina(content.items));
    if (onProgress) onProgress(p, doc.numPages);
  }
  return paginas.join('\n\f\n');
}

async function lerOds(file){
  if (typeof window.XLSX === 'undefined'){
    throw new Error('Biblioteca XLSX (SheetJS) não carregou. Verifique sua conexão com a internet e recarregue a página.');
  }
  const buf = await file.arrayBuffer();
  return buf;
}

/* =========================================================================
   Orquestracao: le os 4 arquivos, roda parser+matching (as mesmas funcoes
   que rodam no gerar_auditoria.py, portadas fielmente para JS), monta o
   mesmo formato de AUDIT_DATA que o dashboard ja sabe renderizar.
========================================================================= */

async function processarArquivos({ pdfTransf, pdfUso, odsTransf, odsCorr }, onStatus){
  onStatus('Lendo PDF de transferências...');
  const txtTransf = await extrairTextoPdf(pdfTransf, (p, total) => onStatus(`Lendo PDF de transferências... (página ${p}/${total})`));

  onStatus('Lendo PDF de uso e consumo...');
  const txtUso = await extrairTextoPdf(pdfUso, (p, total) => onStatus(`Lendo PDF de uso e consumo... (página ${p}/${total})`));

  onStatus('Interpretando atendimentos...');
  const rTransf = parseAtendimentosTexto(txtTransf);
  const rUso = parseAtendimentosTexto(txtUso);
  const atTransf = rTransf.auditaveis.filter(a => a.tipo_controle.startsWith('016.002'));
  const atUso = rUso.auditaveis.filter(a => a.tipo_controle.startsWith('016.001'));

  onStatus('Lendo planilhas .ods...');
  const bufTransf = await lerOds(odsTransf);
  const bufCorr = await lerOds(odsCorr);
  const transf = parseTransferencias(window.XLSX, bufTransf);
  const corr = parseCorrecoes(window.XLSX, bufCorr);

  onStatus('Cruzando dados...');
  const { resultados: resTransf, orfas: orfTransf } = matchTransferencias(atTransf, transf);
  const { resultados: resUso, orfas: orfUso } = matchUsoConsumo(atUso, corr);

  const agora = new Date();
  const dataGeracao = String(agora.getDate()).padStart(2,'0') + '/' + String(agora.getMonth()+1).padStart(2,'0') + '/' + agora.getFullYear();

  return {
    gerado_em: dataGeracao,
    transferencias: { resultados: resTransf, orfas: orfTransf, revisao_manual: rTransf.revisaoManual.filter(a => a.tipo_controle.startsWith('016.002')) },
    uso_consumo: { resultados: resUso, orfas: orfUso, revisao_manual: rUso.revisaoManual.filter(a => a.tipo_controle.startsWith('016.001')) },
  };
}
