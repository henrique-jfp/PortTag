# Pitch comercial — PortTag

Briefing para apresentar o PortTag a síndicos, administradoras e gestores de
condomínio. Aqui está o que falar, em que ordem, o que mostrar na tela, como
responder às objeções e o que **não** prometer.

> **Frase de abertura:** “O PortTag é o caderno digital da portaria: registra a
> encomenda com foto, confere o endereço do condomínio, avisa o morador e
> comprova a retirada com assinatura. O síndico acompanha tudo sem depender do
> caderno de papel.”

---

## 1. Ficha-resumo

| Item | Descrição |
| --- | --- |
| **Produto** | PortTag — controle de encomendas para condomínios |
| **Formato** | Aplicativo web instalável (PWA) para celular e computador |
| **Perfis** | Super Admin (plataforma), Síndico, Porteiro |
| **Promessa central** | Fim do caderno de papel e da encomenda “que ninguém sabe onde está” |
| **Prova principal** | Registro com data/hora do servidor, conferência de endereço, aviso ao morador e retirada com assinatura |
| **Ideal para** | Condomínios com portaria, alto volume de entregas, vários blocos ou administradora com carteira de condomínios |
| **Não é** | Controle de acesso, rastreio de transportadora, ERP financeiro ou substituto da portaria física |

### O que o cliente compra

Não é “um app”. É:

1. **Menos conflito:** “eu não recebi” deixa de ser palavra contra palavra.
2. **Menos encomenda esquecida:** o síndico vê o que está há 3, 7 ou 15 dias.
3. **Menos retrabalho:** o morador é avisado e a retirada é registrada uma vez.
4. **Menos exposição:** a foto da etiqueta não fica guardada; a foto de avaria
   tem prazo; o acesso é por perfil.
5. **Mais controle:** relatórios por período, bloco, unidade, empresa e
   porteiro.

---

## 2. O problema (conte como história)

São 14h. Chegam 23 pacotes de uma vez. O porteiro anota no caderno:

- às vezes o nome;
- às vezes o apartamento;
- quase nunca a transportadora;
- o rastreio, se der tempo.

O morador pergunta no grupo do condomínio: “chegou alguma coisa para o 901?”. O
porteiro para o que está fazendo para procurar. O síndico não tem número nenhum
para levar à assembleia. Quando alguém diz “eu não recebi”, ninguém consegue
provar quem retirou.

Some a isso:

- encomenda guardada há duas semanas;
- aviso enviado pelo WhatsApp pessoal do porteiro;
- foto da etiqueta com CPF e endereço no celular de alguém;
- portaria que troca de turno e não passa o bastão;
- condomínio com três blocos e um caderno só.

**O custo não é só a encomenda perdida. É o tempo da portaria, o desgaste do
síndico e a discussão que chega na assembleia.**

---

## 3. A solução em quatro pilares

### Pilar 1 — Receber com prova

O porteiro fotografa a etiqueta. O sistema lê e sugere transportadora, rastreio,
destinatário e apartamento. O endereço é conferido contra o cadastro do
condomínio. Se divergir, o app bloqueia e exige conferência física.

**Fale assim:** “O sistema não decide se a encomenda é do prédio. Ele compara
CEP, rua e número com o cadastro. Se não bater, o porteiro precisa confirmar que
conferiu a etiqueta — e isso fica registrado.”

### Pilar 2 — Avisar sem depender da memória

O aviso vai para uma fila. Se o condomínio tiver WhatsApp conectado, sai
automaticamente. Se não tiver, o app monta a mensagem e abre o `wa.me` — sem
custo por mensagem.

**Fale assim:** “Você pode começar sem contratar WhatsApp automático. O modo
manual já resolve. Quando quiser, conecta um número da portaria e o aviso passa
a sair sozinho.”

### Pilar 3 — Entregar com assinatura

Na retirada, o morador assina na tela. O porteiro marca que presenciou. Uma
assinatura pode cobrir todos os pacotes do mesmo apartamento.

**Fale assim:** “A assinatura não é enfeite: ela vai para o comprovante, com
nome, data e hora do servidor. Se houver contestação, o síndico abre o registro
e mostra.”

### Pilar 4 — Gerir com número

O síndico vê:

- total, aguardando retirada, retiradas e recebidas hoje;
- o que está há mais de 3, 7 e 15 dias;
- avarias e fotos perto de vencer;
- pacotes sem aviso;
- relatório TOP por período, bloco, unidade, empresa e porteiro, com exportação CSV e PDF.

