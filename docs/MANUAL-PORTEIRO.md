# Manual do Porteiro — PortTag

Este manual é para quem está na portaria. Ele explica, passo a passo, como
registrar uma encomenda, avisar o morador e entregar o pacote com assinatura.
Não é preciso saber informática: se você sabe tirar foto e tocar na tela, sabe
usar o app.

> **O que o app faz por você:** lê a etiqueta, confere o endereço do condomínio,
> sugere o apartamento, guarda a data e a hora certas e monta o aviso ao morador.
> **O que só você pode fazer:** conferir a etiqueta, confirmar o apartamento,
> olhar o pacote e presenciar a retirada.

---

## 1. Antes de começar

### 1.1 Como entrar

1. Abra o app **Portaria** (o ícone na tela inicial) ou o endereço
   `https://porteiro.henriquedejesus.dev/porter.html`.
2. Informe o **usuário** e a **senha** que o síndico entregou.
3. Toque em **Entrar**.

O usuário não é e-mail. Se você esqueceu a senha, peça ao síndico: ele gera uma
**Nova senha** para você. Não tente adivinhar.

### 1.2 Instalar na tela inicial

No Chrome/Android, toque em **Instalar app** no topo do app. No iPhone, use
**Compartilhar → Adicionar à Tela de Início**. Isso evita abrir o navegador
toda vez e deixa a tela maior.

A câmera só funciona em conexão segura (HTTPS). O endereço de produção já é
seguro. Se a câmera não abrir, verifique a permissão de câmera do navegador.

### 1.3 Onde você está

No topo aparecem:

- o nome do condomínio;
- **Olá, [seu nome]**;
- **Você está na [portaria]**;
- um selo **Plantão — origem: [portaria]** quando você está cobrindo outra
  portaria.

Se o selo de plantão aparecer e você não deveria estar ali, avise o síndico.
**Você não troca de portaria sozinho**: quem troca é o síndico.

---

## 2. A tela inicial

De cima para baixo:

1. **Recebimento em massa** (ligar/desligar) — para muitos pacotes seguidos.
2. **Registrar encomenda** — o fluxo normal, uma foto por pacote.
3. **Importar várias fotos** — escolhe fotos da galeria e revisa antes de
   salvar.
4. **Buscar apartamento** — consulta moradores, encomendas e retiradas.
5. **Caderno digital** — registros recentes por gaveta de apartamento.
6. **Na portaria** — encomendas aguardando retirada.
7. **Instalar app** e **Sair**.

> Se aparecer **Acesso bloqueado**, o prazo do condomínio venceu ou ele foi
> suspenso. Nenhuma operação pode ser feita. Avise o síndico.

---

## 3. As cinco regras de ouro

1. **Confira a etiqueta física.** O app ajuda, mas quem recebe o pacote é você.
2. **Confira o apartamento.** Um número trocado manda o aviso para a pessoa
   errada.
3. **Confira o destinatário.** O nome na etiqueta pode ser de outra pessoa.
4. **Informe o entregador.** É o registro de quem deixou o volume.
5. **Avaria se fotografa.** Se o pacote chegou amassado, molhado ou aberto,
   marque e fotografe o volume inteiro.

---

## 4. Registrar uma encomenda (uma por vez)

### 4.1 Tirar a foto

1. Toque em **Tirar foto**.
2. Enquadre a etiqueta inteira. Toque na etiqueta para focar.
3. Segure firme. Lente limpa e boa luz evitam leitura embaçada.
4. Confirme a foto.

Formatos aceitos: JPG, PNG ou WEBP, até 10 MB. O app comprime antes de enviar.

### 4.2 O que acontece depois da foto

O app mostra **Analisando a foto...** e tenta ler:

- transportadora/empresa;
- código de rastreio;
- nome do destinatário;
- apartamento e bloco;
- endereço (CEP, rua, número).

Se a leitura na nuvem falhar, o app ainda tenta o **código de barras** e você
preenche o restante. Em **Diagnóstico da leitura** você pode ver o texto lido e
copiar o diagnóstico para enviar ao suporte.

### 4.3 Conferência de endereço

Aparece uma faixa:

- **Endereço confirmado** (verde): CEP, rua e número conferem com o condomínio.
  Pode seguir.
