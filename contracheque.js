const mysql = require('mysql2/promise');
const fs = require('fs').promises;
const puppeteer = require('puppeteer');

// Configurações do banco
const dbConfig = {
    host: 'localhost',
    port: 3307,
    user: 'root',
    password: 'senha123',
    database: 'espelho'
};

// Parâmetros
const MES = 5; // Maio
const ANO = 2025;

async function gerarContracheques() {
    let connection;
    
    try {
        console.log('🔌 Conectando ao banco de dados...');
        connection = await mysql.createConnection(dbConfig);
        console.log('✅ Conectado com sucesso!');
        
        // Usar abordagem mais simples baseada no sistema antigo PHP
        const sql = `
            SELECT DISTINCT f.MAT_WEB as matricula, f.NOME_WEB as nome, f.CPF_WEB as cpf, f.CARGO_WEB as cargo
            FROM folweb f 
            INNER JOIN gsd876f_valores v ON f.MAT_WEB = v.MAR 
            WHERE v.MES = ? AND v.ANO = ?
            ORDER BY f.NOME_WEB
            LIMIT 100
        `;
        
        console.log('📊 Executando consulta para buscar funcionários...');
        console.log('🔍 Parâmetros:', {MES, ANO});
        const [funcionarios] = await connection.execute(sql, [MES, ANO]);
        
        console.log(`👥 Encontrados ${funcionarios.length} funcionários com dados`);
        
        if (funcionarios.length === 0) {
            console.log('⚠️ Nenhum funcionário encontrado. Tentando consulta de diagnóstico...');
            await diagnosticarDados(connection, MES, ANO);
            return;
        }
        
        console.log('💰 Processando dados de cada funcionário...');
        const dadosProcessados = [];
        
        for (let i = 0; i < funcionarios.length; i++) {
            const funcionario = funcionarios[i];
            console.log(`Processando ${i + 1}/${funcionarios.length}: ${funcionario.nome}`);
            
            // Buscar dados bancários
            const [bancarios] = await connection.execute(
                'SELECT BANCO, AG, CONTA FROM gsd876f_cadastros WHERE MAR = ? LIMIT 1',
                [funcionario.matricula]
            );
            
            // Buscar créditos
            const [creditos] = await connection.execute(
                'SELECT TIPO, VALOR FROM gsd876f_valores WHERE MAR = ? AND MES = ? AND ANO = ? AND CD = "C" ORDER BY ORDEM',
                [funcionario.matricula, MES, ANO]
            );
            
            // Buscar débitos  
            const [debitos] = await connection.execute(
                'SELECT TIPO, VALOR FROM gsd876f_valores WHERE MAR = ? AND MES = ? AND ANO = ? AND CD = "D" ORDER BY ORDEM',
                [funcionario.matricula, MES, ANO]
            );
            
            // Calcular totais
            const valor_bruto = creditos.reduce((sum, c) => sum + parseFloat(c.VALOR.replace(',', '.')), 0);
            const valor_desconto = debitos.reduce((sum, d) => sum + parseFloat(d.VALOR.replace(',', '.')), 0);
            const valor_liquido = valor_bruto - valor_desconto;
            
            // Formatar detalhes
            const creditosDetalhes = creditos.map(c => 
                `${c.TIPO}|${formatarMoeda(parseFloat(c.VALOR.replace(',', '.')))}`
            ).join(';;');
            
            const debitosDetalhes = debitos.map(d => 
                `${d.TIPO}|${formatarMoeda(parseFloat(d.VALOR.replace(',', '.')))}`
            ).join(';;');
            
            // Dados bancários
            const banco = bancarios.length > 0 ? bancarios[0].BANCO || 'BRADESCO S/A' : 'BRADESCO S/A';
            const agencia = bancarios.length > 0 && bancarios[0].AG ? String(bancarios[0].AG).padStart(4, '0') : '';
            const conta = bancarios.length > 0 && bancarios[0].CONTA !== '000' ? bancarios[0].CONTA : '';
            
            dadosProcessados.push({
                matricula: funcionario.matricula,
                nome: funcionario.nome,
                cpf: funcionario.cpf,
                cargo: funcionario.cargo,
                mes: MES,
                ano: ANO,
                banco: banco,
                agencia: agencia,
                conta: conta,
                creditos_detalhes: creditosDetalhes,
                debitos_detalhes: debitosDetalhes,
                valor_bruto: valor_bruto,
                valor_desconto: valor_desconto,
                valor_liquido: valor_liquido,
                valor_bruto_margem: valor_bruto,
                margem_consignavel: valor_bruto * 0.35
            });
        }
        
        // Gerar HTML
        console.log('🎨 Gerando HTML...');
        const html = gerarHTMLCompleto(dadosProcessados, MES, ANO);
        
        // Salvar arquivo
        const nomeArquivo = `contracheques_corrigido_${MES}_${ANO}.html`;
        await fs.writeFile(nomeArquivo, html, 'utf8');
        
        const stats = await fs.stat(nomeArquivo);
        
        console.log('✅ Arquivo gerado com sucesso!');
        console.log(`📄 Nome: ${nomeArquivo}`);
        console.log(`📊 Total de páginas: ${dadosProcessados.length}`);
        console.log(`💾 Tamanho: ${formatBytes(stats.size)}`);
        
        // Verificar um contracheque específico para debug
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
            console.log('Créditos:', exemploContracheque.creditos_detalhes ? 
                exemploContracheque.creditos_detalhes.split(';;').length : 0, 'itens');
            console.log('Débitos:', exemploContracheque.debitos_detalhes ? 
                exemploContracheque.debitos_detalhes.split(';;').length : 0, 'itens');
        }
        
    } catch (error) {
        console.error('❌ Erro:', error.message);
        console.error('Stack:', error.stack);
    } finally {
        if (connection) {
            await connection.end();
            console.log('🔌 Conexão fechada');
        }
    }
}

