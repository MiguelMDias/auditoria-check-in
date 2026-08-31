const VEREDICT_META = {
  BATIDO:         { css: 'ok',   label: 'Batido',           color: 'var(--ok)'   },
  DIVERGENTE:     { css: 'warn', label: 'Divergente',        color: 'var(--warn)' },
  AMBIGUO:        { css: 'amb',  label: 'Ambíguo',           color: 'var(--amb)'  },
  NAO_ENCONTRADO: { css: 'bad',  label: 'Não encontrado',    color: 'var(--bad)'  },
  SEM_ATENDIMENTO:{ css: 'orfa', label: 'Execução órfã',     color: 'var(--orfa)' },
  REVISAO:        { css: 'rev',  label: 'Revisão manual',    color: 'var(--rev)'  },
};

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
  const all = [...T.resultados, ...U.resultados];
  const count = v => all.filter(r => r.veredito === v).length;
  const orfas = T.orfas.length + U.orfas.length;
  const revisao = T.revisao_manual.length + U.revisao_manual.length;

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
  `).join('');
}

function stackBar(counts, total){
  if (!total) return '';
  return Object.entries(counts).filter(([,v]) => v > 0).map(([key, v]) => {
    const meta = VEREDICT_META[key];
    const pct = (v / total * 100).toFixed(2);
    return `<span style="width:${pct}%; background:${meta.color}" title="${meta.label}: ${v}"></span>`;
  }).join('');
}

function rowDetailTransf(r){
  if (r.veredito === 'SEM_ATENDIMENTO'){
    return `<dl>
      <dt>transferência</dt><dd>${r.transferencia_codigo}</dd>
      <dt>rota</dt><dd>${r.origem} &rarr; ${r.destino}</dd>
      <dt>motivo</dt><dd>${r.motivo}</dd>
      <dt>data</dt><dd>${r.data}</dd>
    </dl><p class="obs">${r.detalhe}</p>`;
  }
  if (r.veredito === 'REVISAO'){
    return `<dl>
      <dt>controle</dt><dd>${r.controle}</dd>
      <dt>data</dt><dd>${r.data}</dd>
      <dt>status</dt><dd>${r.status_final}</dd>
    </dl><p class="obs">${r.motivo_revisao}<br><br>"${(r.texto_original||'').replace(/\n/g,' / ')}"</p>`;
  }
  const rows = [
    ['atendimento', r.atendimento_controle],
    ['data', r.atendimento_data],
    ['produto', r.produto],
    ['qtd. pedida', fmtQtd(r.quantidade_pedida)],
  ];
  if (r.pedido_cliente) rows.push(['pedido cliente', r.pedido_cliente]);
  if (r.transferencia_codigo){
    rows.push(['transferência', r.transferencia_codigo]);
    rows.push(['qtd. executada', fmtQtd(r.quantidade_executada)]);
    rows.push(['motivo', r.transferencia_motivo]);
    rows.push(['status', r.transferencia_status]);
  }
  if (r.veredito === 'AMBIGUO' && r.candidatos) rows.push(['candidatos', r.candidatos.join(', ')]);
  return `<dl>${rows.map(([k,v]) => `<dt>${k}</dt><dd>${v ?? '—'}</dd>`).join('')}</dl>
    <p class="obs">${r.detalhe}</p>`;
}

function rowDetailUso(r){
  if (r.veredito === 'SEM_ATENDIMENTO'){
    return `<dl>
      <dt>correção</dt><dd>${r.correcao_codigo}</dd>
      <dt>empresa</dt><dd>${r.empresa}</dd>
      <dt>data</dt><dd>${r.data}</dd>
    </dl><p class="obs">${r.detalhe}</p>`;
  }
  if (r.veredito === 'REVISAO'){
    return `<dl>
      <dt>controle</dt><dd>${r.controle}</dd>
      <dt>data</dt><dd>${r.data}</dd>
      <dt>status</dt><dd>${r.status_final}</dd>
    </dl><p class="obs">${r.motivo_revisao}<br><br>"${(r.texto_original||'').replace(/\n/g,' / ')}"</p>`;
  }
  const rows = [
    ['atendimento', r.atendimento_controle],
    ['data', r.atendimento_data],
    ['produto', r.produto],
    ['qtd. pedida', fmtQtd(r.quantidade_pedida)],
  ];
  if (r.correcao_codigo){
    rows.push(['correção', r.correcao_codigo]);
    rows.push(['empresa', r.correcao_empresa]);
    rows.push(['qtd. executada', fmtQtd(r.quantidade_executada)]);
  }
  if (r.veredito === 'AMBIGUO' && r.candidatos) rows.push(['candidatos', r.candidatos.join(', ')]);
  return `<dl>${rows.map(([k,v]) => `<dt>${k}</dt><dd>${v ?? '—'}</dd>`).join('')}</dl>
    <p class="obs">${r.detalhe}</p>`;
}

function rowHead(r, kind){
  const meta = VEREDICT_META[r.veredito];
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
  return `<div class="row-top">
    <span class="row-code">${r.atendimento_controle}</span>
    ${route}
    <span class="row-prod">produto ${r.produto} · qtd ${fmtQtd(r.quantidade_pedida)}</span>
    <span class="row-badge ${meta.css}">${meta.label}</span>
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

