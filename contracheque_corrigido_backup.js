                         SELECT DISTINCT v2.TIPO, v2.VALOR
                         FROM gsd876f_valores v2 
                         WHERE v2.MAR = f.MAT_WEB AND v2.MES = ? AND v2.ANO = ? AND v2.CD = 'C'
                     ) as valor_unico), 0
                ) as valor_bruto,
                
                COALESCE(
                    (SELECT SUM(CAST(REPLACE(valor_unico.VALOR, ',', '.') AS DECIMAL(10,2)))
                     FROM (
                         SELECT DISTINCT v2.TIPO, v2.VALOR
                         FROM gsd876f_valores v2 
                         WHERE v2.MAR = f.MAT_WEB AND v2.MES = ? AND v2.ANO = ? AND v2.CD = 'D'
                     ) as valor_unico), 0
                ) as valor_desconto
                
            FROM folweb f 
            LEFT JOIN gsd876f_valores v ON f.MAT_WEB = v.MAR AND v.MES = ? AND v.ANO = ?
            LEFT JOIN gsd876f_cadastros c ON f.MAT_WEB = c.MAR
            WHERE v.MAR IS NOT NULL
            GROUP BY f.MAT_WEB, f.NOME_WEB, f.CPF_WEB, f.CARGO_WEB, c.BANCO, c.AG, c.CONTA
            HAVING valor_bruto > 0 OR valor_desconto > 0
            ORDER BY f.NOME_WEB
            LIMIT 100
        `;
        
        console.log('📊 Executando consulta...');
        const [rows] = await connection.execute(sql, [MES, ANO, MES, ANO, MES, ANO, MES, ANO]);
        
        console.log(`📋 Encontrados ${rows.length} contracheques`);
        
        if (rows.length === 0) {
            console.log('⚠️ Nenhum contracheque encontrado.');
            return;
        }
        
        // Processar os dados
        const dadosProcessados = rows.map(row => ({
            ...row,
            valor_liquido: row.valor_bruto - row.valor_desconto,
            margem_consignavel: (row.valor_bruto - row.valor_desconto) * 0.35
        }));
        
        let nomeArquivoHTML, nomeArquivoPDF;
        
        // Gerar HTML se solicitado
        if (gerarHTML) {
            console.log('🎨 Gerando HTML...');
            const html = await gerarHTMLCompleto(dadosProcessados, MES, ANO);
            nomeArquivoHTML = `contracheques_${MES}_${ANO}.html`;
            await fs.writeFile(nomeArquivoHTML, html, 'utf8');
            
            const statsHTML = await fs.stat(nomeArquivoHTML);
            console.log('✅ HTML gerado com sucesso!');
            console.log(`📄 Nome: ${nomeArquivoHTML}`);
            console.log(`💾 Tamanho: ${formatBytes(statsHTML.size)}`);
        }
        
        // Gerar PDF se solicitado
        if (gerarPDFTambem) {
            if (!gerarHTML) {
                console.log('🎨 Gerando HTML temporário para PDF...');
                var html = await gerarHTMLCompleto(dadosProcessados, MES, ANO);
            }
            
            nomeArquivoPDF = await gerarPDF(html, `contracheques_${MES}_${ANO}.html`);
        }
        
        // Mostrar exemplo de contracheque
        const exemploContracheque = dadosProcessados[0];
        if (exemploContracheque) {
            console.log('\n📋 Exemplo de contracheque processado:');
            console.log('Matrícula:', exemploContracheque.matricula);
            console.log('Nome:', exemploContracheque.nome);
            console.log('Banco:', exemploContracheque.banco);
            console.log('Agência:', exemploContracheque.agencia || 'Não informada');
            console.log('Conta:', exemploContracheque.conta || 'Não informada');
            console.log('Valor Bruto:', formatarMoeda(exemploContracheque.valor_bruto));
            console.log('Valor Líquido:', formatarMoeda(exemploContracheque.valor_liquido));
        }
        
        return {
            html: nomeArquivoHTML,
            pdf: nomeArquivoPDF,
            totalContracheques: dadosProcessados.length
        };
        
    } catch (error) {
        console.error('❌ Erro:', error.message);
        throw error;
    } finally {
        if (connection) {
            await connection.end();
            console.log('🔌 Conexão fechada');
        }
    }
}

function gerarIndice(contracheques, mesNome, ano) {
    let html = `
    <div id="contracheque-index" class="contracheque-index" style="display: none;">
        <div class="index-header">
            <h2><i class="fas fa-list"></i> Índice de Contracheques - ${mesNome}/${ano}</h2>
            <button onclick="toggleIndex()" class="close-index">
                <i class="fas fa-times"></i>
            </button>
        </div>
        <div class="index-content">
            <div class="index-stats">
                <span class="stat-item">
                    <i class="fas fa-users"></i>
                    Total: ${contracheques.length} beneficiários
                </span>
                <span class="stat-item">
                    <i class="fas fa-calculator"></i>
                    Valor total: R$ ${contracheques.reduce((sum, c) => sum + parseFloat(c.valor_liquido || 0), 0).toLocaleString('pt-BR', {minimumFractionDigits: 2})}
                </span>
                <span class="stat-item">
                    <i class="fas fa-check-circle"></i>
                    Layout Profissional
                </span>
            </div>
            <div class="index-search">
                <input type="text" id="search-input" placeholder="Buscar por nome ou matrícula..." onkeyup="filterIndex()">
            </div>
            <div class="index-list" id="index-list">`;
    
    contracheques.forEach((dados, index) => {
        html += `
                <div class="index-item" data-name="${dados.nome.toLowerCase()}" data-matricula="${dados.matricula}">
                    <span class="index-name" onclick="scrollToContracheque(${index})">
                        <strong>${dados.nome}</strong>
                        <small>Mat: ${dados.matricula} | R$ ${parseFloat(dados.valor_liquido || 0).toLocaleString('pt-BR', {minimumFractionDigits: 2})}</small>
                    </span>
                </div>`;
    });
    
    html += `
            </div>
        </div>
    </div>`;
    
    return html;
}

function getCSS() {
    return `
        /* VARIÁVEIS CSS - Cores Minimalistas e Profissionais */
        :root {
            --primary-color: #2563eb;
            --primary-light: #dbeafe;
            --primary-border: #93c5fd;
            --secondary-color: #475569;
            --text-dark: #1e293b;
            --text-gray: #64748b;
            --text-light: #94a3b8;
            --border-light: #e2e8f0;
            --bg-gray: #f8fafc;
            --bg-white: #ffffff;
            --shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06);
            --shadow-lg: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
            --success-color: #059669;
            --success-light: #d1fae5;
            --error-color: #dc2626;
            --error-light: #fee2e2;
            --warning-color: #d97706;
            --warning-light: #fef3c7;
        }

        /* RESET E CONFIGURAÇÕES BÁSICAS */
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Noto Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: var(--bg-white);
            line-height: 1.5;
            color: var(--text-dark);
            font-size: 14px;
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
        }

        /* ÍNDICE NAVEGÁVEL */
        .contracheque-index {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.95);
            z-index: 9999;
            overflow-y: auto;
        }

        .index-header {
            background: var(--primary-color);
            color: white;
            padding: 20px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            position: sticky;
            top: 0;
            z-index: 10000;
            box-shadow: var(--shadow-lg);
        }

        .index-header h2 {
            font-weight: 600;
            font-size: 18px;
        }

        .close-index {
            background: none;
            border: none;
            color: white;
            font-size: 20px;
            cursor: pointer;
            padding: 8px;
            border-radius: 4px;
            transition: background 0.2s;
        }

        .close-index:hover {
            background: rgba(255, 255, 255, 0.1);
        }

        .index-content {
            padding: 24px;
            max-width: 1200px;
            margin: 0 auto;
        }

        .index-stats {
            display: flex;
            justify-content: center;
            gap: 24px;
            margin-bottom: 24px;
            flex-wrap: wrap;
        }

        .stat-item {
            background: var(--bg-white);
            padding: 16px 24px;
            border-radius: 8px;
            color: var(--text-dark);
            font-weight: 500;
            display: flex;
            align-items: center;
            gap: 8px;
            box-shadow: var(--shadow);
        }

        .index-search {
            margin-bottom: 24px;
            text-align: center;
        }

        .index-search input {
            width: 100%;
            max-width: 400px;
            padding: 12px 16px;
            font-size: 14px;
            border: 2px solid var(--border-light);
            border-radius: 8px;
            outline: none;
            font-family: inherit;
            transition: border-color 0.2s;
        }

        .index-search input:focus {
            border-color: var(--primary-color);
        }

        .index-list {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
            gap: 16px;
        }

        .index-item {
            background: var(--bg-white);
            border-radius: 8px;
            padding: 16px;
            cursor: pointer;
            transition: all 0.2s;
            border: 1px solid var(--border-light);
            box-shadow: var(--shadow);
        }

        .index-item:hover {
            transform: translateY(-2px);
            box-shadow: var(--shadow-lg);
            border-color: var(--primary-border);
        }

        .index-name strong {
            display: block;
            color: var(--text-dark);
            margin-bottom: 4px;
            font-weight: 600;
        }

        .index-name small {
            color: var(--text-gray);
            font-size: 12px;
        }

        /* CONTROLES DE IMPRESSÃO */
        .print-controls {
            position: fixed;
            bottom: 24px;
            right: 24px;
            display: flex;
            flex-direction: column;
            gap: 12px;
            z-index: 1000;
        }

        .print-button, .index-button {
            background: var(--primary-color);
            color: white;
            border: none;
            width: 56px;
            height: 56px;
            border-radius: 50%;
            font-size: 18px;
            cursor: pointer;
            box-shadow: var(--shadow-lg);
            transition: all 0.2s ease;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .print-button:hover, .index-button:hover {
            transform: scale(1.05);
            background: #1d4ed8;
        }

        /* CONTAINER PRINCIPAL DO CONTRACHEQUE */
        .contracheque-container {
            background: var(--bg-white);
            width: 100%;
            max-width: 210mm;
            margin: 0 auto 20px auto;
            border: 1px solid var(--border-light);
            position: relative;
            min-height: 297mm;
            page-break-after: always;
            page-break-inside: avoid;
            box-shadow: var(--shadow);
        }

        /* HEADER SECTION */
        .header-section {
            background: linear-gradient(135deg, var(--bg-gray) 0%, #f1f5f9 100%);
            border-bottom: 2px solid var(--primary-color);
            padding: 16px;
        }

        .header-grid {
            display: grid;
            grid-template-columns: 100px 1fr 100px;
            gap: 16px;
            align-items: center;
        }

        .logo-container {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 80px;
            background: var(--bg-white);
            border: 1px solid var(--border-light);
            border-radius: 8px;
            padding: 8px;
        }

        .logo-img {
            max-width: 80px;
            max-height: 60px;
            object-fit: contain;
        }

        .logo-placeholder {
            display: flex;
            flex-direction: column;
            align-items: center;
            color: var(--text-light);
            font-size: 10px;
            text-align: center;
        }

        .logo-placeholder i {
            font-size: 24px;
            margin-bottom: 4px;
            color: var(--primary-color);
        }

        .institution-info {
            text-align: center;
            padding: 0 16px;
        }

        .institution-title {
            font-size: 16px;
            font-weight: 700;
            color: var(--text-dark);
            margin-bottom: 8px;
            line-height: 1.3;
        }

        .institution-details {
            font-size: 11px;
            color: var(--text-gray);
            line-height: 1.4;
        }

        /* TÍTULO */
        .title-section {
            background: var(--primary-color);
            color: white;
            text-align: center;
            padding: 12px 16px;
            font-size: 14px;
            font-weight: 600;
            letter-spacing: 0.5px;
        }

        .title-section i {
            margin-right: 8px;
        }

        /* CONTEÚDO PRINCIPAL */
        .content-wrapper {
            padding: 16px;
            background: var(--bg-white);
        }

        .card {
            background: var(--bg-white);
            border-radius: 8px;
            border: 1px solid var(--border-light);
            margin-bottom: 16px;
            overflow: hidden;
            box-shadow: var(--shadow);
        }

        .card-header {
            background: var(--primary-light);
            border-bottom: 1px solid var(--primary-border);
            padding: 12px 16px;
            font-weight: 600;
            color: var(--text-dark);
            font-size: 13px;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .card-content {
            padding: 16px;
        }

        /* INFORMAÇÕES DO BENEFICIÁRIO */
        .beneficiary-grid {
            display: grid;
            grid-template-columns: 2fr 1fr;
            gap: 24px;
        }

        .info-field {
            margin-bottom: 12px;
        }

        .field-label {
            font-size: 10px;
            color: var(--text-gray);
            text-transform: uppercase;
            font-weight: 600;
            margin-bottom: 4px;
            letter-spacing: 0.5px;
        }

        .field-value {
            font-size: 12px;
            color: var(--text-dark);
            font-weight: 500;
            padding: 8px 12px;
            background: var(--bg-gray);
            border-radius: 4px;
            border-left: 3px solid var(--primary-color);
        }

        /* SEÇÃO DE VALORES */
        .values-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
        }

        .values-section {
            background: var(--bg-white);
            border-radius: 8px;
            border: 1px solid var(--border-light);
            overflow: hidden;
            box-shadow: var(--shadow);
        }

        .values-header {
            padding: 12px 16px;
            font-weight: 600;
            font-size: 12px;
            text-align: center;
            color: white;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
        }

        .credits-header {
            background: var(--success-color);
        }

        .debits-header {
            background: var(--error-color);
        }

        .values-content {
            padding: 8px;
            max-height: 140px;
            overflow-y: auto;
        }

        .value-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 6px 0;
            border-bottom: 1px solid var(--border-light);
        }

        .value-item:last-child {
            border-bottom: none;
        }

        .value-description {
            font-size: 10px;
            color: var(--text-gray);
            flex: 1;
            margin-right: 8px;
            font-weight: 500;
        }

        .value-amount {
            font-size: 11px;
            font-weight: 600;
            color: var(--text-dark);
            background: var(--bg-gray);
            padding: 4px 8px;
            border-radius: 4px;
            min-width: 80px;
            text-align: right;
        }

        /* RESUMO FINANCEIRO */
        .summary-grid {
            display: grid;
            grid-template-columns: 1fr 1fr 1fr;
            gap: 16px;
        }

        .summary-item {
            text-align: center;
            padding: 16px 12px;
            border-radius: 8px;
            border: 1px solid var(--border-light);
            background: var(--bg-white);
        }

        .summary-gross {
            background: var(--primary-light);
            border-color: var(--primary-border);
        }

        .summary-discount {
            background: var(--error-light);
            border-color: #fecaca;
        }

        .summary-net {
            background: var(--success-light);
            border: 2px solid var(--success-color);
        }

        .summary-label {
            font-size: 10px;
            color: var(--text-gray);
            font-weight: 600;
            margin-bottom: 4px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .summary-value {
            font-size: 14px;
            font-weight: 700;
            color: var(--text-dark);
        }

        .summary-net .summary-value {
            color: var(--success-color);
            font-size: 16px;
        }

        /* INFORMAÇÃO DE MARGEM */
        .margin-info {
            background: var(--warning-light);
            border: 1px solid var(--warning-color);
            border-radius: 6px;
            padding: 12px;
            text-align: center;
            font-size: 11px;
            color: var(--text-dark);
            margin-bottom: 16px;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
        }

        .margin-info i {
            color: var(--warning-color);
        }

        /* SEÇÃO DE MENSAGEM */
        .message-section {
            background: var(--warning-light);
            border: 1px solid var(--warning-color);
            border-radius: 6px;
            padding: 12px;
            text-align: center;
        }

        .message-title {
            font-size: 11px;
            font-weight: 600;
            color: var(--warning-color);
            margin-bottom: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
        }

        .message-content {
            font-size: 10px;
            color: var(--text-dark);
            line-height: 1.4;
        }

        /* ESTILOS DE IMPRESSÃO */
        @media print {
            body {
                background: white;
                margin: 0;
                padding: 0;
                font-size: 12px;
            }

            .print-controls, 
            .contracheque-index {
                display: none !important;
            }

            .contracheque-container {
                box-shadow: none;
                border: 1px solid #000;
                border-radius: 0;
                margin: 0;
                max-width: none;
                width: 100%;
                page-break-after: always;
                page-break-inside: avoid;
                background: white;
                min-height: auto;
            }

            .header-section {
                background: white !important;
                border-bottom: 2px solid var(--primary-color) !important;
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
            }

            .title-section {
                background: var(--primary-color) !important;
                color: white !important;
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
            }

            .values-header {
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
            }

            .credits-header {
                background: var(--success-color) !important;
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
            }

            .debits-header {
                background: var(--error-color) !important;
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
            }

            .summary-gross,
            .summary-discount,
            .summary-net,
            .margin-info,
            .message-section {
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
            }

            @page {
                size: A4 portrait;
                margin: 1cm;
            }

            /* Força quebra de página entre contracheques */
            .contracheque-container:not(:first-child) {
                page-break-before: always;
            }
        }

        /* DESIGN RESPONSIVO */
        @media (max-width: 768px) {
            .contracheque-container {
                margin: 0 8px 16px 8px;
                max-width: none;
            }

            .header-grid {
                grid-template-columns: 80px 1fr 80px;
                gap: 12px;
            }

            .logo-container {
                height: 60px;
            }

            .institution-title {
                font-size: 14px;
            }

            .beneficiary-grid {
                grid-template-columns: 1fr;
                gap: 16px;
            }

            .values-grid {
                grid-template-columns: 1fr;
                gap: 16px;
            }

            .summary-grid {
                grid-template-columns: 1fr;
                gap: 12px;
            }

            .index-list {
                grid-template-columns: 1fr;
            }

            .index-stats {
                flex-direction: column;
                align-items: center;
            }
        }

        /* MELHORIAS DE ACESSIBILIDADE */
        @media (prefers-reduced-motion: reduce) {
            * {
                animation-duration: 0.01ms !important;
                animation-iteration-count: 1 !important;
                transition-duration: 0.01ms !important;
            }
        }

        /* SUPORTE A IMPRESSÃO EM ESCALA DE CINZA */
        @media print and (monochrome) {
            .values-header,
            .summary-item,
            .margin-info,
            .message-section {
                background: white !important;
                border: 1px solid #000 !important;
            }
        }
    `;
}

// Executar o gerador
if (require.main === module) {
    console.log('🚀 Iniciando gerador de contracheques IPSEM CORRIGIDO...');
    console.log('✨ Melhorias implementadas:');
    console.log('   🎨 Layout profissional com cores minimalistas');
    console.log('   🖼️ Logos IPSEM e PMCG integradas');
    console.log('   📝 Fonte Noto Sans');
    console.log('   🖨️ Layout idêntico entre HTML e PDF');
    console.log('   ✅ Eliminação de duplicações');
    console.log('   📊 Dados bancários corretos');
    
    // Verificar argumentos da linha de comando
    const args = process.argv.slice(2);
    const somenteHTML = args.includes('--html');
    const somentePDF = args.includes('--pdf');
    
    if (somentePDF) {
        console.log('📄 Modo: Somente PDF');
        gerarContrachequesComPDF(false, true).catch(console.error);
    } else if (somenteHTML) {
        console.log('🌐 Modo: Somente HTML');
        gerarContracheques().catch(console.error);
    } else {
        console.log('📄🌐 Modo: HTML + PDF');
        gerarContrachequesComPDF(true, true).catch(console.error);
    }
}

module.exports = { 
    gerarContracheques, 
    gerarContrachequesComPDF,
    gerarPDF,
    diagnosticarDados 
}; {
            debitos.forEach(debito => {
                html += `<div class="value-item"><span>${escapeHtml(debito.descricao)}</span><span>${debito.valor}</span></div>`;
            });
        }
        
        html += `
                        </div>
                    </div>
                </div>
                
                <div class="summary">
                    <div class="summary-item summary-gross">
                        <div style="font-size: 10px; color: #64748b; font-weight: 600; margin-bottom: 4px;">VALOR BRUTO</div>
                        <div style="font-size: 14px; font-weight: 700;">${formatarMoeda(dados.valor_bruto)}</div>
                    </div>
                    <div class="summary-item summary-discount">
                        <div style="font-size: 10px; color: #64748b; font-weight: 600; margin-bottom: 4px;">VALOR DESCONTO</div>
                        <div style="font-size: 14px; font-weight: 700;">${formatarMoeda(dados.valor_desconto)}</div>
                    </div>
                    <div class="summary-item summary-net">
                        <div style="font-size: 10px; color: #64748b; font-weight: 600; margin-bottom: 4px;">VALOR LÍQUIDO</div>
                        <div style="font-size: 16px; font-weight: 700; color: #059669;">${formatarMoeda(dados.valor_liquido)}</div>
                    </div>
                </div>
                
                <div style="background: #fef3c7; border: 1px solid #d97706; border-radius: 6px; padding: 12px; text-align: center; margin: 16px 0;">
                    <strong>Margem Bruta consignável de 35%:</strong> R$ ${formatarMoeda(dados.margem_consignavel)}
                </div>
                
                <div style="background: #fef3c7; border: 1px solid #d97706; border-radius: 6px; padding: 12px; text-align: center;">
                    <div style="font-weight: 600; color: #d97706; margin-bottom: 8px;">MENSAGEM</div>
                    <div style="font-size: 10px; line-height: 1.4;">
                        <strong>Atenção beneficiário(a)!</strong><br>
                        Recadastramento no mês de seu aniversário.<br>
                        Aniversariantes do mês de <strong>JUNHO/${ano}</strong>, compareçam ao IPSEM.
                    </div>
                </div>
            </div>
        </div>`;
    });

    html += `
    <script>
        document.addEventListener('DOMContentLoaded', function() {
            console.log('✅ Total de contracheques carregados: ${contracheques.length}');
            console.log('🎨 Layout profissional aplicado');
            console.log('🖼️ Logos integradas');
        });
    </script>
</body>
</html>`;

    return html;
}

module.exports = { 
    gerarContracheques, 
    diagnosticarDados 
};tml(dados.cargo)}</div>
                                </div>
                            </div>
                            <div>
                                <div class="card-header" style="margin-bottom: 16px; margin-top: -20px; margin-left: -20px; margin-right: -20px; padding: 12px 20px;">
                                    <i class="fas fa-university"></i> Domicílio Bancário
                                </div>
                                <div class="info-field">
                                    <div class="field-label">Banco</div>
                                    <div class="field-value">${escapeHtml(dados.banco)}</div>
                                </div>
                                <div class="info-field">
                                    <div class="field-label">Conta Corrente</div>
                                    <div class="field-value">${escapeHtml(dados.conta)}</div>
                                </div>
                                <div class="info-field">
                                    <div class="field-label">Agência</div>
                                    <div class="field-value">${escapeHtml(dados.agencia)}</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="card">
                    <div class="card-header">
                        <i class="fas fa-calculator"></i> Demonstrativo de Valores
                    </div>
                    <div class="card-content">
                        <div class="values-grid">
                            <div class="values-section">
                                <div class="values-header credits-header">
                                    <i class="fas fa-plus-circle"></i> CRÉDITOS (${creditos.length} itens)
                                </div>
                                <div class="values-content">`;
        
        if (creditos.length === 0) {
            html += `
                                    <div class="value-item">
                                        <div class="value-description">Nenhum crédito encontrado</div>
                                        <div class="value-amount">0,00</div>
                                    </div>`;
        } else {
            creditos.forEach(credito => {
                html += `
                                    <div class="value-item">
                                        <div class="value-description">${escapeHtml(credito.descricao)}</div>
                                        <div class="value-amount">${credito.valor}</div>
                                    </div>`;
            });
        }
        
        html += `
                                </div>
                            </div>

                            <div class="values-section">
                                <div class="values-header debits-header">
                                    <i class="fas fa-minus-circle"></i> DÉBITOS (${debitos.length} itens)
                                </div>
                                <div class="values-content">`;
        
        if (debitos.length === 0) {
            html += `
                                    <div class="value-item">
                                        <div class="value-description">Nenhum débito encontrado</div>
                                        <div class="value-amount">0,00</div>
                                    </div>`;
        } else {
            debitos.forEach(debito => {
                html += `
                                    <div class="value-item">
                                        <div class="value-description">${escapeHtml(debito.descricao)}</div>
                                        <div class="value-amount">${debito.valor}</div>
                                    </div>`;
            });
        }
        
        html += `
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="card">
                    <div class="card-header">
                        <i class="fas fa-chart-line"></i> Resumo Financeiro
                    </div>
                    <div class="card-content">
                        <div class="summary-grid">
                            <div class="summary-item summary-gross">
                                <div class="summary-label">Valor Bruto</div>
                                <div class="summary-value">${formatarMoeda(dados.valor_bruto)}</div>
                            </div>
                            <div class="summary-item summary-discount">
                                <div class="summary-label">Valor Desconto</div>
                                <div class="summary-value">${formatarMoeda(dados.valor_desconto)}</div>
                            </div>
                            <div class="summary-item summary-net">
                                <div class="summary-label">Valor Líquido</div>
                                <div class="summary-value">${formatarMoeda(dados.valor_liquido)}</div>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="margin-info">
                    <i class="fas fa-info-circle"></i>
                    <strong>Margem Bruta consignável de 35%:</strong> R$ ${formatarMoeda(dados.margem_consignavel)}
                </div>

                <div class="message-section">
                    <div class="message-title">
                        <i class="fas fa-exclamation-triangle"></i>
                        MENSAGEM
                    </div>
                    <div class="message-content">
                        <strong>Atenção beneficiário(a)!</strong><br>
                        Recadastramento no mês de seu aniversário.<br>
                        Aniversariantes do mês de <strong>JUNHO/${ano}</strong>, compareçam ao IPSEM.
                    </div>
                </div>
            </div>
        </div>`;
    });

    html += `
    <script>
        document.addEventListener('DOMContentLoaded', function() {
            console.log('✅ Total de contracheques carregados: ${contracheques.length}');
            console.log('🎨 Layout profissional com cores minimalistas aplicado');
            console.log('🖼️ Logos IPSEM e PMCG integradas');
            console.log('📝 Fonte Noto Sans aplicada');
            console.log('🖨️ Layout otimizado para impressão');
        });
    </script>
</body>
</html>`;

    return html;
}

// Executar o gerador
if (require.main === module) {
    console.log('🚀 Iniciando gerador de contracheques IPSEM CORRIGIDO...');
    console.log('✨ Melhorias implementadas:');
    console.log('   🎨 Layout profissional com cores minimalistas');
    console.log('   🖼️ Logos IPSEM e PMCG integradas');
    console.log('   📝 Fonte Noto Sans');
    console.log('   🖨️ Layout idêntico entre HTML e PDF');
    console.log('   ✅ Eliminação de duplicações');
    console.log('   📊 Dados bancários corretos');
    
    // Verificar argumentos da linha de comando
    const args = process.argv.slice(2);
    const somenteHTML = args.includes('--html');
    
    if (somenteHTML) {
        console.log('🌐 Modo: Somente HTML');
        gerarContracheques().catch(console.error);
    } else {
        console.log('📄🌐 Modo: HTML (PDF em desenvolvimento)');
        gerarContracheques().catch(console.error);
    }
}

module.exports = { 
    gerarContracheques
};