// Consulta alternativa ainda mais robusta (para casos extremos)
async function gerarContrachequesAlternativo() {
    let connection;
    
    try {
        connection = await mysql.createConnection(dbConfig);
        
        // Primeiro, buscar todos os beneficiários
        const [beneficiarios] = await connection.execute(`
            SELECT DISTINCT f.MAT_WEB, f.NOME_WEB, f.CPF_WEB, f.CARGO_WEB
            FROM folweb f 
            WHERE f.MAT_WEB IN (
                SELECT DISTINCT MAR 
                FROM gsd876f_valores 
                WHERE MES = ? AND ANO = ?
            )
            ORDER BY f.NOME_WEB
            LIMIT 20
        `, [MES, ANO]);
        
        console.log(`📋 Processando ${beneficiarios.length} beneficiários...`);
        
        const contracheques = [];
        
        // Processar cada beneficiário individualmente
        for (const beneficiario of beneficiarios) {
            const matricula = beneficiario.MAT_WEB;
            
            // Buscar créditos únicos
            const [creditos] = await connection.execute(`
                SELECT DISTINCT TIPO, VALOR
                FROM gsd876f_valores 
                WHERE MAR = ? AND MES = ? AND ANO = ? AND CD = 'C'
                ORDER BY ORDEM
            `, [matricula, MES, ANO]);
            
            // Buscar débitos únicos
            const [debitos] = await connection.execute(`
                SELECT DISTINCT TIPO, VALOR
                FROM gsd876f_valores 
                WHERE MAR = ? AND MES = ? AND ANO = ? AND CD = 'D'
                ORDER BY ORDEM
            `, [matricula, MES, ANO]);
            
            // Buscar créditos para margem (excluindo códigos 40, 44 e 223)
            const [creditosMargem] = await connection.execute(`
                SELECT DISTINCT TIPO, VALOR
                FROM gsd876f_valores 
                WHERE MAR = ? AND MES = ? AND ANO = ? AND CD = 'C' AND ORDEM NOT IN (40, 44, 223)
                ORDER BY ORDEM
            `, [matricula, MES, ANO]);
            
            // Calcular totais
            const valorBruto = creditos.reduce((sum, c) => 
                sum + parseFloat(c.VALOR.replace(',', '.')), 0);
            const valorBrutoMargem = creditosMargem.reduce((sum, c) => 
                sum + parseFloat(c.VALOR.replace(',', '.')), 0);
            const valorDesconto = debitos.reduce((sum, d) => 
                sum + parseFloat(d.VALOR.replace(',', '.')), 0);
            const valorLiquido = valorBruto - valorDesconto;
            
            // Formatar detalhes
            const creditosDetalhes = creditos.map(c => 
                `${c.TIPO}|${formatarMoeda(parseFloat(c.VALOR.replace(',', '.')))}`
            ).join(';;');
            
            const debitosDetalhes = debitos.map(d => 
                `${d.TIPO}|${formatarMoeda(parseFloat(d.VALOR.replace(',', '.')))}`
            ).join(';;');
            
            contracheques.push({
                matricula: beneficiario.MAT_WEB,
                nome: beneficiario.NOME_WEB,
                cpf: beneficiario.CPF_WEB,
                cargo: beneficiario.CARGO_WEB,
                mes: MES,
                ano: ANO,
                banco: 'BRADESCO S/A',
                agencia: '',
                conta: '',
                creditos_detalhes: creditosDetalhes,
                debitos_detalhes: debitosDetalhes,
                valor_bruto: valorBruto,
                valor_desconto: valorDesconto,
                valor_liquido: valorLiquido,
                valor_bruto_margem: valorBrutoMargem,
                margem_consignavel: valorBrutoMargem * 0.35
            });
            
            // Log de progresso
            if (contracheques.length % 10 === 0) {
                console.log(`Processados ${contracheques.length}/${beneficiarios.length} contracheques...`);
            }
        }
        
        // Gerar HTML
        const html = gerarHTMLCompleto(contracheques, MES, ANO);
        const nomeArquivo = `contracheques_alternativo_${MES}_${ANO}.html`;
        await fs.writeFile(nomeArquivo, html, 'utf8');
        
        console.log(`✅ Método alternativo: ${nomeArquivo} gerado com sucesso!`);
        
        return contracheques;
        
    } catch (error) {
        console.error('❌ Erro no método alternativo:', error.message);
    } finally {
        if (connection) {
            await connection.end();
        }
    }
}

