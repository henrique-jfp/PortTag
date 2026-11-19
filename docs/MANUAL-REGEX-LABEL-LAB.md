# Manual de regex prontas — Label Lab

Este manual acompanha o botão **Manual de regex prontas** no editor da Central
do Label Lab (seção 2). As mesmas receitas aparecem dentro do app, com botão
para adicionar a regex ao campo ou copiá-la.

## Antes de colar qualquer expressão

O Teste de regressão e o OCR de produção executam a regex assim:

```js
new RegExp(pattern, "i"); // só a flag i
```

Consequências práticas:

- O texto do OCR **mantém quebras de linha**. Use `\n` para dizer “na linha
  abaixo”. `^` e `$` valem para o texto inteiro, não para cada linha (não há
  flag `m`).
- O **primeiro grupo `(...)` é o valor lido**. Sem grupo, a regex devolve o
  rótulo junto (`RASTREIO: 048888` em vez de `048888`).
- A **primeira regex que casa vence**. Coloque a específica antes da genérica.
- Espaços repetidos são colapsados. Em rastreio, espaços e hífens são
  removidos antes de salvar.
- Só quatro campos aceitam regex: **Transportadora**, **Rastreio**, **Unidade**
  e **Destinatário**. CEP, logradouro e número do condomínio continuam sendo
  decididos pelo código determinístico.

> Enquanto a versão está em rascunho, a regex vale só no teste. Depois de
> aprovar e **publicar**, ela passa a valer no recebimento sem download de JSON
> e sem deploy. Para voltar atrás, use **Ativar** numa versão publicada anterior.

## Receitas

### 1. Rótulo em uma linha, valor na próxima

```txt
Rótulo: APTO / valor: 106 (linha abaixo)
OCR: "APTO\n106" → lido: "106"
```

```regex
(?:apto|apartamento|ap)[ \t]*[:#]?[ \t]*\n[ \t]*([0-9]+[a-z]?)
```

Use `\n` de propósito: não existe flag `m`.

### 2. Rótulo e valor na mesma linha

```txt
OCR: "APTO: 106" → lido: "106"
```

```regex
(?:apto|ap|unidade)\s*[:#=-]\s*([0-9]+[a-z]?)
```

O separador é obrigatório. Bom quando o OCR preserva os dois-pontos.

### 3. Rótulo colado, sem separador

```txt
OCR: "COMPLEMENTO307" → lido: "307"
```

```regex
(?:complemento|comlemento|complemto|compl)[ \t]*[:#=-]?[ \t]*([0-9]+[a-z]?)
```

Inclui erros de OCR conhecidos em “complemento”.

### 4. Depois de nº, No ou #

```txt
OCR: "Nº 106" → lido: "106"
```

```regex
(?:n[ºo]|no|#)\s*([0-9]+[a-z]?)
```

Cuidado com `no` genérico: prefira `nº` ou `#` quando o OCR permitir.

### 5. Valor entre parênteses

```txt
OCR: "AP (106)" → lido: "106"
```

```regex
\((?:apto|ap)?[ \t]*([0-9]+[a-z]?)\)
```

O parênteses faz parte do casamento, mas não do valor capturado.

### 6. Valor entre colchetes

```txt
OCR: "RASTREIO [AB123456CD]" → lido: "AB123456CD"
```

```regex
\[([A-Z0-9-]{4,24})\]
```

### 7. Número ao lado do texto

```txt
OCR: "ENTREGA 048888" → lido: "048888"
```

```regex
\b(?:pedido|entrega|rastreio)[ \t]+([A-Z0-9]{6,})
```

A palavra-chave vem antes; o grupo captura só o código.

### 8. Texto ao lado do número (vice-versa)

```txt
OCR: "048888 SHIPPIFY" → lido: "SHIPPIFY"
```

```regex
\b[0-9]{6}\b[ \t]+(SHIPPIFY|AMAZON|SHOPEE)
```

Aqui o número é só âncora: o grupo captura a transportadora.

### 9. Texto antes do número

```txt
OCR: "ENTREGA POR SHIPPIFY 048888" → lido: "SHIPPIFY"
```

```regex
(?:entrega por)[ \t]+([A-Za-z ]+?)[ \t]+\d{6}
```

O `\d{6}` no fim impede que a regex engula a linha inteira.

### 10. Código de entrega em 6 dígitos

```txt
OCR: "CODIGO DE ENTREGA\n048888" → lido: "048888"
```

```regex
CODIGO DE ENTREGA\s*(\d{6})
```

Mesma regra publicada na v1. `\s*` aceita espaço ou quebra de linha.

### 11. Rastreio com prefixo conhecido