**Fale assim:** “Na assembleia, você não leva impressão. Leva número e
comprovante.”

---

## 4. Diferenciais que aguentam escrutínio

| Diferencial | Por que importa | Como provar |
| --- | --- | --- |
| **Conferência determinística de endereço** | Não depende de “a IA achou”; CEP, rua e número são comparados com o cadastro | Mostrar uma etiqueta de outro endereço e o bloqueio |
| **IA só como apoio** | A IA completa nome/unidade quando falta; nunca decide endereço | Mostrar o diagnóstico da leitura |
| **Foto da etiqueta não é guardada** | Reduz exposição de CPF/endereço | Explicar o fluxo e mostrar que o comprovante é o registro |
| **Aviso manual sem custo por mensagem** | Começa sem contrato de WhatsApp | Mostrar o link `wa.me` |
| **Aviso automático opcional** | Quem quer, conecta; quem não quer, não paga | Mostrar a tela de WhatsApp do síndico |
| **Retirada com assinatura e aceite** | Prova de entrega | Mostrar o comprovante |
| **Lote e rajada** | Alta demanda não para a portaria | Mostrar o recebimento em massa |
| **Operação por portaria** | Bloco A não vê o caderno do bloco B | Mostrar troca de portaria |
| **Multi-condomínio** | Administradora opera a carteira | Mostrar o seletor do síndico |
| **Retenção configurável** | Política de privacidade e custo de armazenamento | Mostrar o campo de meses |
| **PWA instalável** | Não depende de loja de aplicativos | Instalar na hora |

---

## 5. Para quem é (e para quem não é)

### 5.1 Perfil ideal

- Condomínio com **portaria presencial** e volume relevante de entregas.
- **Vários blocos** ou mais de uma portaria.
- Síndico que já sofre com reclamação de encomenda.
- Administradora que quer padronizar a operação da carteira.
- Condomínio que quer **prova de entrega** para transportadora, morador ou
  assembleia.

### 5.2 Perfil de risco (qualifique antes)

- Condomínio sem portaria e sem responsável por receber.
- Operação que quer **rastreio de transportadora** em tempo real.
- Cliente que quer **controle de acesso de visitantes**.
- Cliente que exige integração com ERP/financeiro específico.
- Cliente que quer tudo automático, sem treinar a portaria.
- Condomínio com uma única encomenda por semana e nenhum problema de registro.

> Se o cliente se encaixa em “não é”, diga com clareza. Vender o que o produto
> não faz gera cancelamento e boca a boca ruim.

---

## 6. Descoberta: pergunte antes de apresentar

Não comece a demo. Faça de 8 a 12 minutos de perguntas. Anote as respostas e
use as palavras do cliente na apresentação.

### 6.1 Para o síndico

1. Quantas encomendas chegam por dia, em média? E no pico?
2. Quantos blocos e quantas portarias existem?
3. Como o morador é avisado hoje?
4. O que mais gera reclamação: encomenda perdida, demora, aviso errado ou
   horário da portaria?
5. Já houve discussão de “eu não recebi”? Como foi resolvida?
6. Quem tem acesso ao caderno hoje? O síndico consegue ver?
7. Como é feito o relatório para a assembleia?
8. Há quanto tempo a portaria usa o mesmo processo?
9. O condomínio tem WhatsApp da portaria ou usa o pessoal do porteiro?
10. Existe política de quanto tempo guardar os registros?

### 6.2 Para a administradora

1. Quantos condomínios na carteira? Quantos com portaria?
2. Qual o processo de implantação de um condomínio novo?
3. Quem treina a portaria? Quem dá suporte no dia a dia?
4. Como vocês prestam contas ao síndico?
5. Qual o maior incidente recorrente: extravio, avaria, atraso ou conflito?
6. Há exigência de relatório padronizado entre condomínios?
7. Como é feita a cobrança e o repasse hoje?
8. Qual o prazo típico de decisão de um síndico?
9. Quem aprova a compra: síndico, conselho, assembleia ou administradora?
10. O que faria vocês desistirem de um fornecedor?

### 6.3 Para a portaria (ouça antes de treinar)

1. Como você registra hoje? O que é mais chato?
2. O que acontece quando a etiqueta está ilegível?
3. Como você avisa o morador?
4. O que você faz quando o celular não tem internet?
5. O que te faria não usar o app?
6. Qual o horário de pico?
7. Quantos entregadores diferentes por dia?

### 6.4 Sinais de compra

