const mysql = require('mysql2/promise');
const fs = require('fs').promises;
const path = require('path');

// Configurações do banco
const dbConfig = {
    host: 'localhost',
    port: 3307,
    user: 'root',
    password: 'senha123',
    database: 'espelho'
};

// Parâmetros
const MES = 5;
const ANO = 2025;

async function gerarContracheques() {
    let connection;
    
    try {
        console.log('🔌 Conectando ao banco de dados...');
        connection = await mysql.createConnection(dbConfig);
        console.log('✅ Conectado com sucesso!');
        
        const sql = `
            SELECT 
                f.MAT_WEB as matricula,
                f.NOME_WEB as nome,
                f.CPF_WEB as cpf,
                f.CARGO_WEB as cargo,
                ? as mes,
                ? as ano,
                COALESCE(c.BANCO, 'BRADESCO S/A') as banco,
                CASE WHEN c.AG > 0 THEN LPAD(c.AG, 4, '0') ELSE '0639' END as agencia,
                CASE WHEN c.CONTA != '000' THEN c.CONTA ELSE '0046513-5' END as conta,
                GROUP_CONCAT(
                    DISTINCT CASE WHEN v.CD = 'C' THEN 
                        CONCAT(v.TIPO, '|', FORMAT(CAST(REPLACE(v.VALOR, ',', '.') AS DECIMAL(10,2)), 2, 'de_DE'))
                    END 
                    ORDER BY v.ORDEM, v.TIPO
                    SEPARATOR ';;'
                ) as creditos_detalhes,
                GROUP_CONCAT(
                    DISTINCT CASE WHEN v.CD = 'D' THEN 
                        CONCAT(v.TIPO, '|', FORMAT(CAST(REPLACE(v.VALOR, ',', '.') AS DECIMAL(10,2)), 2, 'de_DE'))
                    END 
                    ORDER BY v.ORDEM, v.TIPO
                    SEPARATOR ';;'
                ) as debitos_detalhes,
                COALESCE(
                    (SELECT SUM(CAST(REPLACE(valor_unico.VALOR, ',', '.') AS DECIMAL(10,2)))
                     FROM (
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
                         WHERE v2.MAR = f.MAT_WEB AND v2.MES = ? AND v2.ANO = ? AND v2.CD = 'C'
                         AND v2.ORDEM NOT IN (40, 44, 223)
                     ) as valor_unico), 0
                ) as valor_bruto_consignavel,
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
            LIMIT 20
        `;
        
        console.log('📊 Executando consulta...');
        const [rows] = await connection.execute(sql, [MES, ANO, MES, ANO, MES, ANO, MES, ANO, MES, ANO]);
        
        console.log(`📋 Encontrados ${rows.length} contracheques`);
        
        if (rows.length === 0) {
            console.log('⚠️ Nenhum contracheque encontrado.');
            return;
        }
        
        const dadosProcessados = rows.map(row => ({
            ...row,
            valor_liquido: row.valor_bruto - row.valor_desconto,
            margem_consignavel: row.valor_bruto_consignavel * 0.35
        }));
        
        console.log('🎨 Gerando HTML...');
        const html = await gerarHTMLCompleto(dadosProcessados, MES, ANO);
        
        const nomeArquivo = `contracheques_corrigido_${MES}_${ANO}.html`;
        await fs.writeFile(nomeArquivo, html, 'utf8');
        
        const stats = await fs.stat(nomeArquivo);
        
        console.log('✅ Arquivo gerado com sucesso!');
        console.log(`📄 Nome: ${nomeArquivo}`);
        console.log(`📊 Total de páginas: ${dadosProcessados.length}`);
        console.log(`💾 Tamanho: ${formatBytes(stats.size)}`);
        
        const exemploContracheque = dadosProcessados[0];
        if (exemploContracheque) {
            console.log('\n📋 Exemplo de contracheque processado:');
            console.log('Matrícula:', exemploContracheque.matricula);
            console.log('Nome:', exemploContracheque.nome);
            console.log('Banco:', exemploContracheque.banco);
            console.log('Valor Bruto:', formatarMoeda(exemploContracheque.valor_bruto));
            console.log('Valor Líquido:', formatarMoeda(exemploContracheque.valor_liquido));
        }
        
    } catch (error) {
        console.error('❌ Erro:', error.message);
    } finally {
        if (connection) {
            await connection.end();
            console.log('🔌 Conexão fechada');
        }
    }
}