function buildReport(containerId, title, dataBlock, kind){
  const resultados = dataBlock.resultados.map(r => ({ ...r }));
  const orfas = dataBlock.orfas.map(r => ({ ...r, veredito: 'SEM_ATENDIMENTO' }));
  const revisao = dataBlock.revisao_manual.map(r => ({ ...r, veredito: 'REVISAO' }));
  const all = [...resultados, ...orfas, ...revisao];

  const counts = {};
  Object.keys(VEREDICT_META).forEach(k => counts[k] = all.filter(r => r.veredito === k).length);

  const container = document.getElementById(containerId);
  container.innerHTML = `
    <div class="report-head">
      <h2>${title}</h2>
      <span class="count">${all.length} registros</span>
    </div>
    <div class="stackbar">${stackBar(counts, all.length)}</div>
    <div class="chiprow" id="${containerId}-chips">
      <div class="chip active" data-f="ALL"><span>Todos</span><span>${all.length}</span></div>
      ${Object.entries(VEREDICT_META).filter(([k]) => counts[k] > 0).map(([k, m]) => `
        <div class="chip" data-f="${k}"><span class="dot" style="background:${m.color}"></span><span>${m.label}</span><span>${counts[k]}</span></div>
      `).join('')}
    </div>
    <div class="searchbox"><input type="text" placeholder="buscar por código, produto, controle..." id="${containerId}-search"></div>
    <div class="ledger" id="${containerId}-list"></div>
  `;

  let currentFilter = 'ALL';
  let currentSearch = '';

  function render(){
    const list = document.getElementById(`${containerId}-list`);
    const filtered = all.filter(r => {
      if (currentFilter !== 'ALL' && r.veredito !== currentFilter) return false;
      if (currentSearch && !searchKey(r, kind).includes(currentSearch)) return false;
      return true;
    });
    if (!filtered.length){
      list.innerHTML = `<div class="empty">nenhum registro encontrado</div>`;
      return;
    }
    const detailFn = kind === 'transf' ? rowDetailTransf : rowDetailUso;
    list.innerHTML = filtered.map((r, i) => `
      <div class="row ${VEREDICT_META[r.veredito].css}" data-i="${i}">
        ${rowHead(r, kind)}
        <div class="row-detail">${detailFn(r)}</div>
      </div>
    `).join('');
    list.querySelectorAll('.row').forEach(el => {
      el.addEventListener('click', () => el.classList.toggle('expanded'));
    });
  }

  document.getElementById(`${containerId}-chips`).addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    currentFilter = chip.dataset.f;
    document.querySelectorAll(`#${containerId}-chips .chip`).forEach(c => c.classList.toggle('active', c === chip));
    render();
  });

  document.getElementById(`${containerId}-search`).addEventListener('input', e => {
    currentSearch = e.target.value.trim().toLowerCase();
    render();
  });

  render();
}

buildMeta();
buildTally();
buildReport('report-transferencias', 'Transferências', AUDIT_DATA.transferencias, 'transf');
buildReport('report-uso', 'Uso e consumo', AUDIT_DATA.uso_consumo, 'uso');
