const VEREDICT_META = {
  BATIDO:         { css: 'ok',   label: 'Batido',              color: 'var(--ok)'   },
  DIVERGENTE:     { css: 'warn', label: 'Divergente',           color: 'var(--warn)' },
  AMBIGUO:        { css: 'amb',  label: 'Ambíguo',              color: 'var(--amb)'  },
  NAO_ENCONTRADO: { css: 'bad',  label: 'Não encontrado',       color: 'var(--bad)'  },
  SEM_ATENDIMENTO:{ css: 'orfa', label: 'Execução órfã',        color: 'var(--orfa)' },
  REVISAO:        { css: 'rev',  label: 'Revisão manual',       color: 'var(--rev)'  },
  NAO_DIVERGENTE: { css: 'revok',label: 'Não é divergência',    color: 'var(--revok)'},
};

/* -------------------------------------------------------------------------
   Usuario (quem esta' auditando neste navegador) - igual ao Portal Areia,
   cada confirmacao/rejeicao de divergencia fica com nome + data/hora de quem
   fez. So' pede o nome uma vez; fica salvo no localStorage deste navegador.
------------------------------------------------------------------------- */
const USUARIO_KEY = 'auditoria_usuario_v1';
const USUARIOS_CONHECIDOS_KEY = 'auditoria_usuarios_conhecidos_v1';

function usuarioAtual(){
  try { return localStorage.getItem(USUARIO_KEY) || null; } catch (e) { return null; }
}
function usuariosConhecidos(){
  try { return JSON.parse(localStorage.getItem(USUARIOS_CONHECIDOS_KEY) || '[]'); } catch (e) { return []; }
}
function definirUsuario(nome){
  nome = nome.trim();
  if (!nome) return;
  try {
    localStorage.setItem(USUARIO_KEY, nome);
    const conhecidos = usuariosConhecidos();
    if (!conhecidos.includes(nome)){
      conhecidos.unshift(nome);
      localStorage.setItem(USUARIOS_CONHECIDOS_KEY, JSON.stringify(conhecidos.slice(0, 8)));
    }
  } catch (e) {}
}
function sairUsuario(){
  try { localStorage.removeItem(USUARIO_KEY); } catch (e) {}
  mostrarLogin();
}

function iniciais(nome){
  return nome.trim().split(/\s+/).slice(0, 2).map(p => p[0].toUpperCase()).join('');
}

function mostrarLogin(){
  const overlay = document.getElementById('login-overlay');
  const conhecidos = usuariosConhecidos();
  const wrap = document.getElementById('login-recentes');
  const nomesEl = document.getElementById('login-recentes-nomes');
  if (conhecidos.length){
    wrap.style.display = '';
    nomesEl.innerHTML = conhecidos.map(n => `<button data-nome="${n.replace(/"/g,'&quot;')}">${n}</button>`).join('');
  } else {
    wrap.style.display = 'none';
  }
  overlay.classList.remove('hidden');
  document.getElementById('login-input').value = '';
  document.getElementById('login-input').focus();
}

function esconderLogin(){
  document.getElementById('login-overlay').classList.add('hidden');
}

function renderUserBadge(){
  const nome = usuarioAtual();
  if (!nome) return;
  document.getElementById('userbadge').innerHTML = `
    <div class="avatar">${iniciais(nome)}</div>
    <span class="nome">${nome}</span>
    <button id="btn-trocar-usuario">trocar</button>
  `;
  document.getElementById('btn-trocar-usuario').addEventListener('click', sairUsuario);
}

function agoraFormatado(){
  const d = new Date();
  const dd = String(d.getDate()).padStart(2,'0');
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const hh = String(d.getHours()).padStart(2,'0');
  const mi = String(d.getMinutes()).padStart(2,'0');
  return `${dd}/${mm}/${d.getFullYear()} ${hh}:${mi}`;
}