async function diagnosticarDados(connection, mes, ano) {
    try {
        console.log('\n🔍 Executando diagnóstico...');
        
        // Verificar duplicações na tabela
        const [duplicacoes] = await connection.execute(`
            SELECT MAR, TIPO, CD, COUNT(*) as duplicatas
            FROM gsd876f_valores 
            WHERE MES = ? AND ANO = ?
            GROUP BY MAR, TIPO, CD
            HAVING COUNT(*) > 1
            ORDER BY duplicatas DESC
            LIMIT 10
        `, [mes, ano]);
        
        console.log('🔍 Registros duplicados encontrados:', duplicacoes.length);
        duplicacoes.forEach(d => {
            console.log(`  - Matrícula ${d.MAR}, ${d.TIPO} (${d.CD}): ${d.duplicatas} registros`);
        });
        
        // Verificar estrutura da tabela
        const [estrutura] = await connection.execute(`
            SELECT COLUMN_NAME, DATA_TYPE 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_SCHEMA = 'espelho' AND TABLE_NAME = 'gsd876f_valores'
        `);
        
        console.log('\n📋 Estrutura da tabela gsd876f_valores:');
        estrutura.forEach(col => {
            console.log(`  - ${col.COLUMN_NAME}: ${col.DATA_TYPE}`);
        });
        
        // Verificar dados de exemplo
        const [exemplo] = await connection.execute(`
            SELECT * FROM gsd876f_valores 
            WHERE MES = ? AND ANO = ?
            LIMIT 5
        `, [mes, ano]);
        
        console.log('\n📊 Registros de exemplo:');
        exemplo.forEach(reg => {
            console.log(`  - ${reg.MAR}: ${reg.TIPO} = ${reg.VALOR} (${reg.CD})`);
        });
        
    } catch (error) {
        console.error('❌ Erro no diagnóstico:', error.message);
    }
}

