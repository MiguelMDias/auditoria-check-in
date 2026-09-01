// Porta fiel de matching.py para JavaScript.

const STOPWORDS = new Set([
  'de','da','do','das','dos','para','com','sem','tamanho','cor','uso','consumo',
  'e','o','a','os','as','um','uma','n','no','na',
]);
const TOKENS_GENERICOS = new Set([
  'azul','vermelho','vermelha','preto','preta','branco','branca','verde','amarelo',
  'amarela','cinza','rosa','laranja','marrom','roxo','grande','pequeno','medio',
  'novo','nova','tam','xg','gg','g','m','p','pp',
]);

const ACCENT_MAP_MATCHING = {
  'á':'a','à':'a','â':'a','ã':'a','ä':'a','é':'e','è':'e','ê':'e','ë':'e',
  'í':'i','ì':'i','î':'i','ï':'i','ó':'o','ò':'o','ô':'o','õ':'o','ö':'o',
  'ú':'u','ù':'u','û':'u','ü':'u','ç':'c',
};
function semAcento(s){
  return s.toLowerCase().split('').map(c => ACCENT_MAP_MATCHING[c] || c).join('');
}

function normalizaTexto(s){
  if (!s) return [];
  let str = semAcento(String(s)).replace(/["'()]/g, ' ');
  let tokens = str.match(/[a-z0-9]+/g) || [];
  tokens = tokens.map(t => (t.endsWith('s') && t.length > 4 && !/^\d+$/.test(t)) ? t.slice(0, -1) : t);
  return tokens.filter(t => !STOPWORDS.has(t) && t.length > 1);
}

function scoreNome(nomePedido, descricaoExecucao){
  const t1 = new Set(normalizaTexto(nomePedido));
  const t2 = new Set(normalizaTexto(descricaoExecucao));
  const overlap = [...t1].filter(t => t2.has(t));
  const especificos = overlap.filter(t => !TOKENS_GENERICOS.has(t));
  if (!especificos.length) return 0;
  return overlap.length;
}

function normProduto(p){
  const s = String(p ?? '').split('.').join('');
  const stripped = s.replace(/^0+/, '');
  return stripped || '0';
}

function qtdBate(q1, q2, tolerancia=0.001){
  if (q1 === null || q1 === undefined || q2 === null || q2 === undefined) return false;
  const n1 = parseFloat(String(q1).replace(',', '.'));
  const n2 = parseFloat(String(q2).replace(',', '.'));
  if (Number.isNaN(n1) || Number.isNaN(n2)) return false;
  return Math.abs(n1 - n2) <= tolerancia;
}

function matchTransferencias(atendimentos, transferencias){
  const idx = {};
  for (const t of transferencias){
    for (const it of t.itens){
      const key = normProduto(it.produto);
      (idx[key] = idx[key] || []).push([t, it]);
    }
  }
  const usados = new Set();
  const resultado = [];

  for (const at of atendimentos){
    for (const sub of at.sub_pedidos){
      for (const prod of sub.produtos){
        const p = normProduto(prod.codigo);
        const candidatosBrutos = idx[p] || [];
        const candidatos = [];
        for (const [t, it] of candidatosBrutos){
          const chave = t.codigo + '|' + p;
          if (usados.has(chave)) continue;
          const rotaOk = (sub.origem === null || sub.origem === t.empresa_origem) &&
                         (sub.destino === null || sub.destino === t.empresa_destino);
          const qtdOk = qtdBate(prod.quantidade, it.quantidade);
          candidatos.push({ t, it, rotaOk, qtdOk, score: (rotaOk?1:0) + (qtdOk?1:0), chave });
        }

        const registro = {
          atendimento_controle: at.controle, atendimento_data: at.data,
          atendimento_usuario_baixa: at.usuario_baixa ?? null,
          origem: sub.origem, destino: sub.destino,
          produto: prod.codigo, quantidade_pedida: prod.quantidade,
          pedido_cliente: sub.pedido_cliente,
        };

        if (!candidatos.length){
          registro.veredito = 'NAO_ENCONTRADO';
          registro.detalhe = 'Nenhuma transferência no sistema tem esse produto — o pedido pode não ter sido executado ainda, ou foi lançado com um código de produto diferente.';
          resultado.push(registro);
          continue;
        }

        candidatos.sort((a,b) => b.score - a.score);
        const melhores = candidatos.filter(c => c.score === candidatos[0].score);

        if (melhores.length > 1 && candidatos[0].score < 2){
          registro.veredito = 'AMBIGUO';
          registro.detalhe = `Encontrei ${melhores.length} transferências com este produto, mas nenhuma bate exatamente em rota e quantidade ao mesmo tempo — confira manualmente qual delas corresponde a este pedido.`;
          registro.candidatos = melhores.slice(0,5).map(c => c.t.codigo);
          resultado.push(registro);
          continue;
        }
        if (melhores.length > 1 && candidatos[0].score === 2){
          registro.veredito = 'AMBIGUO';
          registro.detalhe = `Encontrei ${melhores.length} transferências que batem exatamente (produto, rota e quantidade) — pode ser duplicidade de lançamento, ou duas transferências reais e idênticas no mesmo dia. Confirme qual pertence a este pedido.`;
          registro.candidatos = melhores.slice(0,5).map(c => c.t.codigo);
          resultado.push(registro);
          continue;
        }

        const c = melhores[0];
        usados.add(c.chave);
        registro.transferencia_codigo = c.t.codigo;
        registro.transferencia_motivo = c.t.motivo;
        registro.transferencia_status = c.t.status;
        registro.transferencia_usuario = c.t.usuario_insercao ?? null;
        registro.quantidade_executada = c.it.quantidade;

        const problemas = [];
        const tipos = [];
        if (!c.rotaOk){
          tipos.push('rota');
          problemas.push(`Rota diferente da pedida: o atendimento pediu ${sub.origem||'?'} → ${sub.destino||'?'}, mas a transferência encontrada foi de ${c.t.empresa_origem} → ${c.t.empresa_destino}.`);
        }
        if (!c.qtdOk){
          tipos.push('quantidade');
          const p1 = parseFloat(String(prod.quantidade).replace(',','.'));
          const p2 = parseFloat(c.it.quantidade);
          const diff = (!Number.isNaN(p1) && !Number.isNaN(p2)) ? ` (diferença de ${Math.abs(Math.round((p1-p2)*1000)/1000)})` : '';
          problemas.push(`Quantidade diferente: pedido pediu ${prod.quantidade}, transferência executou ${c.it.quantidade}${diff}.`);
        }
        if (sub.pedido_cliente && !String(c.t.motivo).trim().startsWith('2')){
          tipos.push('motivo_pedido_sem_2');
          problemas.push(`Atendimento cita o pedido de cliente ${sub.pedido_cliente}, mas a transferência foi lançada com motivo "${c.t.motivo}" em vez de "2 - Transferência para atender pedido".`);
        }
        if (!sub.pedido_cliente && String(c.t.motivo).trim().startsWith('2')){
          tipos.push('motivo_2_sem_pedido');
          problemas.push('Transferência foi lançada com motivo "2 - Transferência para atender pedido", mas o atendimento não cita nenhum número de pedido de cliente.');
        }

        if (problemas.length){
          registro.veredito = 'DIVERGENTE';
          registro.tipos_divergencia = tipos;
          registro.detalhe = problemas.join(' ');
        } else {
          registro.veredito = 'BATIDO';
          registro.detalhe = 'Produto, quantidade e rota conferem entre o pedido e a execução.';
        }
        resultado.push(registro);
      }
    }
  }

  const orfas = [];
  for (const t of transferencias){
    for (const it of t.itens){
      const chave = t.codigo + '|' + normProduto(it.produto);
      if (!usados.has(chave)){
        orfas.push({
          transferencia_codigo: t.codigo, produto: it.produto, quantidade: it.quantidade,
          origem: t.empresa_origem, destino: t.empresa_destino, motivo: t.motivo, data: t.data_cadastro,
          transferencia_usuario: t.usuario_insercao ?? null,
          veredito: 'SEM_ATENDIMENTO',
          detalhe: 'Esta transferência foi executada no sistema, mas não encontrei nenhum atendimento (solicitação) que a originou.',
        });
      }
    }
  }
  return { resultados: resultado, orfas };
}

function matchUsoConsumo(atendimentos, correcoes){
  const usos = correcoes.filter(c => c.tipo_correcao === 'Uso e consumo');
  const idxCodigo = {};
  const listaItens = [];
  for (const c of usos){
    for (const it of c.itens){
      const key = normProduto(it.produto);
      (idxCodigo[key] = idxCodigo[key] || []).push([c, it]);
      listaItens.push([c, it]);
    }
  }
  const usados = new Set();
  const resultado = [];

  function candidatosPorCodigo(prod){
    const p = normProduto(prod.codigo);
    const out = [];
    for (const [c, it] of (idxCodigo[p] || [])){
      const chave = c.codigo + '|' + p;
      if (usados.has(chave)) continue;
      out.push({ c, it, qtdOk: qtdBate(prod.quantidade, it.quantidade), chave, metodo: 'codigo' });
    }
    return out;
  }
  function candidatosPorNome(prod){
    let melhores = [], melhorScore = 0;
    for (const [c, it] of listaItens){
      const chave = c.codigo + '|nome:' + normProduto(it.produto);
      if (usados.has(chave)) continue;
      const score = scoreNome(prod.nome, it.descricao);
      if (score === 0) continue;
      if (score > melhorScore){
        melhores = [{ c, it, qtdOk: qtdBate(prod.quantidade, it.quantidade), chave, metodo: 'nome', score }];
        melhorScore = score;
      } else if (score === melhorScore){
        melhores.push({ c, it, qtdOk: qtdBate(prod.quantidade, it.quantidade), chave, metodo: 'nome', score });
      }
    }
    return melhores;
  }

  for (const at of atendimentos){
    for (const sub of at.sub_pedidos){
      for (const prod of sub.produtos){
        const usaNome = !prod.codigo;
        const candidatos = usaNome ? candidatosPorNome(prod) : candidatosPorCodigo(prod);

        const registro = {
          atendimento_controle: at.controle, atendimento_data: at.data,
          atendimento_usuario_baixa: at.usuario_baixa ?? null,
          produto: prod.codigo || (prod.nome || '(sem identificação)'),
          quantidade_pedida: prod.quantidade,
          metodo_extracao: prod.metodo || 'codigo>qtd',
        };
        if (!candidatos.length){
          registro.veredito = 'NAO_ENCONTRADO';
          registro.detalhe = !usaNome
            ? 'Nenhuma saída de uso/consumo com este produto no sistema.'
            : `Nenhuma saída de uso/consumo com descrição parecida com "${prod.nome}".`;
          resultado.push(registro);
          continue;
        }

        const exatos = candidatos.filter(c => c.qtdOk);
        const escolhidos = exatos.length ? exatos : candidatos;
        if (escolhidos.length > 1){
          registro.veredito = 'AMBIGUO';
          registro.detalhe = `Encontrei ${escolhidos.length} correções de estoque candidatas para o mesmo produto` +
            (usaNome ? ' — casamento por nome, confira manualmente qual é a correta.' : ' — confira manualmente qual pertence a este pedido.');
          registro.candidatos = escolhidos.slice(0,5).map(c => c.c.codigo);
          resultado.push(registro);
          continue;
        }

        const c = escolhidos[0];
        usados.add(c.chave);
        registro.correcao_codigo = c.c.codigo;
        registro.correcao_empresa = c.c.empresa;
        registro.correcao_descricao = c.it.descricao;
        registro.quantidade_executada = c.it.quantidade;
        registro.correcao_usuario = c.c.usuario_retirou || c.c.usuario_insercao || null;
        registro.casado_por = usaNome ? 'nome (sem código no pedido)' : 'código';
        if (!c.qtdOk){
          registro.veredito = 'DIVERGENTE';
          registro.tipos_divergencia = ['quantidade'];
          registro.detalhe = `Quantidade diferente: pedido pediu ${prod.quantidade}, saída de estoque registrou ${c.it.quantidade}.`;
        } else {
          registro.veredito = 'BATIDO';
          registro.detalhe = 'Produto e quantidade conferem.' + (usaNome ? ' Casado por nome (sem código no pedido).' : '');
        }
        resultado.push(registro);
      }
    }
  }

  const orfas = [];
  for (const c of usos){
    for (const it of c.itens){
      const chaveCod = c.codigo + '|' + normProduto(it.produto);
      const chaveNome = c.codigo + '|nome:' + normProduto(it.produto);
      if (!usados.has(chaveCod) && !usados.has(chaveNome)){
        orfas.push({
          correcao_codigo: c.codigo, produto: it.produto, descricao: it.descricao,
          quantidade: it.quantidade, empresa: c.empresa, data: c.data,
          correcao_usuario: c.usuario_retirou || c.usuario_insercao || null,
          veredito: 'SEM_ATENDIMENTO',
          detalhe: 'Esta saída de uso/consumo foi lançada no sistema, mas não encontrei nenhum atendimento (solicitação) que a originou.',
        });
      }
    }
  }
  return { resultados: resultado, orfas };
}