- O cliente descreve um incidente concreto e pergunta “como isso ficaria?”.
- Pergunta sobre implantação, treinamento e prazo.
- Chama outra pessoa para a conversa (conselho, administradora, porteiro).
- Pede para testar com uma etiqueta real.
- Pergunta o que acontece se o morador não tiver WhatsApp.
- Pergunta sobre cancelamento e propriedade dos dados.

### 6.5 Sinais de fuga

- “Manda uma proposta” sem nenhuma pergunta.
- Quer comparar apenas preço, sem escopo.
- Exige funcionalidade que o produto não tem e não aceita discutir.
- Não consegue dizer quem decide.
- Quer implantar “para ontem” sem cadastro de unidades.

---

## 7. Roteiro de apresentação (25 a 30 minutos)

Adapte a ordem ao perfil. O tempo é uma referência, não uma camisa de força.

### Bloco 1 — Abertura e contexto (2 min)

“Obrigado pelo tempo. Antes de mostrar a tela, quero entender como a portaria
funciona hoje para não apresentar algo que não serve.”

Objetivo: criar confiança e colher material para a demo.

### Bloco 2 — O problema em uma frase (1 min)

“Pelo que você contou, o problema não é receber a encomenda. É **provar** que
recebeu, **avisar** e **saber** o que ainda está na portaria.”

Objetivo: fazer o cliente se reconhecer.

### Bloco 3 — Visão geral em 90 segundos (2 min)

Mostre os três perfis em uma frase cada:

- **Porteiro:** registra, avisa e entrega.
- **Síndico:** acompanha, cobra e presta contas.
- **Super Admin:** cadastra e dá suporte.

Não abra tela ainda. Venda o mapa antes do detalhe.

### Bloco 4 — Demonstração do recebimento (6 a 8 min)

Siga o roteiro da seção 8. Foque em:

- foto;
- leitura;
- conferência de endereço;
- apartamento;
- aviso;
- confirmação.

### Bloco 5 — Retirada com assinatura (4 a 5 min)

Mostre a lista **Na portaria**, a seleção dos pacotes do mesmo apartamento, a
assinatura e o aceite. Depois abra o comprovante.

### Bloco 6 — Visão do síndico (5 a 6 min)

Mostre a Visão geral, um alerta abrindo o caderno filtrado e o relatório com
CSV. Fale de assembleia e de “mais de 7 dias”.

### Bloco 7 — Operação e implantação (3 min)

Explique:

- cadastro do condomínio;
- importação de moradores;
- criação de portarias e acessos;
- treinamento da portaria;
- WhatsApp manual ou automático.

### Bloco 8 — Fechamento (2 min)

“Faz sentido para o seu cenário? O próximo passo é [definir]. Posso já sair com
[ação concreta]?”

Nunca termine com “qualquer dúvida, me chama”. Termine com uma ação datada.

---

## 8. Demonstração ao vivo: roteiro de 8 minutos

### 8.1 Antes de entrar na reunião

- [ ] Condomínio de demonstração com endereço real e 3 blocos.
- [ ] Unidades `101`, `102`, `901` e uma unidade sem morador.
- [ ] Morador com WhatsApp em `901`; unidade `102` sem WhatsApp.
- [ ] Duas etiquetas reais: uma do endereço do condomínio e uma de outro.
- [ ] Uma foto de “avaria” (pode ser uma caixa amassada).
- [ ] Sessão do síndico e do porteiro já abertas em abas separadas.
- [ ] Internet reserva (4G) e bateria.
- [ ] Plano B: se o OCR falhar, use o preenchimento manual e diga que é assim
      que o produto se comporta quando a nuvem não responde.

### 8.2 Minuto a minuto

**0:00 — Porteiro, tela inicial.**
“Esta é a tela que o porteiro vê. Ele não precisa decorar menu: a ação principal
é tirar foto.”

**0:30 — Recebimento da etiqueta correta.**
Fotografe. Mostre a leitura. Aponte o endereço confirmado.
“O sistema comparou CEP, rua e número com o cadastro.”

**1:30 — Apartamento e morador.**
Mostre a sugestão. Confirme o apartamento. Mostre o nome do morador cadastrado
para conferência.
“Se o nome não bater, o porteiro vê antes de salvar.”

**2:30 — Aviso.**
Deixe “Avisar o morador” marcado. Explique os dois caminhos: automático e link
manual.
“Sem WhatsApp conectado, ele abre a conversa pronta. Sem custo por mensagem.”