// Função melhorada para processar créditos/débitos sem duplicação
function processarValores(detalhesString) {
    if (!detalhesString) return [];
    
    const valoresUnicos = new Map();
    
    detalhesString.split(';;').forEach(item => {
        if (item && item.trim()) {
            const partes = item.split('|');
            if (partes.length >= 2) {
                const descricao = partes[0].trim();
                const valor = partes[1].trim();
                
                // Usar Map para garantir que não há duplicatas
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

function gerarContracheque(dados, mesNome, ano, index) {
    // Usar a função melhorada para processar valores
    const creditos = processarValores(dados.creditos_detalhes);
    const debitos = processarValores(dados.debitos_detalhes);
    
    const valorBruto = formatarMoeda(dados.valor_bruto);
    const valorDesconto = formatarMoeda(dados.valor_desconto);
    const valorLiquido = formatarMoeda(dados.valor_liquido);
    const margemConsignavel = formatarMoeda(dados.margem_consignavel);
    const cpf = formatarCPF(dados.cpf);
    
    const banco = dados.banco || 'BRADESCO S/A';
    const conta = dados.conta || '00118540';
    const agencia = dados.agencia || '';
    
    const pageBreakBefore = index > 0 ? 'page-break-before: always;' : '';
    
    let html = `
    <div id="contracheque-${index}" class="contracheque-container" style="${pageBreakBefore}">
        <!-- Header -->
        <div class="header-section">
            <div class="header-grid">
                <div class="logo-container">
                    <img src="img/pmcg.png" alt="PMCG" style="max-width: 85px; max-height: 55px; object-fit: contain;">
                </div>
                <div class="institution-info">
                    <h1 class="institution-title">Instituto de Previdência Social dos Servidores Públicos</h1><h1 class="institution-title">Municipais de Campina Grande</h1>
                    <div class="institution-details">
                        Rua Maria Vieira César, 135 - Jardim Tavares - CEP: 58402-060<br>
                        Campina Grande - PB - Fone: (83) 3341-4242<br>
                        CNPJ: 41.434.426/0001-20
                    </div>
                </div>
                <div class="logo-container">
                    <img src="img/ipsem.png" alt="IPSEM" style="max-width: 85px; max-height: 70px; object-fit: contain;">
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
            <!-- Beneficiary and Banking Information Side by Side -->
            <div class="beneficiary-banking-grid">
                <!-- Beneficiary Information -->
                <div class="card">
                    <div class="card-header">
                        <i class="fas fa-user"></i> Dados do Beneficiário
                    </div>
                    <div class="card-content">
                        <div class="beneficiary-single">
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
                    </div>
                </div>

                <!-- Banking Information -->
                <div class="card">
                    <div class="card-header">
                        <i class="fas fa-university"></i> Domicílio Bancário
                    </div>
                    <div class="card-content">
                        <div class="beneficiary-single">
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

function escapeHtml(text) {
    if (!text) return '';
    return text.toString()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function gerarHTMLCompleto(contracheques, mes, ano) {
    const mesesNomes = {
        1: 'Janeiro', 2: 'Fevereiro', 3: 'Março', 4: 'Abril',
        5: 'Maio', 6: 'Junho', 7: 'Julho', 8: 'Agosto',
        9: 'Setembro', 10: 'Outubro', 11: 'Novembro', 12: 'Dezembro'
    };
    
    const mesNome = mesesNomes[mes];
    
    let html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Contracheques Corrigidos - ${mesNome} de ${ano}</title>
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
    <link href="https://fonts.googleapis.com/css2?family=Noto+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400&display=swap" rel="stylesheet">
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
    contracheques.forEach((dados, index) => {
        html += gerarContracheque(dados, mesNome, ano, index);
    });

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
            console.log('🔧 Versão corrigida - sem duplicações');
        });
    </script>
</body>
</html>`;

    return html;
}

// Função para gerar PDF usando Puppeteer
async function gerarPDF(htmlContent, nomeArquivo, opcoes = {}) {
    let browser;
    
    try {
        console.log('🔄 Iniciando geração de PDF...');
        
        browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        
        const page = await browser.newPage();
        
        // Configurar viewport para melhor renderização
        await page.setViewport({ width: 1200, height: 1600 });
        
        // Carregar o HTML
        await page.setContent(htmlContent, { 
            waitUntil: 'networkidle0',
            timeout: 30000 
        });
        
        // Configurações padrão do PDF
        const pdfOptions = {
            format: 'A4',
            printBackground: true,
            margin: {
                top: '0.8cm',
                right: '0.8cm',
                bottom: '0.8cm',
                left: '0.8cm'
            },
            preferCSSPageSize: true,
            ...opcoes
        };
        
        // Gerar PDF
        const nomeArquivoPDF = nomeArquivo.replace('.html', '.pdf');
        await page.pdf({ path: nomeArquivoPDF, ...pdfOptions });
        
        console.log('✅ PDF gerado com sucesso!');
        console.log(`📄 Nome: ${nomeArquivoPDF}`);
        
        // Verificar tamanho do arquivo
        const stats = await fs.stat(nomeArquivoPDF);
        console.log(`💾 Tamanho: ${formatBytes(stats.size)}`);
        
        return nomeArquivoPDF;
        
    } catch (error) {
        console.error('❌ Erro ao gerar PDF:', error.message);
        throw error;
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

// Função para gerar contracheques com opção HTML e/ou PDF
async function gerarContrachequesComPDF(gerarHTML = true, gerarPDFTambem = true) {
    let connection;
    
    try {
        console.log('🚀 Iniciando gerador de contracheques (HTML + PDF)...');
        
        connection = await mysql.createConnection(dbConfig);
        console.log('✅ Conectado com sucesso!');
        
        // CONSULTA CORRIGIDA - mesma do método principal
        const sql = `
            SELECT 
                f.MAT_WEB as matricula,
                f.NOME_WEB as nome,
                f.CPF_WEB as cpf,
                f.CARGO_WEB as cargo,
                ? as mes,
                ? as ano,
                
                -- Dados bancários da tabela gsd876f_cadastros
                COALESCE((SELECT BANCO FROM gsd876f_cadastros WHERE MAR = f.MAT_WEB LIMIT 1), 'BRADESCO S/A') as banco,
                COALESCE((SELECT CASE WHEN AG > 0 THEN LPAD(AG, 4, '0') ELSE '' END FROM gsd876f_cadastros WHERE MAR = f.MAT_WEB LIMIT 1), '') as agencia,
                COALESCE((SELECT CASE WHEN CONTA != '000' THEN CONTA ELSE '' END FROM gsd876f_cadastros WHERE MAR = f.MAT_WEB LIMIT 1), '') as conta,
                
                -- Créditos detalhados SEM duplicação - usando DISTINCT
                GROUP_CONCAT(
                    DISTINCT CASE WHEN v.CD = 'C' THEN 
                        CONCAT(v.TIPO, '|', FORMAT(CAST(REPLACE(v.VALOR, ',', '.') AS DECIMAL(10,2)), 2, 'de_DE'))
                    END 
                    ORDER BY v.TIPO, v.ORDEM
                    SEPARATOR ';;'
                ) as creditos_detalhes,
                
                -- Débitos detalhados SEM duplicação - usando DISTINCT
                GROUP_CONCAT(
                    DISTINCT CASE WHEN v.CD = 'D' THEN 
                        CONCAT(v.TIPO, '|', FORMAT(CAST(REPLACE(v.VALOR, ',', '.') AS DECIMAL(10,2)), 2, 'de_DE'))
                    END 
                    ORDER BY v.TIPO, v.ORDEM
                    SEPARATOR ';;'
                ) as debitos_detalhes,
                
                -- Totais calculados corretamente - somando apenas valores únicos
                COALESCE(
                    (SELECT SUM(CAST(REPLACE(valor_unico.VALOR, ',', '.') AS DECIMAL(10,2)))
                     FROM (
                         SELECT DISTINCT v2.TIPO, v2.VALOR
                         FROM gsd876f_valores v2 
                         WHERE v2.MAR = f.MAT_WEB AND v2.MES = ? AND v2.ANO = ? AND v2.CD = 'C'
                     ) as valor_unico), 0
                ) as valor_bruto,
                
                -- Valor bruto para margem consignável (excluindo códigos 40, 44 e 223)
                COALESCE(
                    (SELECT SUM(CAST(REPLACE(valor_unico.VALOR, ',', '.') AS DECIMAL(10,2)))
                     FROM (
                         SELECT DISTINCT v2.TIPO, v2.VALOR
                         FROM gsd876f_valores v2 
                         WHERE v2.MAR = f.MAT_WEB AND v2.MES = ? AND v2.ANO = ? AND v2.CD = 'C'
                           AND v2.ORDEM NOT IN (40, 44, 223)
                     ) as valor_unico), 0
                ) as valor_bruto_margem,
                
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
            WHERE v.MAR IS NOT NULL
            GROUP BY f.MAT_WEB, f.NOME_WEB, f.CPF_WEB, f.CARGO_WEB
            HAVING valor_bruto > 0 OR valor_desconto > 0
            ORDER BY f.NOME_WEB
            LIMIT 100
        `;
        
        console.log('📊 Executando consulta...');
        const [rows] = await connection.execute(sql, [MES, ANO, MES, ANO, MES, ANO, MES, ANO, MES, ANO, MES, ANO]);
        
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
            const html = gerarHTMLCompleto(dadosProcessados, MES, ANO);
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
                var html = gerarHTMLCompleto(dadosProcessados, MES, ANO);
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
            <h2><i class="fas fa-list"></i> Índice de Contracheques - ${mesNome}/${ano} (CORRIGIDO)</h2>
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
                    ✅ Sem duplicações
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
            --primary-color: #01a652;
            --primary-light: rgba(1, 166, 82, 0.1);
            --primary-border: rgba(1, 166, 82, 0.35);
            --secondary-color: #2c5aa0;
            --text-dark: #2d3748;
            --text-gray: #4a5568;
            --border-light: #e2e8f0;
            --bg-gray: #f7fafc;
            --shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
            --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
        }

        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: "Noto Sans", "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
            background: white;
            line-height: 1.4;
            color: var(--text-dark);
            padding: 25px;
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
            background: linear-gradient(135deg, var(--primary-color), #00d084);
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
        }

        .contracheque-container {
            background: white;
            width: 100%;
            max-width: 800px;
            margin: 0 auto 40px auto;
            
            position: relative;
            max-height: 297mm;
            height: auto;
            page-break-after: always;
            page-break-inside: avoid;
            
        }

        .contracheque-container::before {
            content: "";
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 4px;
            background: linear-gradient(90deg, var(--primary-color), var(--secondary-color));
        }

        /* Header */
        .header-section {
            background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
            border-bottom: 2px solid var(--primary-border);
            padding: 8px;
        }

        .header-grid {
            display: grid;
            grid-template-columns: 80px 1fr 80px;
            gap: 8px;
            align-items: center;
        }

        .logo-container {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 50px;
            
            
            
            color: var(--text-gray);
            font-size: 8px;
            text-align: center;
        }

        .logo-container i {
            font-size: 16px;
            margin-bottom: 2px;
            color: var(--primary-color);
        }

        .institution-info {
            text-align: center;
        }

        .institution-title {
            font-size: 13px;
            font-weight: 700;
            color: var(--text-dark);
            margin-bottom: 3px;
            line-height: 1.1;
        }

        .institution-details {
            font-size: 8px;
            color: var(--text-gray);
            line-height: 1.2;
        }

        /* Title Section */
        .title-section {
            background: linear-gradient(135deg, var(--primary-color), #00d084);
            color: white;
            text-align: center;
            padding: 8px;
            font-size: 12px;
            font-weight: 600;
            letter-spacing: 0.3px;
        }

        /* Content Cards */
        .content-wrapper {
            padding: 8px;
            background: var(--bg-gray);
        }

        .card {
            background: white;
            border-radius: 4px;
            border: 1px solid var(--primary-border);
            box-shadow: var(--shadow);
            margin-bottom: 6px;
            overflow: hidden;
            opacity: 1;
            transform: translateY(0);
            transition: all 0.5s ease;
        }

        .card-header {
            background: var(--primary-light);
            border-bottom: 1px solid var(--primary-border);
            padding: 6px 12px;
            font-weight: 600;
            color: var(--text-dark);
            font-size: 11px;
        }

        .card-content {
            padding: 8px;
        }

        /* Beneficiary and Banking Side by Side */
        .beneficiary-banking-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px;
            margin-bottom: 6px;
        }
        
        /* Beneficiary Info */
        .beneficiary-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px;
        }
        
        .beneficiary-single {
            display: block;
        }

        .info-field {
            margin-bottom: 6px;
        }

        .field-label {
            font-size: 9px;
            color: var(--text-gray);
            text-transform: uppercase;
            font-weight: 600;
            margin-bottom: 3px;
            letter-spacing: 0.3px;
        }

        .field-value {
            font-size: 11px;
            color: var(--text-dark);
            font-weight: 500;
            padding: 4px 8px;
            background: var(--bg-gray);
            border-radius: 3px;
            border-left: 2px solid var(--primary-color);
        }

        /* Values Section */
        .values-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 12px;
            width: 100%;
            box-sizing: border-box;
        }

        .values-section {
            background: white;
            border-radius: 8px;
            border: 1px solid var(--border-light);
            overflow: hidden;
            min-height: 150px;
            display: flex;
            flex-direction: column;
        }

        .values-header {
            padding: 12px 16px;
            font-weight: 600;
            font-size: 14px;
            text-align: center;
            color: white;
        }

        .credits-header {
            background: linear-gradient(135deg, #48bb78, #38a169);
        }

        .debits-header {
            background: linear-gradient(135deg, #f56565, #e53e3e);
        }

        .values-content {
            padding: 6px;
            flex: 1;
            min-height: 80px;
            height: auto;
            overflow-y: visible;
        }

        .value-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 4px 0;
            border-bottom: 1px solid var(--border-light);
        }

        .value-item:last-child {
            border-bottom: none;
        }

        .value-description {
            font-size: 9px;
            color: var(--text-gray);
            flex: 1;
            margin-right: 6px;
        }

        .value-amount {
            font-size: 10px;
            font-weight: 600;
            color: var(--text-dark);
            background: var(--bg-gray);
            padding: 3px 6px;
            border-radius: 3px;
            min-width: 70px;
            text-align: right;
        }

        /* Summary Section */
        .summary-grid {
            display: grid;
            grid-template-columns: 1fr 1fr 1fr;
            gap: 8px;
            width: 100%;
            box-sizing: border-box;
        }

        .summary-item {
            text-align: center;
            padding: 8px;
            border-radius: 4px;
            border: 1px solid var(--border-light);
            min-width: 0;
            box-sizing: border-box;
        }

        .summary-gross {
            background: linear-gradient(135deg, #bee3f8, #90cdf4);
        }

        .summary-discount {
            background: linear-gradient(135deg, #fed7d7, #feb2b2);
        }

        .summary-net {
            background: linear-gradient(135deg, #c6f6d5, #9ae6b4);
            border: 2px solid var(--primary-color);
        }

        .summary-label {
            font-size: 8px;
            color: var(--text-gray);
            font-weight: 600;
            margin-bottom: 2px;
            text-transform: uppercase;
            letter-spacing: 0.2px;
        }

        .summary-value {
            font-size: 12px;
            font-weight: 700;
            color: var(--text-dark);
        }

        .summary-net .summary-value {
            color: var(--primary-color);
            font-size: 14px;
        }

        /* Message Section */
        .message-section {
            background: linear-gradient(135deg, #fef5e7, #fed7aa);
            border: 1px solid #f6ad55;
            border-radius: 4px;
            padding: 6px;
            text-align: center;
        }

        .message-title {
            font-size: 10px;
            font-weight: 600;
            color: #c05621;
            margin-bottom: 3px;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 4px;
        }

        .message-content {
            font-size: 8px;
            color: #744210;
            line-height: 1.3;
        }

        .margin-info {
            background: var(--primary-light);
            border: 1px solid var(--primary-border);
            border-radius: 4px;
            padding: 4px;
            text-align: center;
            font-size: 9px;
            color: var(--text-dark);
            margin-bottom: 4px;
        }

        /* Print Styles - Mantém layout original */
        @media print {
            body {
                background: white;
                margin: 0;
                padding: 0;
            }

            .print-controls, .contracheque-index {
                display: none !important;
            }

            .contracheque-container {
                box-shadow: none;
                border-radius: 0;
                margin: 0 auto 0 auto;
                max-width: none;
                width: 100%;
                page-break-after: always;
                page-break-inside: avoid;
                
                background: white;
                transform: scale(0.95);
                transform-origin: top center;
                
            }

            .beneficiary-banking-grid {
                display: grid !important;
                grid-template-columns: 1fr 1fr !important;
                page-break-inside: avoid;
            }

            .beneficiary-banking-grid > div,
            .values-grid > div {
                page-break-inside: avoid;
                break-inside: avoid;
            }

            .values-grid,
            .summary-grid {
                display: grid !important;
                grid-template-columns: 1fr 1fr !important;
                page-break-inside: avoid;
            }

            .summary-grid {
                grid-template-columns: 1fr 1fr 1fr !important;
            }

            .values-grid > div,
            .summary-grid > div {
                page-break-inside: avoid;
                break-inside: avoid;
            }

            .contracheque-container::before {
                content: "";
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                height: 4px;
                background: linear-gradient(90deg, var(--primary-color), var(--secondary-color));
            }

            @page {
                size: A4 portrait;
                margin: 0.8cm;
            }
        }

        /* Responsive Design */
        @media (max-width: 768px) {
            .header-grid {
                grid-template-columns: 80px 1fr 80px;
                gap: 16px;
            }

            .logo-container {
                height: 80px;
            }

            .institution-title {
                font-size: 16px;
            }

            .beneficiary-banking-grid {
                grid-template-columns: 1fr;
                gap: 8px;
            }

            .beneficiary-grid {
                grid-template-columns: 1fr;
                gap: 16px;
            }

            .values-grid {
                grid-template-columns: 1fr;
                gap: 12px;
            }

            .summary-grid {
                grid-template-columns: 1fr;
                gap: 8px;
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
    console.log('🚀 Iniciando gerador de contracheques CORRIGIDO...');
    console.log('📝 Principais funcionalidades:');
    console.log('   ✅ Elimina duplicações usando DISTINCT');
    console.log('   ✅ Usa Map() para garantir unicidade');
    console.log('   ✅ Subconsultas para totais corretos');
    console.log('   ✅ Layout preservado na impressão');
    console.log('   ✅ Geração de PDF com Puppeteer');
    console.log('   ✅ Dados bancários integrados');
    
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
    gerarContrachequesAlternativo,
    gerarContrachequesComPDF,
    gerarPDF,
    diagnosticarDados 
};