/* -------------------------------------------------------------------------
   Revisao manual (confirmar/rejeitar divergencias e ambiguidades marcadas
   pelo motor de cruzamento). Guardado no localStorage do navegador - e' uma
   marcacao PESSOAL de quem esta' auditando nesta maquina, nao sincroniza
   entre pessoas/dispositivos. Rodar de novo o gerar_auditoria.py com dados
   novos NAO apaga essas marcacoes (fica salvo separado, por linha).
------------------------------------------------------------------------- */
const REVISOES_KEY = 'auditoria_revisoes_v1';
let REVISOES = {};
try { REVISOES = JSON.parse(localStorage.getItem(REVISOES_KEY) || '{}'); } catch (e) { REVISOES = {}; }

function salvarRevisoes(){
  try { localStorage.setItem(REVISOES_KEY, JSON.stringify(REVISOES)); } catch (e) {}
}

function marcarRevisao(id, status){
  REVISOES[id] = { status, usuario: usuarioAtual() || '(sem nome)', data: agoraFormatado() };
  salvarRevisoes();
}

function rowId(r, kind){
  if (r.veredito === 'SEM_ATENDIMENTO'){
    const code = kind === 'transf' ? r.transferencia_codigo : r.correcao_codigo;
    return `orfa:${kind}:${code}:${r.produto}`;
  }
  if (r.veredito === 'REVISAO') return `revisao:${kind}:${r.controle}`;
  const execCode = kind === 'transf' ? (r.transferencia_codigo || '') : (r.correcao_codigo || '');
  return `res:${kind}:${r.atendimento_controle}:${r.produto}:${execCode}`;
}

function efeitoVeredito(r){
  const rev = REVISOES[r._id];
  if (rev && rev.status === 'falso_positivo') return 'NAO_DIVERGENTE';
  return r.veredito;
}

const refreshers = [];
function refreshAll(){
  buildTally();
  refreshers.forEach(fn => fn());
}

function withIds(list, kind){
  return list.map(r => ({ ...r, _id: rowId(r, kind) }));
}

function fmtQtd(v){
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(String(v).replace(',', '.'));
  if (Number.isNaN(n)) return String(v);
  return (Math.round(n * 1000) / 1000).toString().replace('.', ',');
}

function buildMeta(){
  const el = document.getElementById('meta-row');
  const nTransf = AUDIT_DATA.transferencias.resultados.length;
  const nUso = AUDIT_DATA.uso_consumo.resultados.length;
  el.innerHTML = `
    <span>gerado em <b>${AUDIT_DATA.gerado_em}</b></span>
    <span><b>${nTransf}</b> itens de transferência auditados</span>
    <span><b>${nUso}</b> itens de uso/consumo auditados</span>
  `;
}

function buildTally(){
  const T = AUDIT_DATA.transferencias, U = AUDIT_DATA.uso_consumo;
  const all = [...withIds(T.resultados, 'transf'), ...withIds(U.resultados, 'uso')];
  const count = v => all.filter(r => efeitoVeredito(r) === v).length;
  const orfas = T.orfas.length + U.orfas.length;
  const revisao = T.revisao_manual.length + U.revisao_manual.length;
  const revisados = all.filter(r => REVISOES[r._id]).length;

  const cells = [
    { n: all.length, l: 'itens auditados', css: '' },
    { n: count('BATIDO'), l: 'batidos', css: 'ok' },
    { n: count('DIVERGENTE'), l: 'divergentes', css: 'warn' },
    { n: count('AMBIGUO'), l: 'ambíguos', css: 'amb' },
    { n: count('NAO_ENCONTRADO'), l: 'não encontrados', css: 'bad' },
    { n: orfas, l: 'execuções órfãs', css: 'orfa' },
    { n: revisao, l: 'revisão manual', css: 'rev' },
  ];
  document.getElementById('tally').innerHTML = cells.map(c => `
    <div class="cell ${c.css}">
      <div class="num">${c.n}</div>
      <div class="lbl">${c.l}</div>
    </div>
  `).join('') + (revisados ? `<div class="cell revok"><div class="num">${revisados}</div><div class="lbl">confirmados manualmente</div></div>` : '');
}