- **Endereço não confirmado**: o app não conseguiu ler o suficiente. Confira a
  etiqueta e selecione o apartamento manualmente.
- **Endereço divergente** (vermelho): a etiqueta aponta para outro endereço. Só
  continue se você conferiu fisicamente e tem certeza de que a entrega é deste
  condomínio. Marque:
  **“Confirmo que conferi a etiqueta fisicamente e a entrega pertence a este
  condomínio.”**

Essa confirmação fica registrada com o seu nome. **Nunca marque sem conferir.**

### 4.4 Preencher o formulário

- **Bloco**: quando o condomínio tem blocos. Pode vir preenchido pela etiqueta
  ou pela portaria.
- **Apartamento**: escolha em **Sugestões da etiqueta** ou em **Apartamentos
  desta portaria**. Se o número lido não existir, o app avisa e pede seleção
  manual.
- **Nome do destinatário**: obrigatório. Se foi lido, confira. Se não, digite
  como está na etiqueta.
- **O destinatário é morador deste apartamento**: marque somente se for
  verdade. Ao marcar, o nome é cadastrado como morador da unidade se ainda não
  constar.
- **Nome do entregador**: obrigatório. Use **Usar último entregador** para
  repetir o anterior.
- **Avisar o morador no WhatsApp ao registrar**: marcado por padrão. Desmarque
  se não quiser avisar agora.
- **Empresa (opcional)**: transportadora ou loja.
- **Código de rastreio (opcional)**: se não houver, deixe vazio.

### 4.5 Rastreio repetido

Se o código já existir, aparece um aviso. Se for **outro volume com o mesmo
rastreio**, confirme e use **Registrar mesmo assim**. Se for engano, corrija o
código.

### 4.6 Pacote avariado

1. Marque **Pacote chegou avariado**.
2. Toque em **Fotografar avaria** e fotografe o volume inteiro.
3. A foto é obrigatória quando a avaria está marcada.
4. A foto da avaria fica guardada por **20 dias** e depois é apagada
   automaticamente.

A foto da etiqueta **não** é guardada.

### 4.7 Confirmar

Toque em **Confirmar recebimento**.

- Se o aviso for automático (WhatsApp conectado), ele é enfileirado.
- Se for manual, aparece **Abrir conversa no WhatsApp (sem custo)**. Toque para
  abrir a conversa com a mensagem pronta e envie.
- A confirmação mostra a data/hora do servidor.

### 4.8 Cancelar

Use **Cancelar** (ao lado da foto ou no fim do formulário) para descartar tudo e
voltar ao início sem registrar. Use quando a etiqueta não for do condomínio ou
quando você tirou a foto errada.

### 4.9 Rascunho

O app guarda um rascunho **neste aparelho** por até 24 horas, inclusive a foto
já comprimida. Se você trocar de app, perder a conexão ou o Android fechar a
tela, ao reabrir o formulário pode voltar preenchido. O rascunho é apagado
depois do registro.

---

## 5. Importar várias fotos (lote)

Use quando o entregador deixar vários pacotes de uma vez e você já tiver as
fotos na galeria.

1. Em **Importar várias fotos**, toque em **Escolher fotos da galeria**.
2. Selecione as fotos.
3. Preencha, se quiser:
   - **Empresa padrão** (ex.: Shopee);
   - **Entregador padrão**;
   - **Enviar mensagem a todos os moradores ao concluir o lote**.
4. Toque em **Ler N foto(s)**.
5. Acompanhe a fila:
   - **registrada**: já foi salva;
   - **para revisar**: falta conferir algum campo;
   - **com erro**: a leitura falhou;
   - **na fila**: ainda será processada.
6. Se houver endereço divergente/não confirmado, marque o aceite das etiquetas
   conferidas. O aceite fica registrado.
7. Nos itens **para revisar**, confira:
   - apartamento e bloco;
   - morador/destinatário (opcional no lote);
   - rastreio (opcional);
   - empresa (opcional);
   - entregador;
   - status do endereço.
8. Se houver duplicata, marque **“Confirmo que é outro volume com o mesmo
   rastreio.”**