**3:30 — Etiqueta divergente.**
Fotografe a etiqueta de outro endereço. Mostre o alerta vermelho e o checkbox.
“Ele não deixa passar sem aceite. E o aceite fica com o nome do porteiro.”

**4:30 — Retirada.**
Vá em **Na portaria**. Selecione dois pacotes do mesmo apartamento. Peça para
alguém da reunião assinar na tela (ou assine você).
Mostre que o botão só libera com assinatura + aceite.

**6:00 — Comprovante.**
Abra o detalhe e o comprovante. Mostre data/hora, porteiro, assinatura.
“É isso que o síndico leva para a assembleia.”

**7:00 — Síndico.**
Abra a Visão geral. Clique em “Há mais de 7 dias”. Mostre o filtro aplicado.
Abra Relatórios, mostre o mês vigente e exporte o CSV; depois mostre o PDF.

**8:00 — Fechamento.**
“O que você viu aqui é a operação real. O que falta para começar no seu
condomínio é cadastro e treinamento.”

### 8.3 O que não mostrar

- Telas de erro não tratadas.
- Dados de outro cliente.
- O painel do Super Admin sem necessidade: ele confunde e desloca o foco.
- Label Lab na primeira reunião, a menos que o cliente seja técnico e pergunte.
- Promessas de roadmap.

---

## 9. Como falar de IA sem mentir

**Não diga:** “A IA identifica o apartamento com 99% de precisão.”

**Diga:** “A leitura usa OCR e regras. A IA ajuda quando falta nome ou unidade.
O endereço não é decidido pela IA: é comparado com o cadastro do condomínio.
Quando não dá para confirmar, o app pede conferência humana.”

**Não diga:** “É 100% automático.”

**Diga:** “O fluxo reduz o trabalho manual, mas a portaria continua conferindo a
etiqueta. É isso que dá segurança jurídica.”

**Não diga:** “Nunca erra.”

**Diga:** “Quando erra, o erro aparece antes de salvar e pode ser corrigido. E o
que foi salvo fica auditável.”

---

## 10. Objeções e respostas

### “Já temos caderno e funciona.”

“Funciona até alguém contestar. O caderno não mostra quem avisou, quando avisou
e quem assinou. O PortTag não tira a autonomia da portaria: dá prova. Você pode
até manter o caderno em paralelo na primeira semana.”

### “O porteiro não vai aprender.”

“A tela principal tem um botão: tirar foto. O resto é confirmação. Na rajada,
ele só fotografa e confirma. O treinamento leva cerca de 30 a 40 minutos e
inclui um teste com etiqueta real.”

### “Não temos internet boa.”

“O app precisa de internet para ler e gravar; o casco da interface abre offline.
Se a conexão cair, o que já foi confirmado está salvo. Para locais instáveis,
recomendamos um roteador/4G dedicado à portaria.”

### “O morador não tem WhatsApp.”

“O aviso manual não é obrigatório para registrar. A encomenda entra do mesmo
jeito. O caderno mostra ‘sem WhatsApp’ e a portaria avisa por outro meio. Você
também pode cadastrar o contato de um responsável.”

### “Não quero que a foto da etiqueta fique armazenada.”

“Ela não fica. A foto é usada para leitura e descartada. Só a foto de avaria é
guardada, por 20 dias, e depois apagada. O comprovante é o registro com
data/hora e assinatura.”

### “Isso é seguro? Tem CPF na etiqueta.”

“O acesso é separado por perfil e por condomínio. O síndico só vê a carteira
dele; o porteiro só vê a portaria atual. A foto da etiqueta não é guardada. As
regras de acesso são aplicadas no banco, não só na tela.”

### “E se a IA errar o apartamento?”

“Ela pode sugerir errado, por isso a sugestão é destacada e o porteiro confere.
Na rajada, a exceção mostra o campo inválido e sugere o apartamento provável
pelo nome. Nada é salvo sem confirmação.”

### “Quanto custa?”

Não improvise. Responda com o modelo:

“O investimento depende de três coisas: quantidade de condomínios, quantidade de
portarias e se vocês querem WhatsApp automático. Vou levantar esses números e
enviar uma proposta com escopo e prazo. O que não pode faltar no escopo é
cadastro, treinamento e suporte da primeira semana.”

> Se a política comercial já tiver valores, use a tabela oficial. Se não tiver,
> nunca invente um número na reunião.

### “Vou pensar.”

“Claro. Para ajudar na decisão, qual é o critério mais importante: preço,
implantação, prova de entrega ou relatório para assembleia? Posso deixar
agendado um retorno em [data] com o que faltar.”

