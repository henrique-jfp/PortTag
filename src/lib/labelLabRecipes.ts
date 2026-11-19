import type { LabelLabField } from "./labelLabRules";

/**
 * Receitas de regex para o editor do Label Lab. Cada item é executado exatamente
 * como no Teste de regressão: `new RegExp(pattern, "i")`, sem flag `m`, no texto
 * OCR com quebras de linha. O primeiro grupo `(...)` é o valor lido.
 *
 * Os exemplos são fictícios e também são validados por labelLabRecipes.test.ts.
 */

export type LabelLabRecipe = {
  id: string;
  title: string;
  field: LabelLabField;
  pattern: string;
  sample: string;
  expected: string;
  note: string;
};

export const LABEL_LAB_RECIPES: LabelLabRecipe[] = [
  {
    id: "label-abaixo",
    title: "Rótulo em uma linha, valor na próxima",
    field: "unit_number",
    pattern: String.raw`(?:apto|apartamento|ap)[ \t]*[:#]?[ \t]*\n[ \t]*([0-9]+[a-z]?)`,
    sample: "APTO\n106",
    expected: "106",
    note: "Use \n de propósito: sem flag m, ^ e $ não funcionam linha a linha.",
  },
  {
    id: "label-lado",
    title: "Rótulo e valor na mesma linha",
    field: "unit_number",
    pattern: String.raw`(?:apto|ap|unidade)\s*[:#=-]\s*([0-9]+[a-z]?)`,
    sample: "APTO: 106",
    expected: "106",
    note: "O separador é obrigatório. Bom quando o OCR mantém os dois-pontos.",
  },
  {
    id: "label-colado",
    title: "Rótulo colado, sem separador",
    field: "unit_number",
    pattern: String.raw`(?:complemento|comlemento|complemto|compl)[ \t]*[:#=-]?[ \t]*([0-9]+[a-z]?)`,
    sample: "COMPLEMENTO307",
    expected: "307",
    note: "Inclui erros de OCR conhecidos em 'complemento'.",
  },
  {
    id: "simbolo-numero",
    title: "Depois de nº, No ou #",
    field: "unit_number",
    pattern: String.raw`(?:n[ºo]|no|#)\s*([0-9]+[a-z]?)`,
    sample: "Nº 106",
    expected: "106",
    note: "Cuidado com 'no' genérico: prefira nº ou # quando o OCR permitir.",
  },
  {
    id: "parenteses",
    title: "Valor entre parênteses",
    field: "unit_number",
    pattern: String.raw`\((?:apto|ap)?[ \t]*([0-9]+[a-z]?)\)`,
    sample: "AP (106)",
    expected: "106",
    note: "O parênteses faz parte do casamento, mas não do valor capturado.",
  },
  {
    id: "colchetes",
    title: "Valor entre colchetes",
    field: "tracking_code",
    pattern: String.raw`\[([A-Z0-9-]{4,24})\]`,
    sample: "RASTREIO [AB123456CD]",
    expected: "AB123456CD",
    note: "Espaços e hífens do rastreio são removidos antes de salvar.",
  },
  {
    id: "numero-ao-lado",
    title: "Número ao lado do texto",
    field: "tracking_code",
    pattern: String.raw`\b(?:pedido|entrega|rastreio)[ \t]+([A-Z0-9]{6,})`,
    sample: "ENTREGA 048888",
    expected: "048888",
    note: "A palavra-chave vem antes; o grupo captura só o código.",
  },
  {
    id: "texto-ao-lado",
    title: "Texto ao lado do número (vice-versa)",
    field: "carrier",
    pattern: String.raw`\b[0-9]{6}\b[ \t]+(SHIPPIFY|AMAZON|SHOPEE)`,
    sample: "048888 SHIPPIFY",
    expected: "SHIPPIFY",
    note: "Aqui o número é só âncora: o grupo captura a transportadora.",
  },
  {
    id: "texto-antes-numero",
    title: "Texto antes do número",
    field: "carrier",
    pattern: String.raw`(?:entrega por)[ \t]+([A-Za-z ]+?)[ \t]+\d{6}`,
    sample: "ENTREGA POR SHIPPIFY 048888",
    expected: "SHIPPIFY",
    note: "O \\d{6} no fim impede a regex de engolir a linha inteira.",
  },
  {
    id: "codigo-entrega",
    title: "Código de entrega em 6 dígitos",
    field: "tracking_code",
    pattern: String.raw`CODIGO DE ENTREGA\s*(\d{6})`,
    sample: "CODIGO DE ENTREGA\n048888",
    expected: "048888",
    note: "Mesma regra publicada na v1. \\s* aceita espaço ou quebra de linha.",
  },
  {
    id: "prefixo-conhecido",
    title: "Rastreio com prefixo conhecido",
    field: "tracking_code",
    pattern: String.raw`\b(TBR\d{9,12}|BR\d{12}[A-Z0-9])\b`,
    sample: "TBR466671737",
    expected: "TBR466671737",
    note: "Prefira prefixos conhecidos a '\\d{10,20}', que pega chave de NF-e.",
  },
  {
    id: "rastreio-espacos",
    title: "Rastreio com espaços ou hífens",
    field: "tracking_code",
    pattern: String.raw`(?:rastreio|tracking)[ \t]*[:#]?[ \t]*([A-Z0-9][A-Z0-9 -]{5,})`,
    sample: "RASTREIO: AD 758 301 405 BR",
    expected: "AD 758 301 405 BR",
    note: "Use [A-Z0-9 -] em vez de \\S: \\S também casa quebra de linha.",
  },
  {
    id: "transp-label",
    title: "Transportadora por TRANSP:",
    field: "carrier",
    pattern: String.raw`TRANSP:\s*(SHIPPIFY|AMAZON|SHOPEE|CORREIOS)`,
    sample: "TRANSP: SHIPPIFY TECNOLOGIA LTDA",
    expected: "SHIPPIFY",
    note: "Liste apenas nomes do enum. Texto fora dele vira empresa vazia.",
  },
  {
    id: "transportadora-nome",
    title: "Transportadora pelo nome impresso",
    field: "carrier",
    pattern: String.raw`\b(shopee|amazon|mercado livre|shippify)\b`,
    sample: "Mercado Livre Envios",
    expected: "Mercado Livre",
    note: "A comparação final é por enum, mas a caixa do OCR é preservada.",
  },
  {
    id: "nome-linha-abaixo",
    title: "Nome na linha abaixo de destinatário",
    field: "recipient_name",
    pattern: String.raw`DESTINAT[AÁ]RIO[ \t]*\n[ \t]*([A-Za-zÀ-ÿ]+(?:[ \t]+[A-Za-zÀ-ÿ]+){1,4})`,
    sample: "DESTINATARIO\nKarolina Costa",
    expected: "Karolina Costa",
    note: "Limite a 5 palavras para não capturar o endereço junto.",
  },
  {
    id: "nome-mesma-linha",
    title: "Nome na mesma linha, após dois-pontos",
    field: "recipient_name",
    pattern: String.raw`DESTINAT[AÁ]RIO[ \t]*:[ \t]*([A-Za-zÀ-ÿ]+(?:[ \t]+[A-Za-zÀ-ÿ]+){1,4})`,
    sample: "DESTINATÁRIO: Karolina Costa",
    expected: "Karolina Costa",
    note: "Não use .*: ele engole tudo até o fim da linha.",
  },
  {
    id: "nome-antes-endereco",
    title: "Nome na linha antes de 'Endereço:'",
    field: "recipient_name",
    pattern: String.raw`([A-Za-zÀ-ÿ]+(?:[ \t]+[A-Za-zÀ-ÿ]+){1,4})[ \t]*\n[ \t]*ENDERE[ÇC]O:`,
    sample: "Karolina Costa\nEndereço: Rua Teste",
    expected: "Karolina Costa",
    note: "Útil em etiquetas que não escrevem 'destinatário'.",
  },
  {
    id: "unidade-com-letra",
    title: "Unidade com sufixo de letra",
    field: "unit_number",
    pattern: String.raw`(?:apto|ap|unidade)[ \t]*[:#=-]?[ \t]*([0-9]+[a-z]?)\b`,
    sample: "AP 106A",
    expected: "106A",
    note: "O \b impede '106AB', que provavelmente é outra coisa.",
  },
  {
    id: "ancorada-destinatario",
    title: "Unidade ancorada no destinatário",
    field: "unit_number",
    pattern: String.raw`DESTINAT[AÁ]RIO[\s\S]{0,120}?(?:apto|ap|unidade)[ \t]*[:#=-]?[ \t]*([0-9]+[a-z]?)`,
    sample: "REMETENTE\nAPTO 55\nDESTINATARIO\nKarolina Costa\nAPTO 106",
    expected: "106",
    note: "[\\s\\S] atravessa linhas; o limite de 120 caracteres evita fugir para o remetente.",
  },
  {
    id: "numero-isolado",
    title: "Número isolado em uma linha (avançado)",
    field: "unit_number",
    pattern: String.raw`(?:^|\n)[ \t]*([0-9]{3,4}[a-z]?)[ \t]*(?=\n|$)`,
    sample: "106\n",
    expected: "106",
    note: "Sem âncora de contexto pode pegar CEP ou número da rua. Só use após testar.",
  },
];