```txt
OCR: "TBR466671737" → lido: "TBR466671737"
```

```regex
\b(TBR\d{9,12}|BR\d{12}[A-Z0-9])\b
```

Prefira prefixos conhecidos a `\d{10,20}`, que também pega chave de NF-e.

### 12. Rastreio com espaços ou hífens

```txt
OCR: "RASTREIO: AD 758 301 405 BR" → lido: "AD 758 301 405 BR"
```

```regex
(?:rastreio|tracking)[ \t]*[:#]?[ \t]*([A-Z0-9][A-Z0-9 -]{5,})
```

Use `[A-Z0-9 -]` em vez de `\S`: `\S` também casa quebra de linha.

### 13. Transportadora por TRANSP:

```txt
OCR: "TRANSP: SHIPPIFY TECNOLOGIA LTDA" → lido: "SHIPPIFY"
```

```regex
TRANSP:\s*(SHIPPIFY|AMAZON|SHOPEE|CORREIOS)
```

Liste apenas nomes do enum. Nome fora dele vira empresa vazia, de propósito.

### 14. Transportadora pelo nome impresso

```txt
OCR: "Mercado Livre Envios" → lido: "Mercado Livre"
```

```regex
\b(shopee|amazon|mercado livre|shippify)\b
```

A comparação final é pelo enum — a caixa do OCR é preservada no texto lido.

### 15. Nome na linha abaixo de destinatário

```txt
OCR: "DESTINATARIO\nKarolina Costa" → lido: "Karolina Costa"
```

```regex
DESTINAT[AÁ]RIO[ \t]*\n[ \t]*([A-Za-zÀ-ÿ]+(?:[ \t]+[A-Za-zÀ-ÿ]+){1,4})
```

Limite a cinco palavras para não capturar o endereço junto.

### 16. Nome na mesma linha, após dois-pontos

```txt
OCR: "DESTINATÁRIO: Karolina Costa" → lido: "Karolina Costa"
```

```regex
DESTINAT[AÁ]RIO[ \t]*:[ \t]*([A-Za-zÀ-ÿ]+(?:[ \t]+[A-Za-zÀ-ÿ]+){1,4})
```

Não use `.*`: ele engole tudo até o fim da linha.

### 17. Nome na linha antes de “Endereço:”

```txt
OCR: "Karolina Costa\nEndereço: Rua Teste" → lido: "Karolina Costa"
```

```regex
([A-Za-zÀ-ÿ]+(?:[ \t]+[A-Za-zÀ-ÿ]+){1,4})[ \t]*\n[ \t]*ENDERE[ÇC]O:
```

Útil em etiquetas que não escrevem “destinatário”.

### 18. Unidade com sufixo de letra

```txt
OCR: "AP 106A" → lido: "106A"
```

```regex
(?:apto|ap|unidade)[ \t]*[:#=-]?[ \t]*([0-9]+[a-z]?)\b
```

O `\b` impede `106AB`, que provavelmente é outra coisa.

### 19. Unidade ancorada no destinatário

```txt
OCR: "REMETENTE\nAPTO 55\nDESTINATARIO\nKarolina Costa\nAPTO 106" → lido: "106"
```

```regex
DESTINAT[AÁ]RIO[\s\S]{0,120}?(?:apto|ap|unidade)[ \t]*[:#=-]?[ \t]*([0-9]+[a-z]?)
```

`[\s\S]` atravessa linhas; o limite de 120 caracteres evita fugir para o
remetente.

### 20. Número isolado em uma linha (avançado)

```txt
OCR: "106\n" → lido: "106"
```

```regex
(?:^|\n)[ \t]*([0-9]{3,4}[a-z]?)[ \t]*(?=\n|$)
```

Sem âncora de contexto, pode pegar CEP ou número da rua. Só use depois de
testar com várias amostras.

## Erros que fazem a regex “não funcionar”

1. **Campo errado** — CEP, logradouro e número não são editáveis.
2. **Sem `(...)`** — o valor vem com o rótulo junto.
3. **`^` no começo** — sem flag `m`, casa só o início do OCR inteiro.
4. **Genérica antes da específica** — a primeira que casa vence.
5. **Amostra purgada** — ao publicar, as fotos/OCR usados são apagados. Importe
   outra foto para repetir o teste.
6. **`.*` ganancioso** — prefira classes restritas (`[A-Z0-9 -]`, `[^\n]`).
7. **Valor fora do enum de transportadora** — vira empresa vazia; use apenas
   os nomes aceitos.

Todas as receitas acima são validadas por `src/lib/labelLabRecipes.test.ts`:
cada exemplo é executado no mesmo motor do Teste de regressão e precisa devolver
exatamente o valor anunciado.
