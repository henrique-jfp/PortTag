# Laboratório de etiquetas — manual de uso

O laboratório serve para **mapear novos modelos de etiqueta antes do lançamento**. Ele usa o mesmo pipeline da produção — Google Vision → regras determinísticas → Groq só nas exceções — e gera um relatório com o que foi lido e sugestões de regex candidatas.

**Nada é aplicado automaticamente.** A IA pode sugerir; a decisão de colar uma regra no código é sua.

## 1. Preparação única

Você precisa de:

- Node 20+ (o projeto já usa),
- Supabase CLI (`npx supabase`),
- um access token do Supabase,
- a variável `LABEL_LAB_SECRET` configurada no Supabase.

### 1.1 Escolha e configure o segredo

Escolha uma senha longa apenas para o laboratório. Substitua `ESCOLHA_UMA_SENHA_LONGA` no comando abaixo.

```powershell
$env:SUPABASE_ACCESS_TOKEN = "SEU_ACCESS_TOKEN"
npx supabase secrets set LABEL_LAB_SECRET="ESCOLHA_UMA_SENHA_LONGA"
npx supabase functions deploy label-lab --yes
```

O segredo fica só no Supabase. Não coloque ele no repositório.

### 1.2 Configure o segredo no seu terminal

Sempre que for rodar o script, no mesmo terminal:

```powershell
$env:LABEL_LAB_SECRET = "ESCOLHA_UMA_SENHA_LONGA"
```

A URL do projeto é lida automaticamente de `.env.local` (`VITE_SUPABASE_URL`). Se quiser sobrescrever:

```powershell
$env:LABEL_LAB_URL = "https://SEU_PROJETO.supabase.co"
```

## 2. Preparando as fotos

- Use JPG, PNG ou WEBP.
- Fotos comuns de celular são aceitas; o script reduz automaticamente para até 1600 px e ~2 MB antes de enviar.
- Inclua casos bons e ruins: etiqueta inclinada, recibo térmico, código de barras parcial, nome cortado.
- Agrupe por transportadora em pastas, se quiser. Exemplo:

```text
etiquetas-novas/
  correios/
    001.jpg
    002.jpg
  shopee/
    001.jpg
  amazon/
    001.jpg
```

## 3. Rodando

```powershell
node scripts/label-lab.mjs .\etiquetas-novas
```

Saída esperada:

```text
......
Lidas: 6/6
Relatório: C:\...\scripts\label-reports\label-coverage.md
JSON: C:\...\scripts\label-reports\label-coverage.json
```

Se você quiser validar contra o endereço de um condomínio real:

```powershell
node scripts/label-lab.mjs .\etiquetas-novas `
  --cep "12345-678" `
  --street "Rua das Flores" `
  --number "1200"
```

Se não quiser gastar chamadas do Groq com sugestões:

```powershell
node scripts/label-lab.mjs .\etiquetas-novas --no-suggest
```

Opções úteis:

| Opção | Finalidade |
|---|---|
| `--out <arquivo>` | Muda o caminho do relatório Markdown |
| `--json <arquivo>` | Muda o caminho do JSON bruto |
| `--cep`, `--street`, `--number` | Endereço esperado, para comparar no relatório |
| `--no-suggest` | Desliga as sugestões de regex |
| `--help` | Mostra a ajuda |

## 4. Lendo o relatório

O arquivo principal é `scripts/label-reports/label-coverage.md`. Ele contém:

1. **Cobertura por transportadora** — quantas fotos, e em quantas foi possível ler unidade, rastreio e destinatário.
2. **Sugestões de regras** — regex candidatas, com o trecho do OCR que motivou cada uma.
3. **Resultado por etiqueta** — campos extraídos, status do endereço, tempo do OCR, campos que a IA preencheu e o texto OCR completo.
4. **Falhas** — fotos que não puderam ser processadas e o motivo.

O JSON ao lado mantém o resultado bruto para conferência.

## 5. Transformando sugestão em regra

Fluxo recomendado:

1. Abra o **texto OCR** da etiqueta problemática no relatório.
2. Confira a regex candidata. Ela precisa casar com um trecho real e não pode ser genérica demais.
3. Coloque a regra no arquivo correto:

| Tipo de campo | Arquivo |
|---|---|
| Transportadora | `supabase/functions/extract-package-label/carrier.ts` |
| Rastreio | `supabase/functions/extract-package-label/parser.ts` |
| Unidade/bloco | `supabase/functions/extract-package-label/parser.ts` |
| Nome do morador | `supabase/functions/extract-package-label/parser.ts` |
| Casamento com cadastro local | `src/lib/packageLabelOcr.ts` |

4. Adicione um caso de teste em `src/lib/__fixtures__/labels.ts` **com dados fictícios/anônimizados**, se quiser cobrir o formato no teste automatizado.
5. Rode a verificação:

```powershell
npm test
npm run lint
npm run build
```

6. Publique:

```powershell
git add -A
git commit -m "Reconhece novo modelo de etiqueta: TRANSPORTADORA"
git push origin main
npx supabase functions deploy extract-package-label --yes
```

E, no servidor, se houve mudança de frontend:

```bash
./scripts/deploy-pvserver.sh
```

## 6. Regras que a IA nunca pode criar

O laboratório **não sugere** e você **não deve criar** regra automática para:

- CEP,
- logradouro,
- número do condomínio,
- decisão de `verified` / `mismatch`.

Isso continua em `verifyPackageDestinationAddress()` e em `address.ts`, determinístico. A IA nunca decide endereço.

Rastreio e transportadora também são sempre reescritos pelas regras no fim do pipeline, mesmo que a IA tenha sugerido algo.

## 7. Custo e privacidade

- Cada foto consome **1 unidade** da cota do Google Vision (1.000/mês no gratuito).
- As sugestões consomem Groq apenas quando há campo vazio.
- O relatório contém texto OCR com nomes e endereços. Por isso `scripts/label-reports/` é ignorado pelo Git: **não comite**.
- A Edge Function não salva imagem nem relatório; ela só processa e devolve.
- Se precisar guardar o acervo, use `scripts/label-dataset/`, também ignorado.

## 8. Problemas comuns

| Mensagem | Causa | Solução |
|---|---|---|
| `Defina LABEL_LAB_SECRET no ambiente` | Variável não foi setada no terminal | Repita o `$env:LABEL_LAB_SECRET = ...` |
| `Não autorizado.` (401) | Segredo diferente do configurado no Supabase | Confira `npx supabase secrets list` |
| `Vision OCR not configured` | Credencial da Vision ausente no projeto | Revise `VISION_SERVICE_ACCOUNT_JSON` |
| `Imagem grande demais` | Foto enorme e `sharp` não reduziu | Reduza a foto manualmente para ~2 MB |
| `HTTP 413/429` | Requisição grande ou cota excedida | Diminua o lote; rode menos fotos por vez |
| Sugestões vazias | OCR já leu tudo ou Groq não encontrou padrão confiável | Normal. Abra o texto OCR e escreva a regra manualmente |