9. Toque em **Salvar esta encomenda** em cada item, ou use:
   - **Salvar N encomendas revisadas** para salvar todos os prontos;
   - **Aplicar entregador e empresa a todos**;
   - **Aceitar N duplicado(s)**;
   - **Limpar fila** para recomeçar.
10. Ao concluir, abra cada link **Avisar apartamento [X] (N encomendas)** para
    enviar o aviso manual, quando o WhatsApp automático não estiver conectado.

> Se o app fechar no meio, ao reabrir pode aparecer **“Lote recuperado. Continue
> fotografando ou finalize as encomendas já salvas.”** As encomendas já salvas
> não se perdem.

---

## 6. Recebimento em massa (rajada)

Use quando chegar uma pilha de pacotes do mesmo entregador e você quiser
fotografar um atrás do outro, sem repetir o formulário inteiro.

### 6.1 Iniciar

1. Ligue **Recebimento em massa**.
2. Responda: **É o mesmo entregador para todos os pacotes?**
   - **Sim, é o mesmo**: informe nome e, se quiser, documento (CPF/RG/CNH).
   - **Não, muda por pacote**: o entregador será informado em cada exceção.
3. Toque em **Iniciar recebimento**.

### 6.2 O ciclo

1. **Fotografar próxima encomenda**.
2. Aguarde **Lendo etiqueta...**.
3. O app mostra a confirmação curta: apartamento, destinatário e
   transportadora.
4. Se estiver tudo certo, toque em **Outra encomenda** e fotografe a próxima.
5. Se algo estiver errado, toque em **Editar dados**.

Cada volume é **gravado na hora**. Se o celular travar, o que já foi confirmado
já está no banco.

### 6.3 Exceções

Quando o app não consegue confirmar algo, ele mostra **Atenção: confira os
campos abaixo** e destaca somente o que falta:

- apartamento (com sugestão de “apartamento provável” pelo nome do
  destinatário);
- entregador;
- transportadora;
- rastreio;
- nome do destinatário;
- endereço (exige o aceite de conferência física);
- rastreio repetido (exige confirmação de outro volume).

Corrija e toque em **Confirmar e continuar**. Se a foto não servir, use
**Descartar foto**.

### 6.4 Trocar o entregador no meio

Na barra fixa do lote, toque em **Trocar entregador**. O contador de pacotes
continua; só o entregador dos próximos muda.

### 6.5 Finalizar

Toque em **Finalizar lote (N)** ou **Finalizar**.

O sistema:

- agrupa as encomendas por bloco/apartamento;
- registra **uma mensagem consolidada por apartamento**;
- mostra quantas encomendas foram registradas, quantos apartamentos foram
  notificados e quantos não têm WhatsApp cadastrado;
- lista os apartamentos sem WhatsApp;
- mostra os links manuais **Avisar [apartamento] (N encomendas)**.

Toque em **Novo recebimento** para começar outro lote.

---

## 7. Avisar o morador

### 7.1 No recebimento

Se **Avisar o morador no WhatsApp ao registrar** estiver marcado:

- com WhatsApp automático conectado, a mensagem é enfileirada e enviada;
- sem conexão, aparece o link **Abrir conversa no WhatsApp (sem custo)**.

### 7.2 Pelo caderno ou por “Na portaria”

Na lista **Na portaria**, cada encomenda mostra:

- **✅ Morador avisado em [data/hora]**, quando já houve aviso;
- **Morador ainda não avisado** e o botão **Avisar morador**.

Ao tocar, o app registra o aviso e abre o link manual, se for o caso.

### 7.3 Pela busca de apartamento

Na busca, abra o apartamento e, ao lado do morador com WhatsApp, toque em
**Avisar no WhatsApp**. O texto já vem com o apartamento, o nome e o rastreio da
primeira encomenda pendente.

> O aviso é uma conveniência. Ele não substitui a conferência na retirada nem
> garante que o morador leu a mensagem.

---

## 8. Consultar o caderno

### 8.1 Caderno digital

Toque em **Caderno digital** para ver os registros por gaveta de apartamento.
Você só vê o caderno da **portaria atual**. Use os filtros de data, apartamento,
empresa, rastreio e situação, como no app do síndico. Toque em **Início** para
voltar.

### 8.2 Buscar apartamento