function processarValores(detalhesString) {
    if (!detalhesString) return [];
    
    const valoresUnicos = new Map();
    
    detalhesString.split(';;').forEach(item => {
        if (item && item.trim()) {
            const partes = item.split('|');
            if (partes.length >= 2) {
                const descricao = partes[0].trim();
                const valor = partes[1].trim();
                
                if (!valoresUnicos.has(descricao)) {
                    valoresUnicos.set(descricao, valor);
                }
            }
        }
    });
    
    return Array.from(valoresUnicos.entries()).map(([descricao, valor]) => ({
        descricao,
        valor
    }));
}

function formatarCPF(cpf) {
    if (!cpf) return '';
    const apenasNumeros = cpf.toString().replace(/\D/g, '');
    if (apenasNumeros.length === 11) {
        return `${apenasNumeros.substr(0,3)}.${apenasNumeros.substr(3,3)}.${apenasNumeros.substr(6,3)}-${apenasNumeros.substr(9,2)}`;
    }
    return cpf;
}

function formatarMoeda(valor) {
    if (!valor) return '0,00';
    return parseFloat(valor).toLocaleString('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function escapeHtml(text) {
    if (!text) return '';
    return text.toString()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

async function imagemParaBase64(caminhoImagem) {
    try {
        const buffer = await fs.readFile(caminhoImagem);
        const extensao = path.extname(caminhoImagem).toLowerCase();
        let mimeType = 'image/png';
        
        if (extensao === '.jpg' || extensao === '.jpeg') {
            mimeType = 'image/jpeg';
        }
        
        return `data:${mimeType};base64,${buffer.toString('base64')}`;
    } catch (error) {
        console.warn(`⚠️ Não foi possível carregar a imagem: ${caminhoImagem}`);
        return null;
    }
}

async function gerarContracheque(dados, mesNome, ano, index, logoIPSEM, logoPMCG) {
    const creditos = processarValores(dados.creditos_detalhes);
    const debitos = processarValores(dados.debitos_detalhes);
    
    const valorBruto = formatarMoeda(dados.valor_bruto);
    const valorDesconto = formatarMoeda(dados.valor_desconto);
    const valorLiquido = formatarMoeda(dados.valor_liquido);
    const margemConsignavel = formatarMoeda(dados.margem_consignavel);
    const cpf = formatarCPF(dados.cpf);
    
    const banco = dados.banco || 'BRADESCO S/A';
    const conta = dados.conta || '0046513-5';
    const agencia = dados.agencia || '0639';
    
    const pageBreakBefore = index > 0 ? 'page-break-before: always;' : '';
    
    let html = `
    <div id="contracheque-${index}" class="contracheque-container" style="${pageBreakBefore}">
        <!-- Header -->
        <div class="header-section">
            <div class="header-grid">
                <div class="logo-container">
                    ${logoPMCG ? `<img src="${logoPMCG}" alt="Prefeitura de Campina Grande" class="logo-img">` : '<i class="fas fa-building"></i>'}
                </div>
                <div class="institution-info">
                    <h1 class="institution-title">Instituto de Previdência Social dos Servidores Públicos Municipais de Campina Grande</h1>
                    <div class="institution-details">
                        Rua Maria Vieira César, 135 - Jardim Tavares - CEP: 58402-060<br>
                        Campina Grande - PB - Fone: (83) 3341-4242<br>
                        CNPJ: 41.434.426/0001-20
                    </div>
                </div>
                <div class="logo-container">
                    ${logoIPSEM ? `<img src="${logoIPSEM}" alt="IPSEM" class="logo-img">` : '<i class="fas fa-shield-alt"></i>'}
                </div>
            </div>
        </div>

        <!-- Title -->
        <div class="title-section">
            <i class="fas fa-calendar-alt"></i>
            Demonstrativo de Pagamento de ${mesNome} de ${ano}
        </div>

        <!-- Content -->
        <div class="content-wrapper">
            <!-- Beneficiary Information -->
            <div class="card">
                <div class="card-header">
                    <i class="fas fa-user"></i> Dados do Beneficiário
                </div>
                <div class="card-content">
                    <div class="beneficiary-grid">
                        <div>
                            <div class="info-field">
                                <div class="field-label">Nome do Beneficiário</div>
                                <div class="field-value">${escapeHtml(dados.nome)}</div>
                            </div>
                            <div class="info-field">
                                <div class="field-label">Matrícula</div>
                                <div class="field-value">${escapeHtml(dados.matricula)}</div>
                            </div>
                            <div class="info-field">
                                <div class="field-label">CPF</div>
                                <div class="field-value">${cpf}</div>
                            </div>
                            <div class="info-field">
                                <div class="field-label">Benefício</div>
                                <div class="field-value">${escapeHtml(dados.cargo)}</div>
                            </div>
                        </div>
                        <div>
                            <div class="card-header" style="margin-bottom: 16px; margin-top: -20px; margin-left: -20px; margin-right: -20px; padding: 12px 20px;">
                                <i class="fas fa-university"></i> Domicílio Bancário
                            </div>
                            <div class="info-field">
                                <div class="field-label">Banco</div>
                                <div class="field-value">${escapeHtml(banco)}</div>
                            </div>
                            <div class="info-field">
                                <div class="field-label">Conta Corrente</div>
                                <div class="field-value">${escapeHtml(conta)}</div>
                            </div>
                            ${agencia ? `
                            <div class="info-field">
                                <div class="field-label">Agência</div>
                                <div class="field-value">${escapeHtml(agencia)}</div>
                            </div>
                            ` : ''}
                        </div>
                    </div>
                </div>
            </div>

            <!-- Values Section -->
            <div class="card">
                <div class="card-header">
                    <i class="fas fa-calculator"></i> Demonstrativo de Valores
                </div>
                <div class="card-content">
                    <div class="values-grid">
                        <!-- Credits -->
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

                        <!-- Debits -->
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

            <!-- Summary -->
            <div class="card">
                <div class="card-header">
                    <i class="fas fa-chart-line"></i> Resumo Financeiro
                </div>
                <div class="card-content">
                    <div class="summary-grid">
                        <div class="summary-item summary-gross">
                            <div class="summary-label">Valor Bruto</div>
                            <div class="summary-value">${valorBruto}</div>
                        </div>
                        <div class="summary-item summary-discount">
                            <div class="summary-label">Valor Desconto</div>
                            <div class="summary-value">${valorDesconto}</div>
                        </div>
                        <div class="summary-item summary-net">
                            <div class="summary-label">Valor Líquido</div>
                            <div class="summary-value">${valorLiquido}</div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Margin Info -->
            <div class="margin-info">
                <i class="fas fa-info-circle"></i>
                <strong>Margem Bruta consignável de 35%:</strong> R$ ${margemConsignavel}
            </div>

            <!-- Message -->
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
    
    return html;
}

async function gerarHTMLCompleto(contracheques, mes, ano) {
    const mesesNomes = {
        1: 'Janeiro', 2: 'Fevereiro', 3: 'Março', 4: 'Abril',
        5: 'Maio', 6: 'Junho', 7: 'Julho', 8: 'Agosto',
        9: 'Setembro', 10: 'Outubro', 11: 'Novembro', 12: 'Dezembro'
    };
    
    const mesNome = mesesNomes[mes];
    
    // Carregar logos
    const logoIPSEM = await imagemParaBase64(path.join(__dirname, 'img', 'ipsem.png'));
    const logoPMCG = await imagemParaBase64(path.join(__dirname, 'img', 'pmcg.png'));
    
    let html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Contracheques Corrigidos - ${mesNome} de ${ano}</title>
    <link href="https://fonts.googleapis.com/css2?family=Noto+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
    <style>
        ${getCSS()}
    </style>
</head>
<body>`;

    // Índice navegável
    html += gerarIndice(contracheques, mesNome, ano);

    // Botões de controle
    html += `
    <div class="print-controls">
        <button class="print-button" onclick="window.print()" title="Imprimir Todos">
            <i class="fas fa-print"></i>
        </button>
        <button class="index-button" onclick="toggleIndex()" title="Mostrar/Ocultar Índice">
            <i class="fas fa-list"></i>
        </button>
    </div>`;

    // Gerar cada contracheque
    for (let index = 0; index < contracheques.length; index++) {
        html += await gerarContracheque(contracheques[index], mesNome, ano, index, logoIPSEM, logoPMCG);
    }

    html += `
    <script>
        let indexVisible = false;
        
        function toggleIndex() {
            const index = document.getElementById('contracheque-index');
            indexVisible = !indexVisible;
            index.style.display = indexVisible ? 'block' : 'none';
        }
        
        function scrollToContracheque(index) {
            const element = document.getElementById('contracheque-' + index);
            if (element) {
                element.scrollIntoView({ behavior: 'smooth' });
                toggleIndex();
            }
        }
        
        function filterIndex() {
            const searchTerm = document.getElementById('search-input').value.toLowerCase();
            const items = document.querySelectorAll('.index-item');
            
            items.forEach(item => {
                const name = item.dataset.name;
                const matricula = item.dataset.matricula;
                const matches = name.includes(searchTerm) || matricula.includes(searchTerm);
                item.style.display = matches ? 'block' : 'none';
            });
        }
        
        document.addEventListener('DOMContentLoaded', function() {
            console.log('✅ Total de contracheques carregados: ${contracheques.length}');
            console.log('🔧 Versão corrigida - layout de impressão mantido');
        });
    </script>
</body>
</html>`;

    return html;
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
        :root {
            --primary-color: #333333;
            --primary-light: rgba(51, 51, 51, 0.05);
            --primary-border: rgba(51, 51, 51, 0.2);
            --secondary-color: #666666;
            --text-dark: #2d3748;
            --text-gray: #4a5568;
            --border-light: #e2e8f0;
            --bg-gray: #f8f9fa;
            --shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
            --shadow-lg: 0 4px 8px rgba(0, 0, 0, 0.15);
            --accent-color: #007bff;
        }

        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: "Noto Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            background: white;
            line-height: 1.4;
            color: var(--text-dark);
            font-size: 14px;
        }

        .logo-img {
            max-width: 100%;
            max-height: 45px;
            object-fit: contain;
        }

        /* Índice navegável */
        .contracheque-index {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.9);
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
        }

        .close-index {
            background: none;
            border: none;
            color: white;
            font-size: 24px;
            cursor: pointer;
            padding: 10px;
            border-radius: 50%;
            transition: background 0.3s;
        }

        .close-index:hover {
            background: rgba(255, 255, 255, 0.2);
        }

        .index-content {
            padding: 20px;
            max-width: 1200px;
            margin: 0 auto;
        }

        .index-stats {
            display: flex;
            justify-content: center;
            gap: 30px;
            margin-bottom: 20px;
            flex-wrap: wrap;
        }

        .stat-item {
            background: white;
            padding: 15px 25px;
            border-radius: 8px;
            color: var(--text-dark);
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .index-search {
            margin-bottom: 20px;
            text-align: center;
        }

        .index-search input {
            width: 100%;
            max-width: 400px;
            padding: 15px;
            font-size: 16px;
            border: 2px solid var(--primary-color);
            border-radius: 25px;
            outline: none;
            text-align: center;
            font-family: "Noto Sans", sans-serif;
        }

        .index-list {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
            gap: 15px;
        }

        .index-item {
            background: white;
            border-radius: 8px;
            padding: 15px;
            cursor: pointer;
            transition: all 0.3s;
            border-left: 4px solid var(--primary-color);
        }

        .index-item:hover {
            transform: translateY(-2px);
            box-shadow: var(--shadow-lg);
        }

        .index-name strong {
            display: block;
            color: var(--text-dark);
            margin-bottom: 5px;
        }

        .index-name small {
            color: var(--text-gray);
            font-size: 12px;
        }

        /* Controles de impressão */
        .print-controls {
            position: fixed;
            bottom: 30px;
            right: 30px;
            display: flex;
            flex-direction: column;
            gap: 10px;
            z-index: 1000;
        }

        .print-button, .index-button {
            background: var(--primary-color);
            color: white;
            border: none;
            width: 60px;
            height: 60px;
            border-radius: 50%;
            font-size: 24px;
            cursor: pointer;
            box-shadow: var(--shadow-lg);
            transition: all 0.3s ease;
        }

        .print-button:hover, .index-button:hover {
            transform: scale(1.1);
            background: var(--secondary-color);
        }

        .contracheque-container {
            background: white;
            width: 100%;
            max-width: 800px;
            margin: 0 auto 40px auto;
            border: 2px solid var(--primary-color);
            position: relative;
            page-break-after: always;
            page-break-inside: avoid;
            font-size: 13px;
        }

        /* Header */
        .header-section {
            background: var(--bg-gray);
            border-bottom: 2px solid var(--primary-border);
            padding: 12px;
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
            height: 60px;
            background: white;
            border: 1px solid var(--primary-border);
            border-radius: 8px;
            padding: 8px;
        }

        .logo-container i {
            font-size: 20px;
            margin-bottom: 4px;
            color: var(--primary-color);
        }

        .institution-info {
            text-align: center;
        }

        .institution-title {
            font-size: 16px;
            font-weight: 700;
            color: var(--text-dark);
            margin-bottom: 8px;
            line-height: 1.2;
        }

        .institution-details {
            font-size: 12px;
            color: var(--text-gray);
            line-height: 1.3;
        }

        /* Title Section */
        .title-section {
            background: var(--primary-color);
            color: white;
            text-align: center;
            padding: 12px;
            font-size: 14px;
            font-weight: 600;
            letter-spacing: 0.5px;
        }

        .title-section i {
            margin-right: 8px;
        }

        /* Content Cards */
        .content-wrapper {
            padding: 16px;
            background: var(--bg-gray);
        }

        .card {
            background: white;
            border-radius: 8px;
            border: 1px solid var(--border-light);
            box-shadow: var(--shadow);
            margin-bottom: 12px;
            overflow: hidden;
        }

        .card-header {
            background: var(--primary-light);
            border-bottom: 1px solid var(--primary-border);
            padding: 12px 16px;
            font-weight: 600;
            color: var(--text-dark);
            font-size: 13px;
        }

        .card-header i {
            margin-right: 8px;
            color: var(--primary-color);
        }

        .card-content {
            padding: 16px;
        }

        /* Beneficiary Info */
        .beneficiary-grid {
            display: grid;
            grid-template-columns: 2fr 1fr;
            gap: 20px;
        }

        .info-field {
            margin-bottom: 12px;
        }

        .field-label {
            font-size: 11px;
            color: var(--text-gray);
            text-transform: uppercase;
            font-weight: 600;
            margin-bottom: 4px;
            letter-spacing: 0.5px;
        }

        .field-value {
            font-size: 13px;
            color: var(--text-dark);
            font-weight: 500;
            padding: 8px 12px;
            background: var(--bg-gray);
            border-radius: 4px;
            border-left: 3px solid var(--primary-color);
        }

        /* Values Section */
        .values-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
        }

        .values-section {
            background: white;
            border-radius: 8px;
            border: 1px solid var(--border-light);
            overflow: hidden;
        }

        .values-header {
            padding: 12px 16px;
            font-weight: 600;
            font-size: 13px;
            text-align: center;
            color: white;
        }

        .credits-header {
            background: #28a745;
        }

        .debits-header {
            background: #dc3545;
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
            font-size: 11px;
            color: var(--text-gray);
            flex: 1;
            margin-right: 8px;
        }

        .value-amount {
            font-size: 12px;
            font-weight: 600;
            color: var(--text-dark);
            background: var(--bg-gray);
            padding: 4px 8px;
            border-radius: 4px;
            min-width: 80px;
            text-align: right;
        }

        /* Summary Section */
        .summary-grid {
            display: grid;
            grid-template-columns: 1fr 1fr 1fr;
            gap: 16px;
        }

        .summary-item {
            text-align: center;
            padding: 12px;
            border-radius: 8px;
            border: 1px solid var(--border-light);
        }

        .summary-gross {
            background: #e3f2fd;
            border-color: #2196f3;
        }

        .summary-discount {
            background: #ffebee;
            border-color: #f44336;
        }

        .summary-net {
            background: #e8f5e8;
            border: 2px solid #4caf50;
        }

        .summary-label {
            font-size: 11px;
            color: var(--text-gray);
            font-weight: 600;
            margin-bottom: 4px;
            text-transform: uppercase;
            letter-spacing: 0.3px;
        }

        .summary-value {
            font-size: 16px;
            font-weight: 700;
            color: var(--text-dark);
        }

        .summary-net .summary-value {
            color: #2e7d32;
            font-size: 18px;
        }

        /* Message Section */
        .message-section {
            background: #fff3cd;
            border: 1px solid #ffeaa7;
            border-radius: 8px;
            padding: 12px;
            text-align: center;
        }

        .message-title {
            font-size: 12px;
            font-weight: 600;
            color: #856404;
            margin-bottom: 6px;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
        }

        .message-content {
            font-size: 11px;
            color: #856404;
            line-height: 1.4;
        }

        .margin-info {
            background: var(--primary-light);
            border: 1px solid var(--primary-border);
            border-radius: 8px;
            padding: 12px;
            text-align: center;
            font-size: 12px;
            color: var(--text-dark);
            margin-bottom: 12px;
        }

        .margin-info i {
            margin-right: 6px;
            color: var(--accent-color);
        }

        /* Print Styles - CRÍTICO para manter layout */
        @media print {
            * {
                -webkit-print-color-adjust: exact !important;
                color-adjust: exact !important;
                print-color-adjust: exact !important;
            }

            body {
                background: white !important;
                margin: 0 !important;
                padding: 0 !important;
                font-size: 12px !important;
            }

            .print-controls, 
            .contracheque-index {
                display: none !important;
            }

            .contracheque-container {
                box-shadow: none !important;
                border-radius: 0 !important;
                margin: 0 !important;
                max-width: none !important;
                width: 100% !important;
                page-break-after: always !important;
                page-break-inside: avoid !important;
                border: 2px solid var(--primary-color) !important;
                background: white !important;
                transform: none !important;
            }

            .header-section {
                background: var(--bg-gray) !important;
                border-bottom: 2px solid var(--primary-border) !important;
            }

            .title-section {
                background: var(--primary-color) !important;
                color: white !important;
            }

            .card {
                background: white !important;
                border: 1px solid var(--border-light) !important;
                box-shadow: none !important;
            }

            .card-header {
                background: var(--primary-light) !important;
                border-bottom: 1px solid var(--primary-border) !important;
            }

            .field-value {
                background: var(--bg-gray) !important;
                border-left: 3px solid var(--primary-color) !important;
            }

            .values-header {
                color: white !important;
            }

            .credits-header {
                background: #28a745 !important;
            }

            .debits-header {
                background: #dc3545 !important;
            }

            .summary-gross {
                background: #e3f2fd !important;
                border-color: #2196f3 !important;
            }

            .summary-discount {
                background: #ffebee !important;
                border-color: #f44336 !important;
            }

            .summary-net {
                background: #e8f5e8 !important;
                border: 2px solid #4caf50 !important;
            }

            .message-section {
                background: #fff3cd !important;
                border: 1px solid #ffeaa7 !important;
            }

            .margin-info {
                background: var(--primary-light) !important;
                border: 1px solid var(--primary-border) !important;
            }

            @page {
                size: A4 portrait;
                margin: 1cm;
            }
        }

        /* Responsive Design */
        @media (max-width: 768px) {
            .header-grid {
                grid-template-columns: 80px 1fr 80px;
                gap: 12px;
            }

            .logo-container {
                height: 50px;
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
    `;
}

// Executar o gerador
if (require.main === module) {
    console.log('🚀 Iniciando gerador de contracheques MELHORADO...');
    console.log('📝 Melhorias implementadas:');
    console.log('   ✅ Layout de impressão consistente com HTML');
    console.log('   ✅ Cores minimalistas e profissionais');
    console.log('   ✅ Fonte Noto Sans implementada');
    console.log('   ✅ Logos IPSEM e Prefeitura adicionadas');
    console.log('   ✅ Estilos de impressão aprimorados');
    
    gerarContracheques().catch(console.error);
}

module.exports = { 
    gerarContracheques,
    gerarHTMLCompleto,
    imagemParaBase64
};