function stackBar(counts, total){
  if (!total) return '';
  return Object.entries(counts).filter(([,v]) => v > 0).map(([key, v]) => {
    const meta = VEREDICT_META[key];
    const pct = (v / total * 100).toFixed(2);
    return `<span style="width:${pct}%; background:${meta.color}" title="${meta.label}: ${v}"></span>`;
  }).join('');
}

function codeChip(label, value){
  if (!value) return '';
  return `<span class="codechip" data-copy="${String(value).replace(/"/g,'&quot;')}">
    <span class="k">${label}</span><span>${value}</span><i class="icon">⧉</i>
  </span>`;
}

function rowDetailTransf(r){
  if (r.veredito === 'SEM_ATENDIMENTO'){
    return `<div class="codechips">${codeChip('transferência', r.transferencia_codigo)}</div>
    <dl>
      <dt>rota</dt><dd>${r.origem} &rarr; ${r.destino}</dd>
      <dt>motivo</dt><dd>${r.motivo}</dd>
      <dt>data</dt><dd>${r.data}</dd>
      <dt>usuário</dt><dd>${r.transferencia_usuario || '—'}</dd>
    </dl><p class="obs">${r.detalhe}</p>`;
  }
  if (r.veredito === 'REVISAO'){
    return `<div class="codechips">${codeChip('atendimento', r.controle)}</div>
    <dl>
      <dt>data</dt><dd>${r.data}</dd>
      <dt>status</dt><dd>${r.status_final}</dd>
      <dt>usuário baixa</dt><dd>${r.usuario_baixa || '—'}</dd>
    </dl><p class="obs">${r.motivo_revisao}<br><br>"${(r.texto_original||'').replace(/\n/g,' / ')}"</p>`;
  }
  const rows = [
    ['data', r.atendimento_data],
    ['produto', r.produto],
    ['qtd. pedida', fmtQtd(r.quantidade_pedida)],
    ['usuário baixa (atend.)', r.atendimento_usuario_baixa || '—'],
  ];
  if (r.pedido_cliente) rows.push(['pedido cliente', r.pedido_cliente]);
  if (r.transferencia_codigo){
    rows.push(['qtd. executada', fmtQtd(r.quantidade_executada)]);
    rows.push(['motivo', r.transferencia_motivo]);
    rows.push(['status', r.transferencia_status]);
    rows.push(['usuário transferência', r.transferencia_usuario || '—']);
  }
  if (r.veredito === 'AMBIGUO' && r.candidatos) rows.push(['candidatos', r.candidatos.join(', ')]);
  return `<div class="codechips">${codeChip('atendimento', r.atendimento_controle)}${codeChip('transferência', r.transferencia_codigo)}</div>
    <dl>${rows.map(([k,v]) => `<dt>${k}</dt><dd>${v ?? '—'}</dd>`).join('')}</dl>
    <p class="obs">${r.detalhe}</p>${revisaoActions(r)}`;
}