1. Digite o número (ex.: `901`) e toque em **Buscar**.
2. Escolha o apartamento na lista.
3. Veja:
   - **Moradores** (nome e WhatsApp);
   - **Encomendas e retiradas**, com status, datas, empresa, entregador,
     rastreio e assinatura;
   - **Avisar no WhatsApp**, quando houver morador com número e encomenda
     pendente.
4. Feche com o **X**.

A busca mostra somente apartamentos da portaria atual. “Nenhum apartamento
autorizado encontrado” significa que o número não existe ali ou está em outro
bloco/portaria.

---

## 9. Registrar retirada

A retirada é o momento mais importante: é ela que comprova que o pacote foi
entregue.

### 9.1 Abrir

1. Toque em **Na portaria**.
2. Localize a encomenda e toque em **Registrar retirada**.
3. O app abre **Retirada em lote** com **todos os pacotes pendentes daquele
   apartamento** já marcados.

### 9.2 Conferir

- Desmarque os pacotes que **não** estão sendo retirados.
- Confira se os pacotes selecionados são os que o morador está levando.
- O texto mostra “N de M selecionado(s). A mesma assinatura e o mesmo horário
  serão gravados em todos os selecionados.”

### 9.3 Identificar quem retira

Digite **Nome de quem está retirando**. Não use “morador” genérico; use o nome
de quem está ali.

### 9.4 Assinatura

1. Peça ao morador para assinar com o dedo na área **“Assine aqui usando o
   dedo”**.
2. Se errar, toque em **Apagar e assinar novamente**.
3. A assinatura é obrigatória.

### 9.5 Confirmação do porteiro

Marque:

**“Confirmo que presenciei a retirada e a assinatura do morador.”**

Sem esse aceite, o botão de confirmar não libera. Ele também é exigido no banco:
não adianta burlar a tela.

### 9.6 Confirmar

Toque em **Confirmar retirada de N encomenda(s)**.

O sistema grava, para todos os selecionados:

- nome de quem retirou;
- assinatura;
- data e hora do servidor;
- seu nome como porteiro que confirmou.

Uma assinatura pode cobrir até 50 pacotes do mesmo apartamento.

### 9.7 Se o morador levar só parte

Abra a retirada do apartamento, **desmarque** os pacotes que ficam e confirme
somente os que saíram. Depois, o restante continua em **Na portaria**.

### 9.8 Se o morador se recusar a assinar

Não confirme a retirada sem assinatura e sem o aceite. Avise o síndico e
registre a situação conforme a orientação do condomínio. O sistema não tem
“entregar sem assinatura”.

---

## 10. Avaria, extravio e situações difíceis

### 10.1 Pacote chegou avariado

Marque **Pacote chegou avariado**, fotografe o volume inteiro e registre
normalmente. Avise o morador. Se a avaria for grave, avise o síndico no mesmo
turno. A foto fica 20 dias.

### 10.2 Etiqueta ilegível

Fotografe de novo, com mais luz e sem reflexo. Se continuar ilegível:

- confira o código de barras;
- preencha o apartamento manualmente;
- informe o destinatário como está na etiqueta;
- se não der para identificar o destinatário, **não invente**: peça orientação
  ao síndico.

### 10.3 Etiqueta de outro condomínio

Toque em **Cancelar** e não registre. Avise o entregador. Se ele insistir,
chame o responsável da portaria.

### 10.4 Endereço divergente

Só marque o aceite se você **conferiu fisicamente** a etiqueta e tem certeza de
que a entrega é deste condomínio. O aceite fica com o seu nome. Na dúvida, não
registre: chame o síndico.

### 10.5 Apartamento não existe

O app avisa que o número lido não está no cadastro desta portaria. Confira a
etiqueta e selecione o apartamento correto na lista. Se realmente não existir,
avise o síndico para cadastrar a unidade.

### 10.6 Duas encomendas para o mesmo apartamento

Pode registrar as duas. Se tiverem o mesmo rastreio, o app pede confirmação de
que são volumes diferentes. Na retirada, selecione as duas e use uma assinatura
só.

### 10.7 Morador sem WhatsApp

O app mostra **sem WhatsApp cadastrado** e não há link para enviar. Avise por
outro meio (interfone, telefone, pessoalmente) e peça ao síndico para atualizar
o contato.

