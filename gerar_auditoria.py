# -*- coding: utf-8 -*-
"""
Pipeline completo da auditoria: le os PDFs de Atendimento e os .ods de
Transferencias/Correcoes de Estoque, cruza tudo e gera audit_data.js
(o arquivo de dados que o dashboard auditoria.html consome).

USO:
    pip install pandas odfpy pdfplumber --break-system-packages
    (precisa tambem do poppler-utils instalado no sistema, pro comando pdftotext)

    python3 gerar_auditoria.py \
        --atend-transferencias caminho/relatorio_transferencias.pdf \
        --atend-uso caminho/relatorio_uso.pdf \
        --ods-transferencias "caminho/Relação de Transferências - Analítico.ods" \
        --ods-correcoes "caminho/Relação de Correções de Estoque - Analítico.ods" \
        --saida audit_data.js

Depois é so abrir auditoria.html no navegador (ele carrega audit_data.js
automaticamente, sem precisar de servidor).
"""
import argparse
import json
import subprocess
import tempfile
import os

import parser_atendimentos as pa
import parser_ods as po
import matching as mt


def pdf_para_texto(caminho_pdf):
    """Usa pdftotext -layout (poppler-utils) para extrair o texto preservando colunas."""
    with tempfile.NamedTemporaryFile(suffix='.txt', delete=False) as tmp:
        tmp_path = tmp.name
    subprocess.run(['pdftotext', '-layout', caminho_pdf, tmp_path], check=True,
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    with open(tmp_path, encoding='utf-8') as f:
        texto = f.read()
    os.unlink(tmp_path)
    return texto


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--atend-transferencias', required=True, help='PDF de atendimentos filtrado por Transferência')
    ap.add_argument('--atend-uso', required=True, help='PDF de atendimentos filtrado por Uso e Consumo')
    ap.add_argument('--ods-transferencias', required=True, help='.ods "Relação de Transferências - Analítico"')
    ap.add_argument('--ods-correcoes', required=True, help='.ods "Relação de Correções de Estoque - Analítico"')
    ap.add_argument('--saida', default='audit_data.js')
    ap.add_argument('--data-geracao', default=None, help='Data a exibir no dashboard (padrão: hoje)')
    args = ap.parse_args()

    print('Lendo PDFs de atendimento...')
    txt_transf = pdf_para_texto(args.atend_transferencias)
    txt_uso = pdf_para_texto(args.atend_uso)

    with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False, encoding='utf-8') as f1:
        f1.write(txt_transf); path_transf = f1.name
    with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False, encoding='utf-8') as f2:
        f2.write(txt_uso); path_uso = f2.name

    at_transf, at_transf_rev, sem_resumo_1 = pa.parse_file(path_transf)
    at_uso, at_uso_rev, sem_resumo_2 = pa.parse_file(path_uso)
    os.unlink(path_transf); os.unlink(path_uso)

    at_transf = [a for a in at_transf if a['tipo_controle'].startswith('016.002')]
    at_uso = [a for a in at_uso if a['tipo_controle'].startswith('016.001')]

    print(f'  Transferências: {len(at_transf)} auditáveis, {len(at_transf_rev)} p/ revisão, {sem_resumo_1} corrompidos')
    print(f'  Uso/Consumo:    {len(at_uso)} auditáveis, {len(at_uso_rev)} p/ revisão, {sem_resumo_2} corrompidos')

    print('Lendo planilhas .ods...')
    transf = po.parse_transferencias(args.ods_transferencias)
    corr = po.parse_correcoes(args.ods_correcoes)
    print(f'  Transferências executadas: {len(transf)}')
    print(f'  Correções de estoque: {len(corr)}')

    print('Cruzando dados...')
    res_transf, orf_transf = mt.match_transferencias(at_transf, transf)
    res_uso, orf_uso = mt.match_uso_consumo(at_uso, corr)

    import datetime
    data_geracao = args.data_geracao or datetime.date.today().strftime('%d/%m/%Y')

    out = {
        'gerado_em': data_geracao,
        'transferencias': {'resultados': res_transf, 'orfas': orf_transf, 'revisao_manual': at_transf_rev},
        'uso_consumo': {'resultados': res_uso, 'orfas': orf_uso, 'revisao_manual': at_uso_rev},
    }

    with open(args.saida, 'w', encoding='utf-8') as f:
        f.write('const AUDIT_DATA = ')
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
        f.write(';')

    print(f'\nPronto! {args.saida} gerado. Abra auditoria.html no navegador pra ver o resultado.')


if __name__ == '__main__':
    main()