function rowDetailUso(r){
  if (r.veredito === 'SEM_ATENDIMENTO'){
    return `<div class="codechips">${codeChip('correção', r.correcao_codigo)}</div>
    <dl>
      <dt>produto</dt><dd>${r.descricao || '—'}</dd>
      <dt>empresa</dt><dd>${r.empresa}</dd>
      <dt>data</dt><dd>${r.data}</dd>
      <dt>usuário</dt><dd>${r.correcao_usuario || '—'}</dd>
    </dl><p class="obs">${r.detalhe}</p>`;
  }
  if (r.veredito === 'REVISAO'){
    return `<div class="codechips">${codeChip('atendimento', r.controle)}</div>
    <dl>
      <dt>data</dt><dd>${r.data}</dd>
      <dt>status</dt><dd>${r.status_final}</dd>
      <dt>usuário baixa</dt><dd>${r.usuario_baixa || '—'}</dd>
    </dl><p class="obs">${r.motivo_revisao}<br><br>"${(r.texto_original||'').replace(/\n/g,' / ')}"</p>`;
  }
  const rows = [
    ['data', r.atendimento_data],
    ['produto/descrição pedido', r.produto],
    ['qtd. pedida', fmtQtd(r.quantidade_pedida)],
    ['usuário baixa (atend.)', r.atendimento_usuario_baixa || '—'],
  ];
  if (r.correcao_codigo){
    rows.push(['descrição no estoque', r.correcao_descricao]);
    rows.push(['empresa', r.correcao_empresa]);
    rows.push(['qtd. executada', fmtQtd(r.quantidade_executada)]);
    rows.push(['usuário correção', r.correcao_usuario || '—']);
    rows.push(['casado por', r.casado_por]);
  }
  if (r.veredito === 'AMBIGUO' && r.candidatos) rows.push(['candidatos', r.candidatos.join(', ')]);
  return `<div class="codechips">${codeChip('atendimento', r.atendimento_controle)}${codeChip('correção', r.correcao_codigo)}</div>
    <dl>${rows.map(([k,v]) => `<dt>${k}</dt><dd>${v ?? '—'}</dd>`).join('')}</dl>
    <p class="obs">${r.detalhe}</p>${revisaoActions(r)}`;
}

function rowHead(r, kind){
  const efeito = efeitoVeredito(r);
  const meta = VEREDICT_META[efeito];
  const revisadoTag = REVISOES[r._id] && REVISOES[r._id].status === 'confirmado'
    ? `<span class="row-badge warn" style="margin-left:-.3rem">confirmado</span>` : '';
  if (r.veredito === 'SEM_ATENDIMENTO'){
    const code = kind === 'transf' ? r.transferencia_codigo : r.correcao_codigo;
    const route = kind === 'transf' ? `${r.origem}<span class="arrow">&rarr;</span>${r.destino}` : (r.empresa || '');
    return `<div class="row-top">
      <span class="row-code">${code}</span>
      <span class="row-route">${route}</span>
      <span class="row-prod">produto ${r.produto} · qtd ${fmtQtd(r.quantidade)}</span>
      <span class="row-badge ${meta.css}">${meta.label}</span>
    </div>`;
  }
  if (r.veredito === 'REVISAO'){
    return `<div class="row-top">
      <span class="row-code">${r.controle}</span>
      <span class="row-prod">${(r.texto_original||'').slice(0,90).replace(/\n/g,' ') || '(sem texto reconhecível)'}</span>
      <span class="row-badge ${meta.css}">${meta.label}</span>
    </div>`;
  }
  const route = kind === 'transf' && (r.origem || r.destino)
    ? `<span class="row-route">${r.origem||'?'}<span class="arrow">&rarr;</span>${r.destino||'?'}</span>` : '';
  const porNome = kind === 'uso' && r.casado_por && r.casado_por.startsWith('nome')
    ? `<span class="row-badge rev" style="margin-left:-.3rem">por nome</span>` : '';
  return `<div class="row-top">
    <span class="row-code">${r.atendimento_controle}</span>
    ${route}
    <span class="row-prod">produto ${r.produto} · qtd ${fmtQtd(r.quantidade_pedida)}</span>
    ${porNome}
    ${revisadoTag}
    <span class="row-badge ${meta.css}">${meta.label}</span>
  </div>`;
}

function revisaoActions(r){
  if (r.veredito !== 'DIVERGENTE' && r.veredito !== 'AMBIGUO') return '';
  const rev = REVISOES[r._id];
  if (rev && rev.status === 'confirmado'){
    return `<div class="revisao-actions">
      <span class="revisao-status confirmado">✓ <b>Confirmado</b> como divergência real por <b>${rev.usuario}</b> em ${rev.data}</span>
      <button class="revisao-undo" data-undo="${r._id}">desfazer</button>
    </div>`;
  }
  if (rev && rev.status === 'falso_positivo'){
    return `<div class="revisao-actions">
      <span class="revisao-status falso_positivo">✕ Marcado como <b>erro do parser</b> por <b>${rev.usuario}</b> em ${rev.data} — não é divergência</span>
      <button class="revisao-undo" data-undo="${r._id}">desfazer</button>
    </div>`;
  }
  return `<div class="revisao-actions">
    <span class="revisao-status">Essa ${r.veredito === 'AMBIGUO' ? 'ambiguidade' : 'divergência'} está correta?</span>
    <button class="revbtn confirmar" data-confirmar="${r._id}">Confirmar divergência real</button>
    <button class="revbtn rejeitar" data-rejeitar="${r._id}">Não é divergência (erro do parser)</button>
  </div>`;
}