### 10.8 O celular descarregou ou o app fechou

- O que já foi **confirmado** está salvo no servidor.
- O rascunho do formulário fica no aparelho por até 24 horas.
- No lote/rajada, o app pode recuperar o lote ao reabrir.
- O que ainda não foi fotografado ou confirmado não existe no sistema.

### 10.9 Sem internet

O app precisa de internet para ler a etiqueta e gravar. O casco da interface
pode abrir offline, mas **não registre offline**: espere a conexão voltar. Se a
internet cair no meio de um lote, as encomendas já salvas permanecem.

---

## 11. Segurança e respeito ao morador

- A assinatura deve ser coletada **com o conhecimento do morador**. Explique que
  ela comprova a retirada.
- Não fotografe documentos, CPF, cartão ou rosto sem necessidade. A foto da
  etiqueta é usada só para leitura e não é guardada.
- A foto de avaria é do volume, não da pessoa.
- Não compartilhe sua senha. Cada porteiro tem o próprio acesso; o registro
  precisa ter o nome de quem realmente conferiu.
- Ao sair do turno em aparelho compartilhado, toque em **Sair**.
- Não use o WhatsApp pessoal para avisos do condomínio. Use o número da portaria
  ou o link `wa.me` gerado pelo app.

---

## 12. Problemas comuns

| O que aparece | O que significa | O que fazer |
| --- | --- | --- |
| **Acesso bloqueado** | Prazo do condomínio venceu ou ele foi suspenso | Avise o síndico; não há operação até regularizar |
| **Usuário ou senha incorretos** | Senha digitada errada ou acesso revogado | Confira e peça **Nova senha** ao síndico |
| **Não há apartamentos ativos nesta portaria** | Sem unidades ativas ou portaria errada | Avise o síndico |
| **A etiqueta indica o apartamento X, mas não está no cadastro** | Unidade não existe nesta portaria | Selecione o apartamento correto ou peça cadastro |
| **Endereço divergente** | Etiqueta aponta para outro endereço | Confira fisicamente; na dúvida, cancele e chame o síndico |
| **Leitura na nuvem indisponível** | OCR fora do ar | O app tenta o código de barras; preencha manualmente |
| **A foto precisa ter no máximo 10 MB** | Foto muito grande | Tire outra foto; o app comprime, mas o original precisa ser menor |
| **Morador ainda não avisado** | Sem aviso registrado | Toque em **Avisar morador** ou avise por outro meio |
| **Assinatura não disponível** | Registro antigo ou assinatura removida pela retenção | Use o comprovante do síndico, se existir |
| **Lote recuperado** | O app reabriu um lote interrompido | Continue de onde parou ou finalize o que já foi salvo |

---

## 13. Checklist do turno

### Ao assumir

- [ ] Conferir no topo se estou na portaria certa.
- [ ] Testar a câmera com uma etiqueta.
- [ ] Ver se há encomendas em **Na portaria** e se alguma está há muitos dias.
- [ ] Conferir se o WhatsApp está conectado (ou saber que o aviso será manual).
- [ ] Ver se há rascunho/lote recuperado de um turno anterior.

### Durante

- [ ] Conferir a etiqueta antes de confirmar.
- [ ] Fotografar avaria quando houver.
- [ ] Avisar o morador.
- [ ] Registrar a retirada com nome, assinatura e aceite.

### Ao encerrar

- [ ] Finalizar lotes abertos.
- [ ] Conferir se ficou algum rascunho importante.
- [ ] Sair do app em aparelho compartilhado.
- [ ] Informar ao síndico qualquer divergência, avaria grave ou pacote antigo.

---

## 14. O que o porteiro não faz

- Não troca de portaria sozinho (quem troca é o síndico).
- Não cria, edita ou exclui blocos, unidades e moradores (exceto marcar que o
  destinatário é morador no ato do recebimento).
- Não apaga encomendas nem edita um recebimento já salvo (corrija **antes** de
  confirmar).
- Não define prazo de acesso, modelo de operação ou retenção do caderno.
- Não conecta o WhatsApp do condomínio.
- Não entrega sem assinatura e sem o aceite de que presenciou a retirada.
