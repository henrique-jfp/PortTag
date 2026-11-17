/**
 * Transcrição fiel das etiquetas usadas nos testes.
 *
 * O texto aqui é o que o OCR entrega depois das passadas. Isso é de propósito:
 * o teste mede a decisão de endereço (o que confirma e o que bloqueia), não a
 * qualidade do reconhecimento — essa depende da foto e só o aparelho mede.
 *
 * Cada etiqueta trouxe um engano real de implementação:
 * - Amazon não imprime cabeçalho "DESTINATÁRIO" e imprime o CEP só com dígitos;
 * - Shopee traz o CEP do remetente logo abaixo do destinatário;
 * - Correios imprime o rastreio espaçado e tem bloco "Recebedor" (prova de
 *   entrega), que não é o destinatário;
 * - Mercado Livre põe o bloco do VENDEDOR acima do bloco de destino.
 */

/** Amazon: sem cabeçalho de destinatário, CEP sem hífen. */
export function amazonLabel(cep: string) {
  return `2.3 KG  11/13
XCV9 - NTS AFT - X FC (Cajamar, BR)
Via de Acesso Norte , Km 38 , Galpao 7
Bairro Empresarial Gato Preto
Cajamar SP 07789-100
BR
GUILHERME NOGUEIRA COSTA E VALLE
Praca Edmundo Bittencourt 15
202 Copacabana
Rio de Janeiro RJ ${cep} Brazil
R ${cep}
Order ID: 702-5292765-3347456
TBR466671737
LRJ9
SE
CYCLE 1
OVERSIZE
XCV9
CGH9
A2
LRJ9`;
}

/** Shopee: destino 22421-022 e, embaixo, o remetente com CEP 81910200. */
export const shopeeLabel = `DESTINATARIO
Gabriella Bomtempo Freire
Rua R Nascimento Silva, 110, 305, Rio de Janeiro,
Rio de Janeiro
Bairro: Ipanema
CEP: 22421-022
Pedido: 260129BE2V4GBN
RJ1
LRJ-32
Rio de Janeiro
BR2683799363326
REMETENTE
SMART MOON
Rua Professora Delminda Santos Fernandes, 180, Curitiba, Parana
CEP: 81910200
Envio previsto: 29/01/2026
DANFE SIMPLIFICADO - ETIQUETA`;

/** Correios: rastreio espaçado, "Recebedor" antes do bloco de destino. */
export const correiosLabel = `Contrato: 9912491540
SEDEX
AD 758 301 405 BR
Recebedor:
Assinatura:
DESTINATÁRIO
KATIA ARGOLLO
RUA FERREIRA VIANA 45, 0 CASA 01 FLAMENGO -
FLAMENGO
22210-040 RIO DE JANEIRO/RJ
702-5849730-5141039
Remetente: BRM IMPORTADOS
RUA SANTA LEOCADIA, 307 VILA ISOLINA MAZZEI
02082-000 SAO PAULO/SP`;

/** Mercado Livre: bloco do vendedor acima, destino identificado por "Cidade de destino". */
export const mercadoLivreLabel = `Marlany Balloni #3105997113
Rodovia Presidente Dutra 4674, Centro
São João de Meriti, BR-RJ - 25510000
Venda: 2000018470901098
FRJ02
48020049204
2 SRJ1 02:00
FRJ02 > SRJ1 > 22
QUA 16/09/2026   NF: 974
Karolina Costa (KAROLFEITAL)
Endereco: Praia Botafogo 428, Botafogo
CEP: 22260040
Cidade de destino: Rio de Janeiro, Rio de Janeiro
Complemento: 307
Chave de acesso 352609331160930001735500200000094741847931271`;