function searchKey(r, kind){
  const parts = [];
  if (kind === 'transf'){
    parts.push(r.atendimento_controle, r.transferencia_codigo, r.produto, r.origem, r.destino, r.controle, r.texto_original);
  } else {
    parts.push(r.atendimento_controle, r.correcao_codigo, r.produto, r.empresa, r.controle, r.texto_original);
  }
  return parts.filter(Boolean).join(' ').toLowerCase();
}

const TAB_ORDER = ['DIVERGENTE', 'AMBIGUO', 'NAO_ENCONTRADO', 'SEM_ATENDIMENTO', 'REVISAO', 'BATIDO', 'NAO_DIVERGENTE'];

function buildReport(containerId, title, dataBlock, kind){
  const resultados = withIds(dataBlock.resultados, kind);
  const orfas = dataBlock.orfas.map(r => ({ ...r, veredito: 'SEM_ATENDIMENTO', _id: rowId({...r, veredito:'SEM_ATENDIMENTO'}, kind) }));
  const revisao = dataBlock.revisao_manual.map(r => ({ ...r, veredito: 'REVISAO', _id: rowId({...r, veredito:'REVISAO'}, kind) }));
  const all = [...resultados, ...orfas, ...revisao];

  let currentFilter = 'ALL';
  let currentSearch = '';
  const expandedIds = new Set();

  function renderHeader(){
    const counts = {};
    Object.keys(VEREDICT_META).forEach(k => counts[k] = all.filter(r => efeitoVeredito(r) === k).length);
    const container = document.getElementById(containerId);
    container.innerHTML = `
      <div class="report-head">
        <h2>${title}</h2>
        <span class="count">${all.length} registros</span>
      </div>
      <div class="stackbar">${stackBar(counts, all.length)}</div>
      <div class="tabbar" id="${containerId}-chips">
        <div class="tab${currentFilter==='ALL'?' active':''}" data-f="ALL" style="${currentFilter==='ALL'?'border-color:var(--hairline-strong)':''}"><span>Todos</span><span class="count">${all.length}</span></div>
        ${TAB_ORDER.filter(k => counts[k] > 0).map(k => {
          const m = VEREDICT_META[k];
          const active = currentFilter === k;
          return `<div class="tab${active?' active':''}" data-f="${k}" style="${active?`border-color:${m.color}`:''}"><span class="dot" style="background:${m.color}"></span><span>${m.label}</span><span class="count">${counts[k]}</span></div>`;
        }).join('')}
      </div>
      <div class="searchbox"><input type="text" placeholder="buscar por código, produto, controle..." id="${containerId}-search" value="${currentSearch}"></div>
      <div class="ledger" id="${containerId}-list"></div>
    `;
    document.getElementById(`${containerId}-chips`).addEventListener('click', e => {
      const chip = e.target.closest('.tab');
      if (!chip) return;
      currentFilter = chip.dataset.f;
      renderReport();
    });
    document.getElementById(`${containerId}-search`).addEventListener('input', e => {
      currentSearch = e.target.value.trim().toLowerCase();
      renderList();
    });
  }

  function renderList(){
    const list = document.getElementById(`${containerId}-list`);
    if (!list) return;
    const filtered = all.filter(r => {
      if (currentFilter !== 'ALL' && efeitoVeredito(r) !== currentFilter) return false;
      if (currentSearch && !searchKey(r, kind).includes(currentSearch)) return false;
      return true;
    });
    if (!filtered.length){
      list.innerHTML = `<div class="empty">nenhum registro encontrado</div>`;
      return;
    }
    const detailFn = kind === 'transf' ? rowDetailTransf : rowDetailUso;
    list.innerHTML = filtered.map(r => `
      <div class="row ${VEREDICT_META[efeitoVeredito(r)].css}${expandedIds.has(r._id)?' expanded':''}" data-id="${r._id}">
        ${rowHead(r, kind)}
        <div class="row-detail">${detailFn(r)}</div>
      </div>
    `).join('');
    list.querySelectorAll('.row').forEach(el => {
      el.addEventListener('click', e => {
        if (e.target.closest('.codechip') || e.target.closest('.revisao-actions')) return;
        el.classList.toggle('expanded');
        if (el.classList.contains('expanded')) expandedIds.add(el.dataset.id);
        else expandedIds.delete(el.dataset.id);
      });
    });
  }

  function renderReport(){
    renderHeader();
    renderList();
  }

  refreshers.push(renderReport);
  renderReport();
}