### “Preciso falar com o conselho.”

“Perfeito. Posso preparar um resumo de uma página com o problema, o fluxo e os
números que vocês me passaram. O conselho costuma decidir melhor com um caso
concreto do que com lista de funcionalidades.”

### “Já usamos um sistema da administradora.”

“Ótimo. A pergunta é se ele resolve a portaria ou só o financeiro. O PortTag
pode conviver com o sistema atual: ele cuida do recebimento, do aviso e da
retirada. Se a administradora tiver API, avaliamos a integração; se não, os
relatórios em CSV cobrem a prestação de contas.”

### “Não quero app na loja.”

“Não precisa. É um PWA: abre pelo navegador e pode ser instalado na tela inicial
sem passar pela Play Store. No iPhone, usa-se ‘Adicionar à Tela de Início’.”

### “Nosso condomínio é pequeno.”

“Então o ganho principal é tempo e prova, não volume. Se a portaria recebe
poucas encomendas e não há reclamação, talvez não valha o investimento agora.
Se há conflito de retirada, vale.”

### “E se o cliente cancelar?”

“Os dados ficam no seu projeto Supabase. É possível exportar relatórios e
comprovantes antes do encerramento. O contrato deve prever prazo de retenção e
exportação; não prometa o que não estiver no contrato.”

---

## 11. Implantação realista

### Fase 1 — Cadastro (1 a 3 dias)

- Criar o condomínio com endereço correto.
- Definir modelo de operação (bloco único, portaria central ou por bloco).
- Cadastrar blocos e unidades (manual, lote ou planilha).
- Importar moradores e WhatsApps.
- Definir prazo de acesso.

### Fase 2 — Equipe (1 dia)

- Criar síndico.
- Criar porteiros com portaria de origem.
- Definir férias/cobertura.
- Entregar credenciais.

### Fase 3 — Treinamento (30 a 60 min)

- Recebimento unitário.
- Lote e rajada.
- Aviso manual.
- Retirada com assinatura.
- O que fazer em divergência e avaria.

### Fase 4 — Piloto (1 semana)

- Operar em paralelo com o processo antigo, se o cliente quiser.
- Acompanhar os primeiros 20 a 50 registros.
- Corrigir cadastro de unidade/contato.
- Medir tempo de registro e encomendas sem aviso.

### Fase 5 — Go-live

- Desligar o caderno paralelo.
- Definir rotina diária do síndico.
- Agendar revisão de 30 dias.

**Não prometa “pronto em uma hora”.** O cadastro de unidades e contatos é o que
determina o prazo.

---

## 12. Métricas para provar valor

Combine 3 ou 4 com o cliente **antes** do piloto:

| Métrica | Como medir | Meta realista |
| --- | --- | --- |
| Tempo de registro por pacote | Cronômetro em 10 recebimentos | Reduzir o retrabalho, não prometer número fixo |
| Encomendas há mais de 7 dias | Visão geral / relatório | Queda após 30 dias |
| Pacotes sem aviso | Visão geral | Queda para perto de zero |
| Tempo médio até a retirada | Relatório | Queda ou estabilidade |
| Contestações de retirada | Nº de casos com comprovante | Resolução mais rápida |
| Avarias com foto vencida | Visão geral | Zero |
| Adoção da portaria | % de recebimentos pelo app | 100% no go-live |

Não prometa redução percentual sem linha de base. Peça os números atuais.

---

## 13. Como agir com o cliente

### Postura

- **Curiosidade antes de argumento.** Quem pergunta mais vende melhor.
- **Fale de consequência, não de tecnologia.** “Menos discussão na assembleia”
  vale mais que “determinístico”.
- **Use o vocabulário do cliente.** Se ele diz “caderninho”, use “caderninho”.
- **Assuma o que não faz.** A confiança aumenta.
- **Uma ideia por slide/tela.** Não narre o produto inteiro.

### Com o síndico

- Ele quer sossego e prova. Mostre a Visão geral e o comprovante.
- Ele pode não decidir sozinho. Descubra cedo quem aprova.
- Não o coloque contra a administradora. Posicione o PortTag como ferramenta
  dele e da portaria.

### Com a administradora

- Ela quer padronização, suporte e escala. Mostre multi-condomínio, prazos e
  relatórios.
- Pergunte como é o onboarding atual e o que costuma dar errado.
- Deixe claro o custo de treinamento e suporte.

### Com a portaria

