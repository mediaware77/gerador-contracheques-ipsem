# Gerador de Contracheques IPSEM

Gerador de contracheques em massa para IPSEM Campina Grande. Sistema que gera contracheques em formato HTML a partir de dados do banco MySQL.

## Pre-requisitos

- Node.js 14.0.0 ou superior
- Banco de dados MySQL configurado
- Sistema operacional: Windows

## Instalacao

1. Instale o Node.js do site oficial: https://nodejs.org
2. Abra o Prompt de Comando ou PowerShell
3. Navegue ate o diretorio do projeto:
   ```cmd
   cd caminho\para\gerador_contracheques
   ```
4. Instale as dependencias:
   ```cmd
   npm install
   ```

## Configuracao

1. Configure a conexao com o banco de dados MySQL no arquivo principal
2. Certifique-se de que as tabelas necessarias existem no banco

## Uso

### Gerar contracheques HTML

```cmd
npm run gerar-html
```

### Execucao direta

Voce tambem pode executar diretamente o arquivo JavaScript:

```cmd
node contracheque.js --html
```

## Estrutura do Projeto

- `contracheque.js` - Arquivo principal do sistema
- `img/` - Imagens utilizadas nos contracheques (logos)
- `package.json` - Dependencias e scripts do projeto

## Dependencias

- **mysql2** - Conexao com banco de dados MySQL
- **puppeteer** - Geracao de HTML

## Suporte

Para duvidas ou problemas, entre em contato com a equipe tecnica do IPSEM Campina Grande.

## Licenca

MIT