const AUDIT_DATA_CACHE_KEY = 'auditoria_dados_atualizados_v1';
function carregarDadosSalvos(){
  try {
    const raw = localStorage.getItem(AUDIT_DATA_CACHE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return null;
}
function salvarDadosAtualizados(dados){
  try { localStorage.setItem(AUDIT_DATA_CACHE_KEY, JSON.stringify(dados)); } catch (e) {}
}

function montarDashboardCompleto(){
  buildMeta();
  buildTally();
  refreshers.length = 0;
  document.getElementById('report-transferencias').innerHTML = '';
  document.getElementById('report-uso').innerHTML = '';
  buildReport('report-transferencias', 'Transferências', AUDIT_DATA.transferencias, 'transf');
  buildReport('report-uso', 'Uso e consumo', AUDIT_DATA.uso_consumo, 'uso');
  const nTransf = AUDIT_DATA.transferencias.resultados.length + AUDIT_DATA.transferencias.orfas.length + AUDIT_DATA.transferencias.revisao_manual.length;
  const nUso = AUDIT_DATA.uso_consumo.resultados.length + AUDIT_DATA.uso_consumo.orfas.length + AUDIT_DATA.uso_consumo.revisao_manual.length;
  document.getElementById('toptab-n-transf').textContent = nTransf;
  document.getElementById('toptab-n-uso').textContent = nUso;
}

function iniciarDashboard(){
  esconderLogin();
  renderUserBadge();

  const salvos = carregarDadosSalvos();
  if (salvos) AUDIT_DATA = salvos;

  montarDashboardCompleto();

  document.getElementById('toptabs').addEventListener('click', e => {
    const tab = e.target.closest('.toptab');
    if (!tab) return;
    document.querySelectorAll('.toptab').forEach(t => t.classList.toggle('active', t === tab));
    document.getElementById('report-transferencias').classList.toggle('active-section', tab.dataset.section === 'transferencias');
    document.getElementById('report-uso').classList.toggle('active-section', tab.dataset.section === 'uso');
  });
}

/* -------------------------------------------------------------------------
   Upload / atualizacao de dados direto do navegador (le PDF + .ods e roda
   o mesmo parser+cruzamento do gerar_auditoria.py, so' que em JS).
------------------------------------------------------------------------- */
function setUploadStatus(msg, tipo){
  const el = document.getElementById('upload-status');
  el.textContent = msg;
  el.className = 'upload-status' + (tipo ? ' ' + tipo : '');
}

function baixarAuditData(dados){
  const blob = new Blob(['let AUDIT_DATA = ' + JSON.stringify(dados) + ';'], { type: 'text/javascript' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'audit_data.js';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

document.getElementById('btn-abrir-upload').addEventListener('click', () => {
  document.getElementById('upload-overlay').classList.remove('hidden');
});
document.getElementById('upload-fechar').addEventListener('click', () => {
  document.getElementById('upload-overlay').classList.add('hidden');
});
['upload-pdf-transf','upload-pdf-uso','upload-ods-transf','upload-ods-corr'].forEach(id => {
  document.getElementById(id).addEventListener('change', e => {
    const f = e.target.files[0];
    let tag = e.target.parentElement.querySelector('.filename');
    if (!tag){ tag = document.createElement('div'); tag.className = 'filename'; e.target.after(tag); }
    tag.textContent = f ? `✓ ${f.name}` : '';
  });
});

document.getElementById('upload-processar').addEventListener('click', async () => {
  const pdfTransf = document.getElementById('upload-pdf-transf').files[0];
  const pdfUso = document.getElementById('upload-pdf-uso').files[0];
  const odsTransf = document.getElementById('upload-ods-transf').files[0];
  const odsCorr = document.getElementById('upload-ods-corr').files[0];
  if (!pdfTransf || !pdfUso || !odsTransf || !odsCorr){
    setUploadStatus('Selecione os 4 arquivos antes de processar.', 'erro');
    return;
  }
  const btn = document.getElementById('upload-processar');
  btn.disabled = true;
  document.getElementById('upload-download').style.display = 'none';
  try {
    const novosDados = await processarArquivos({ pdfTransf, pdfUso, odsTransf, odsCorr }, msg => setUploadStatus(msg));
    AUDIT_DATA = novosDados;
    salvarDadosAtualizados(novosDados);
    montarDashboardCompleto();
    setUploadStatus('Pronto! Dados atualizados e já aplicados ao dashboard. Baixe o audit_data.js pra salvar essa versão.', 'sucesso');
    const dlBtn = document.getElementById('upload-download');
    dlBtn.style.display = '';
    dlBtn.onclick = () => baixarAuditData(novosDados);
  } catch (e) {
    setUploadStatus('Erro ao processar: ' + e.message, 'erro');
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('upload-reset').addEventListener('click', () => {
  try { localStorage.removeItem(AUDIT_DATA_CACHE_KEY); } catch (e) {}
  location.reload();
});

document.getElementById('login-entrar').addEventListener('click', () => {
  const input = document.getElementById('login-input');
  if (!input.value.trim()){
    input.style.borderColor = 'var(--bad)';
    input.placeholder = 'Digite seu nome pra continuar';
    return;
  }
  definirUsuario(input.value);
  iniciarDashboard();
});
document.getElementById('login-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('login-entrar').click();
});
document.getElementById('login-input').addEventListener('input', e => {
  e.target.style.borderColor = '';
});
document.getElementById('login-recentes-nomes').addEventListener('click', e => {
  const btn = e.target.closest('button[data-nome]');
  if (!btn) return;
  definirUsuario(btn.dataset.nome);
  iniciarDashboard();
});

if (usuarioAtual()){
  iniciarDashboard();
} else {
  mostrarLogin();
}

function copyToClipboard(text){
  if (navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
}
function fallbackCopy(text){
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch (e) {}
  document.body.removeChild(ta);
}

document.addEventListener('click', e => {
  const chip = e.target.closest('.codechip');
  if (chip){
    e.stopPropagation();
    copyToClipboard(chip.dataset.copy);
    chip.classList.add('copied');
    setTimeout(() => chip.classList.remove('copied'), 900);
    return;
  }
  const confirmar = e.target.closest('[data-confirmar]');
  if (confirmar){
    e.stopPropagation();
    marcarRevisao(confirmar.dataset.confirmar, 'confirmado');
    refreshAll();
    return;
  }
  const rejeitar = e.target.closest('[data-rejeitar]');
  if (rejeitar){
    e.stopPropagation();
    marcarRevisao(rejeitar.dataset.rejeitar, 'falso_positivo');
    refreshAll();
    return;
  }
  const undo = e.target.closest('[data-undo]');
  if (undo){
    e.stopPropagation();
    delete REVISOES[undo.dataset.undo];
    salvarRevisoes();
    refreshAll();
    return;
  }
});