- Respeite o conhecimento dela. Pergunte como faz hoje.
- Mostre que o app reduz trabalho, não que “substitui” a pessoa.
- Treine com as etiquetas reais do condomínio.
- Deixe um canal claro para dúvidas na primeira semana.

### Com o TI / responsável técnico

- Explique que é web/PWA, com Supabase e OCR na nuvem.
- Não exponha chaves nem detalhes internos.
- Fale de RLS, perfis, retenção e logs.
- Se pedirem integração, colete requisitos; não prometa na hora.

### Quando a demo falhar

1. Não entre em pânico e não culpe a internet na frente do cliente.
2. Diga: “Vou mostrar o caminho manual, que é o fallback real do produto.”
3. Continue o fluxo.
4. Depois, investigue e envie uma nota com a causa e a correção.

### Quando o cliente fizer uma pergunta que você não sabe

“Não vou inventar. Vou confirmar com a equipe e te respondo até [data].” Anote
e cumpra.

---

## 14. O que não prometer

- Que a IA acerta 100%.
- Que o sistema substitui a conferência física da portaria.
- Que o WhatsApp automático é gratuito ou ilimitado.
- Que o cliente nunca mais terá encomenda perdida.
- Que a implantação é instantânea.
- Que existe integração com qualquer ERP sem avaliação.
- Que o produto faz controle de acesso, visitantes, ronda ou câmera.
- Que os dados podem ser apagados “a qualquer momento” sem política de retenção.
- Que o preço inclui algo que não está no escopo escrito.

---

## 15. Fechamento: próximos passos

Escolha **uma** ação concreta e date:

1. **Teste guiado:** 30 minutos com uma etiqueta real do condomínio.
2. **Piloto:** uma portaria por 7 dias, com meta combinada.
3. **Proposta:** enviar escopo, prazo e investimento até [data].
4. **Reunião com decisor:** marcar com síndico/conselho/administradora.
5. **Levantamento:** receber lista de unidades e contatos para simular
   implantação.

Ao final, envie um resumo com:

- o problema que o cliente descreveu;
- o que foi demonstrado;
- o que ficou fora de escopo;
- próximos passos e responsáveis;
- data do próximo contato.

---

## 16. One-pager para deixar com o cliente

**PortTag — o caderno digital da portaria**

- Recebe com foto e confere o endereço do condomínio.
- Avisa o morador por WhatsApp automático ou link manual.
- Entrega com assinatura, nome, data e hora.
- Mostra ao síndico o que está há 3, 7 e 15 dias.
- Exporta relatórios em CSV e PDF do mês vigente ou de qualquer período.
- Funciona no celular, sem loja de aplicativos.
- A foto da etiqueta não é armazenada; a foto de avaria dura 20 dias.
- Cadastro de condomínios, blocos, unidades e moradores.
- Operação por portaria, com cobertura de férias e troca de plantão.

**Ideal para:** condomínios com portaria e volume de entregas; administradoras
que querem padronizar a operação.

**Próximo passo:** teste guiado de 30 minutos com uma etiqueta real.

---

## 17. Glossário para a conversa

| Termo | Tradução comercial |
| --- | --- |
| **Recebimento** | A encomenda entrou na portaria |
| **Retirada** | O morador levou a encomenda, com assinatura |
| **Gaveta** | A pasta daquele apartamento no caderno |
| **Rajada** | Fotografar vários pacotes seguidos, sem repetir formulário |
| **Lote** | Várias fotos importadas da galeria e revisadas antes de salvar |
| **Portaria** | Unidade operacional (bloco A, portaria central etc.) |
| **Plantão** | Porteiro trabalhando em portaria diferente da origem |
| **Aviso** | Mensagem ao morador na fila de notificações |
| **Comprovante** | Documento com recebimento, aviso e retirada |
| **Retenção** | Por quanto tempo o caderno guarda os registros |
| **Label Lab** | Laboratório interno para melhorar a leitura de etiquetas |

---

## 18. Checklist antes de sair para a reunião

- [ ] Sei o nome e o perfil de quem vai me receber.
- [ ] Sei quantos blocos/portarias o condomínio tem.
- [ ] Levei uma etiqueta real ou pedi uma na hora.
- [ ] A demo está com dados de exemplo e internet funcionando.
- [ ] Tenho o one-pager e o roteiro de próximos passos.
- [ ] Sei o que o produto **não** faz e vou dizer se perguntarem.
- [ ] Tenho uma pergunta de descoberta para cada stakeholder.
- [ ] Saí com uma ação datada, não com “vou pensar”.
