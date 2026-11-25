# Manual do Síndico — PortTag

Este é o manual do dia a dia de quem administra o condomínio. Ele explica o que
cada tela faz, o que acontece nos bastidores e como resolver as situações mais
comuns — inclusive férias de porteiro, cobertura de outro bloco, avaria e
morador sem WhatsApp.

> O Síndico **não** cadastra condomínios, não muda o modelo de operação e não
> define o prazo de acesso. Isso é feito pelo Super Admin. O Síndico cuida da
> operação do condomínio ao qual foi vinculado.

---

## 1. Primeiro acesso

1. Abra `https://porteiro.henriquedejesus.dev/manager.html`.
2. Informe o **e-mail** e a **senha** entregues pelo Super Admin.
3. O sistema abre em **Visão geral**.

A senha temporária é de 8 caracteres e aparece uma única vez para o Super
Admin. Se você a perdeu, peça **Nova senha** a ele. Não existe “esqueci minha
senha” dentro do app.

Se você administra mais de um condomínio, as seções de gestão mostram um seletor
**Condomínio** no topo. As alterações valem somente para o condomínio
selecionado. A **Visão geral**, por outro lado, soma os indicadores de todos os
condomínios aos quais você tem acesso.

### Sessão separada

A sessão do Síndico é independente da sessão do Super Admin e da Portaria. Você
pode estar logado no computador e no celular ao mesmo tempo. O botão **Sair**
fica no rodapé do menu.

---

## 2. As sete seções

| Seção | Para que serve |
| --- | --- |
| **Visão geral** | Indicadores, alertas e últimas movimentações |
| **Encomendas** | Caderno por bloco/andar/apartamento e auditoria |
| **Relatórios** | TOP por mês/bloco, exportação CSV e PDF |
| **Moradores** | Blocos, unidades, moradores e importação de planilha |
| **Porteiros** | Criar acesso, trocar portaria, férias, senha e revogação |
| **Estrutura** | Dados/endereço, retenção do caderno e blocos/unidades |
| **WhatsApp** | Conexão da instância e teste de envio |

---

## 3. Visão geral

Os seis cartões são clicáveis e abrem **Encomendas** já filtradas:

| Cartão | O que conta |
| --- | --- |
| **Total de encomendas** | Todas as recebidas no condomínio |
| **Aguardando retirada** | Status “Na portaria” agora |
| **Retiradas** | Retiradas registradas |
| **Recebidas hoje** | Desde a meia-noite local |
| **Há mais de 3 dias** | Aguardando retirada, recebidas antes de 3 dias |
| **Há mais de 7 dias** | Aguardando retirada, recebidas antes de 7 dias |

Em **Atenção imediata**:

- **Avarias e fotos**: quantas encomendas avariadas têm foto ativa e quantas
  fotos vencem nos próximos dias. **Ver registro** abre o primeiro caso.
- **Sem aviso ao morador**: pacotes na portaria sem nenhuma linha na fila de
  avisos. O botão abre a lista de aguardando retirada.

Em **Requer atenção agora** aparece uma lista priorizada:

1. Foto de avaria expirando;
2. Mais de 7 dias na portaria;
3. Mais de 3 dias na portaria;
4. Encomenda avariada;
5. Aguardando retirada sem aviso.

Cada item abre o caderno com o filtro correspondente. **Últimas 5
movimentações** mostra os eventos mais recentes. O botão **Atualizar** recarrega
tudo.

> A visão geral não é tempo real: ela é carregada ao abrir a seção e quando você
> clica em **Atualizar**.

---

## 4. Encomendas

A seção tem duas abas.

### 4.1 Registros

O caderno é hierárquico:

**Blocos → Andares → Apartamentos (gavetas) → Recebimentos**

1. Abra o bloco.
2. Abra o andar.
3. Abra o apartamento.
4. Veja os recebimentos do mais recente ao mais antigo.

Quando existem portarias cadastradas, aparece uma barra de **cadernos por
portaria** antes dos filtros. Escolha o caderno que quer consultar.

Filtros disponíveis:

- **De** e **Até** (data de recebimento);
- **Apartamento / bloco** (texto);
- **Empresa / entregador**;
- **Porteiro**;
- **Rastreio**;
- **Situação**: Todas, Na portaria, Retirado;
- **Ordem dos registros**: Mais recentes, Rastreio, Empresa/entregador;
- **Limpar filtros**.

Quando você chega pela Visão geral, aparece **Filtro aplicado: [nome]** com o
botão **Limpar filtro**.

### 4.2 Detalhe de um recebimento

Ao abrir um registro, você vê:

- destinatário e se ele é morador da unidade;
- data/hora do recebimento;
- porteiro que recebeu;
- entregador, empresa e rastreio;
- estado na chegada (avariado ou não);
- data/hora da retirada, quem retirou e qual porteiro confirmou;
- data do aviso ao morador (ou “Não avisado”);
- **Linha do tempo** do pacote;
- **Imprimir / Gerar Comprovante**;
- **Foto da avaria**, quando existir e ainda não tiver sido apagada;
- **Ver assinatura**, quando o pacote foi retirado.

O comprovante abre a janela de impressão do navegador; escolha “Salvar como
PDF” para arquivar. Ele traz condomínio, unidade, rastreio, recebimento, aviso,
retirada, assinatura e foto da avaria.

> A foto da etiqueta **não** é guardada. O comprovante é o registro do sistema,
> não uma foto do pacote.

### 4.3 Linha do tempo / Auditoria

A aba mostra o histórico **somente leitura** de todos os eventos do condomínio:

- **Recebimento**;
- **Retirada**;
- **Aviso ao morador**;
- **Avaria**.

Filtre por **De**, **Até**, **Evento** e **Bloco**. A lista é paginada e mostra
data/hora e rastreio, quando houver. Eventos não podem ser editados nem
apagados manualmente; é o que dá segurança para contestar uma entrega.

---

## 5. Relatórios

O recorte é por **data de recebimento**. Por padrão abre o **mês vigente**;
use os atalhos **Mês atual**, **Mês anterior** ou **Todo o período**, ou
preencha **De**/**Até** livremente. O filtro de **Bloco** é independente.

1. Escolha o período e, se quiser, o **Bloco**.
2. Clique em **Aplicar recorte** (os atalhos aplicam na hora).
3. Veja os indicadores:
   - Recebidas;
   - Retiradas;
   - Aguardando retirada;
   - Tempo médio até a retirada (horas);
   - Há mais de 3 dias;
   - Há mais de 7 dias;
   - Há mais de 15 dias.
4. Veja as tabelas **Por bloco**, **Por unidade**, **Por empresa/entregador** e
   **Por porteiro**.
5. Clique em **Exportar CSV** para baixar a planilha (abre corretamente no Excel
   em português) ou em **Exportar PDF** para abrir a janela de impressão e
   escolher **Salvar como PDF**. Os dois usam o mesmo recorte e trazem todos os
   blocos, unidades, empresas e porteiros — o PDF só muda o layout.

**Como usar na prática:**

- **Assembleia:** “temos X encomendas há mais de 7 dias” mostra a necessidade de
  reforçar o aviso ou rever o horário da portaria.
- **Avaliação da equipe:** a tabela por porteiro mostra volume, mas não mede
  qualidade. Combine com a auditoria e a conferência de endereço.
- **Cobrança de transportadora:** filtre por empresa e período para mostrar
  volume e avarias.
- **Tempo médio alto:** pode indicar morador sem WhatsApp, portaria fechada em
  horários de pico ou encomenda esquecida.

---

## 6. Moradores

A seção **Moradores** abre o mesmo gerenciador de **Estrutura → Blocos e
Unidades**. Você pode:

### 6.1 Criar bloco

Informe **Nome ou identificação do bloco** (por exemplo, `A`, `Bloco 2`, `Torre
Sul`) e clique em **Adicionar bloco**. A lista mostra quantos apartamentos cada
bloco tem. **Sem bloco** reúne unidades importadas sem bloco.

### 6.2 Criar unidades

- **Unidade avulsa**: número do apartamento/sala. Exige bloco selecionado quando
  o condomínio tem blocos.
- **Em lote**: faixa no primeiro andar + último andar. Exemplo: `101-107` até
  `9` gera `101-107`, `201-207` … `901-907`.
- **Importar planilha**: ver 6.4.

### 6.3 Moradores de uma unidade

Abra a unidade e cadastre **nome** e **WhatsApp**. Ambos são opcionais. Uma
unidade pode existir sem morador. O WhatsApp é o número que recebe o aviso; sem
ele, o aviso fica pendente e o porteiro vê “sem WhatsApp cadastrado”.

Você pode editar nome/WhatsApp ou excluir o morador. Excluir o morador não apaga
o histórico de encomendas.

### 6.4 Importar planilha

A importação aceita CSV e Excel. O sistema mostra **um seletor por coluna**;
escolha o significado de cada uma:

- Apartamento/unidade;
- Bloco;
- Andar;
- Morador;
- Telefone/WhatsApp;
- E-mail;
- Observações;
- Não usar.

Para vários moradores na mesma unidade, repita **Morador** em várias colunas. A
1ª coluna de Morador combina com a 1ª de Telefone/E-mail/Observações, e assim por
diante.

Sem coluna de bloco, o sistema pergunta se o condomínio é de **bloco único**
(cria só apartamentos) ou se está cadastrando o **primeiro bloco** (usa **Bloco
1**). Marque a opção de criar unidades ausentes se for o caso. Moradores
repetidos são ignorados; um erro cancela o lote inteiro.

O resultado mostra blocos, unidades e moradores criados e duplicatas ignoradas.

### 6.5 Boas práticas de cadastro

- Use o número que aparece na etiqueta. “Apto 101”, “101”, “Casa 1” e “Sala 2”
  podem conviver, desde que sejam consistentes.
- Cadastre o WhatsApp com DDD. O sistema monta o link com o código do Brasil
  (`55`).
- Não invente morador para “completar” a unidade. O sistema aceita unidade sem
  contato e o porteiro consegue registrar mesmo assim.
- Antes de importar uma planilha grande, teste com 5 linhas.

---

## 7. Porteiros

A permissão é da **portaria**, não da pessoa. O porteiro registra e consulta
somente o caderno da portaria em que está trabalhando.

### 7.1 Criar acesso

Preencha **Nome**, **Usuário**, **Portaria de origem** e **Prazo de acesso**
(Sem expiração, 7 dias ou Data personalizada). O sistema mostra **usuário e
senha temporária uma única vez**. Copie e entregue.

O porteiro entra em `/porter.html` com **usuário**, não com e-mail.

### 7.2 Ações

| Botão | Quando usar | O que acontece |
| --- | --- | --- |
| **Trocar portaria** | Cobertura de outro bloco/portaria | Muda a portaria **atual**; a permissão passa a ser a dela |
| **Voltar à origem** | Fim da cobertura | Volta para a portaria de origem |
| **Renovar prazo** | Antes ou depois de vencer | Novo prazo, mesma senha |
| **Nova senha** | Esqueceu a senha | Nova senha temporária; a anterior para de funcionar |
| **Desativar (férias)** | Ausência temporária | Bloqueia o login e preserva todo o histórico |
| **Reativar e gerar senha** | Volta das férias | Devolve o acesso com nova senha e prazo |
| **Excluir acesso** | Desligamento definitivo | Revoga o login, mas mantém os registros; exige digitar `EXCLUIR` |

### 7.3 Cenário: férias do porteiro

1. Em **Porteiros**, localize o porteiro.
2. Clique em **Desativar (férias)** e confirme.
3. Se outro porteiro vai cobrir o turno, use **Trocar portaria** no substituto
   para a portaria que ficará descoberta.
4. No retorno, clique em **Reativar e gerar senha** no titular, escolha o prazo
   e entregue a nova senha.
5. Se o substituto foi deslocado, use **Voltar à origem** nele.

**Por que não usar “Excluir acesso” nas férias?** Porque a revogação remove o
vínculo. O histórico continua, mas o retorno exige criar o acesso de novo. Para
ausência temporária, **Desativar** é o caminho certo.

### 7.4 Cenário: cobrir outro bloco por uma semana

1. Confirme que o substituto já tem acesso e senha válida.
2. Clique em **Trocar portaria** no substituto e escolha a portaria descoberta.
3. Avise o substituto: o app mostrará “Você está na [portaria]” e o selo
   “Plantão — origem: [portaria de origem]”.
4. Ao final, clique em **Voltar à origem**.

O substituto passa a ver **somente** o caderno da portaria atual. O que ele
registrou fica no caderno daquela portaria, com o nome dele no registro.

### 7.5 Cenário: porteiro doente no meio do turno

1. **Desativar (férias)** imediatamente, se ele não puder continuar.
2. **Trocar portaria** do substituto.
3. O que já foi registrado permanece; não há “cancelamento em massa”.
4. Se houver encomenda registrada com erro de apartamento, veja a seção 11.

### 7.6 Cenário: desligamento definitivo

1. **Excluir acesso** e digite `EXCLUIR`.
2. O login é bloqueado na hora.
3. O histórico do caderno permanece com o nome dele.
4. Se ele era o único porteiro da portaria, crie outro acesso antes do próximo
   turno.

### 7.7 Prazo vencido

Se o prazo do porteiro vencer, o app mostra “Acesso bloqueado” e ele não
consegue operar. Use **Renovar prazo**. Se o problema for o prazo do
**condomínio**, o bloqueio atinge você também: fale com o Super Admin.

---

## 8. Estrutura

A seção tem duas abas.

### 8.1 Dados e Endereço

Mostra nome, CEP, rua, número, bairro, cidade, UF, blocos cadastrados, situação,
modelo de operação e a retenção do caderno.

- **Endereço:** é o endereço oficial usado na conferência da etiqueta. Ao
  alterar CEP/rua/número/bairro/cidade/UF, o sistema pede confirmação explícita.
  Alterar errado faz o porteiro receber alerta de divergência em entregas
  corretas.
- **Manter registros do caderno por (meses):** vazio significa “nunca apagar”.
  Um número inteiro positivo ativa a limpeza automática. O sistema avisa que a
  exclusão é definitiva.
- **Modelo de operação:** apenas exibido. Quem altera é o Super Admin.

### 8.2 Blocos e Unidades

É o mesmo gerenciador da seção **Moradores**: criar bloco, unidade avulsa, lote,
importação, busca, agrupamento por andar e contatos por unidade.

### 8.3 Retenção: como decidir

| Prazo | Quando faz sentido |
| --- | --- |
| Sem prazo | O condomínio quer histórico completo; assuma o custo de armazenamento e o dever de guarda |
| 12 meses | Cobre um ciclo anual de assembleias e cobranças |
| 6 meses | Operação simples, sem histórico longo |
| 3 meses | Alto volume e política de privacidade curta |

A limpeza apaga registros antigos, eventos e avisos vinculados. **Não há como
recuperar.** Combine com o conselho antes de ativar. A foto de avaria tem prazo
próprio de 20 dias e é apagada independentemente da retenção do caderno.

---

## 9. WhatsApp

A seção mostra o status da instância do condomínio:

- **Desconectado:** os avisos são manuais, pelo link `wa.me`, sem custo por
  mensagem.
- **Conectado:** os avisos são enviados automaticamente pela Evolution API, com
  fallback manual se a conexão cair.
- **Aguardando conexão:** há um QR Code na tela.

### 9.1 Conectar

1. Clique em **Conectar WhatsApp**.
2. Abra o WhatsApp do celular da portaria → **Aparelhos conectados** →
   **Conectar dispositivo**.
3. Escaneie o QR Code.
4. Quando o status mudar para **Conectado**, envie uma **mensagem de teste** para
   um número conhecido.

O QR Code é temporal. Se expirar, clique em **Gerar novo QR Code**.

### 9.2 Desconectar

Use **Desconectar WhatsApp** ao trocar o número da portaria ou ao encerrar o
contrato. Sem conexão, o sistema continua funcionando no modo manual.

### 9.3 O que o WhatsApp não resolve

- Morador sem número cadastrado: não há para quem enviar. O caderno mostra
  “sem WhatsApp cadastrado” e o síndico precisa atualizar o contato.
- Número inválido: a mensagem falha; o status fica registrado na fila. O
  porteiro ainda pode tentar o link manual.
- Bloqueio/spam: o número da portaria pode ser restringido pelo WhatsApp. Use um
  número dedicado, não o pessoal de um funcionário.

### 9.4 Custo e política

O modo manual (`wa.me`) não tem custo por mensagem: abre a conversa no WhatsApp
do aparelho. O modo automático depende da Evolution API e do número conectado.
Não prometa “WhatsApp ilimitado”: a disponibilidade depende do provedor e do
número.

---

## 10. Rotina recomendada

### Todo dia

- Abrir **Visão geral** e resolver os itens de **Requer atenção agora**.
- Conferir **Sem aviso ao morador**.
- Ver se há encomenda **Há mais de 7 dias**.
- Confirmar que a portaria registrou as retiradas com assinatura.

### Toda semana

- Revisar **Porteiros**: prazos, férias e cobertura.
- Revisar moradores sem WhatsApp.
- Exportar o CSV da semana, se houver prestação de contas.
- Conferir a **Linha do tempo / Auditoria** em busca de avarias repetidas.

### Todo mês

- Revisar a retenção do caderno.
- Comparar volume por empresa/entregador.
- Verificar se o WhatsApp continua conectado.
- Revisar unidades vagas/inativas.

### Antes de assembleia

- Exporte o CSV do período.
- Leve os números de “mais de 7 dias”, avarias e tempo médio.
- Se houver contestação, abra o comprovante com assinatura.

---

## 11. Situações reais e o que fazer

### 11.1 Encomenda registrada no apartamento errado

O caderno é histórico; não há botão de “editar recebimento” para o síndico. O
registro errado precisa ser tratado com a portaria:

1. Identifique o registro e o apartamento correto.
2. Se a encomenda ainda estiver na portaria, peça ao porteiro para registrar o
   recebimento no apartamento correto.
3. Não invente uma retirada nem assinatura para “fechar” o registro errado. Se
   ele já foi retirado, mantenha o histórico e registre a correção por escrito
   para a administração.
4. Use a **Linha do tempo / Auditoria** para ter a versão oficial dos fatos e
   oriente a equipe a conferir o apartamento antes de salvar.

> O recebimento em massa/rajada permite ao porteiro corrigir os dados **antes de
> salvar**. Depois de salvo, o histórico é imutável. Por isso, treine a
> conferência do apartamento na tela de exceção.

### 11.2 Encomenda avariada

- O porteiro marca **Pacote chegou avariado** e tira foto do volume inteiro.
- A foto fica disponível por 20 dias.
- A Visão geral alerta quando a foto está perto de expirar.
- Baixe o comprovante/foto antes do prazo se precisar acionar a transportadora.
- O morador deve ser avisado como qualquer outra encomenda.

### 11.3 Morador diz que não recebeu o aviso

1. Abra o registro em **Encomendas**.
2. Veja **Aviso ao morador**.
3. Se estiver “Não avisado”, o pacote entrou na fila? Verifique o WhatsApp do
   morador.
4. Se estiver avisado, o sistema tem a data/hora do aviso. Se o morador não tem
   WhatsApp, o aviso manual depende do porteiro abrir o `wa.me`.

### 11.4 Morador não tem WhatsApp

- O aviso manual não pode ser enviado.
- O caderno registra “sem WhatsApp cadastrado”.
- A portaria deve avisar por telefone, interfone ou pessoalmente.
- Considere cadastrar o WhatsApp de um responsável autorizado.

### 11.5 Encomenda fica 15 dias na portaria

- A Visão geral mostra “Há mais de 7 dias” e o relatório mostra “Há mais de 15
  dias”.
- Não há devolução automática. A política de devolução é do condomínio.
- Registre a retirada quando ocorrer, mesmo com atraso. A assinatura continua
  obrigatória.

### 11.6 Porteiro esqueceu a senha

Use **Nova senha** em **Porteiros**. A senha anterior deixa de funcionar
imediatamente. Entregue a nova por canal seguro.

### 11.7 Você não consegue acessar

- “Acesso bloqueado”: o prazo do condomínio venceu ou ele foi inativado. Fale
  com o Super Admin.
- “Sem acesso a um condomínio”: sua conta não está vinculada. Peça o vínculo.
- E-mail/senha inválidos: peça **Nova senha** ao Super Admin.

### 11.8 Dois condomínios na mesma conta

Use o seletor **Condomínio** nas seções de gestão. A Visão geral soma os dois; o
caderno permite escolher o condomínio e a portaria. Cuidado ao alterar endereço
ou retenção: a mudança vale só para o selecionado.

### 11.9 Troca de administradora

- O Super Admin pode **Zerar dados** (mantém o cadastro) ou **Excluir**.
- Antes, exporte os relatórios e os comprovantes que precisar guardar.
- A retenção do caderno deve ser combinada com a nova administradora.

### 11.10 Condomínio com portaria central

No modelo **Vários blocos com portaria central**, há uma única portaria e o
caderno tem gavetas por bloco. O porteiro vê todos os blocos. Não é necessário
“trocar portaria” para atender outro bloco.

### 11.11 Condomínio com portaria por bloco

Cada bloco tem sua portaria. O porteiro do bloco A não vê o caderno do bloco B.
Para cobrir o B, use **Trocar portaria**. Se a cobertura é permanente, peça ao
Super Admin para ajustar o modelo ou recrie o acesso com a portaria de origem
correta.

---

## 12. Perguntas frequentes

**O síndico pode apagar uma encomenda?**
Não. O caderno é histórico. Corrija pela operação da portaria e documente.

**O síndico pode criar outro síndico?**
Não. A criação e a revogação de síndicos é do Super Admin.

**O síndico pode mudar o modelo de operação?**
Não. O modelo é exibido em **Estrutura**, mas a alteração é do Super Admin.

**O síndico pode mudar o prazo do condomínio?**
Não. O prazo é do Super Admin.

**A foto da etiqueta fica guardada?**
Não. Só a foto de avaria, por 20 dias.

**A assinatura fica guardada para sempre?**
Ela fica no registro da retirada, respeitando a retenção do caderno. Se a
retenção apagar o registro, a assinatura vai junto.

**O aviso automático é garantido?**
Não. Depende de a instância estar conectada e o número do morador ser válido.
Sem isso, o fluxo manual continua disponível.

**O que é “Na portaria”?**
É o status de encomenda recebida e ainda não retirada.

**O que é “Retirado”?**
É o status após a confirmação com assinatura e aceite do porteiro.

**Posso usar o celular pessoal do síndico?**
Pode, mas o recomendado é um aparelho do condomínio. A sessão fica salva no
navegador; ao sair, use **Sair**.

---

## 13. Checklist de implantação no condomínio

- [ ] Endereço e CEP conferidos em **Estrutura**.
- [ ] Blocos e unidades compatíveis com as etiquetas.
- [ ] Moradores principais cadastrados com WhatsApp.
- [ ] Portaria(s) correta(s) e porteiros com portaria de origem.
- [ ] Senhas temporárias entregues por canal seguro e guardadas pelo responsável.
- [ ] Teste de recebimento unitário, lote e retirada com assinatura.
- [ ] WhatsApp conectado ou equipe treinada no link manual.
- [ ] Retenção do caderno definida.
- [ ] Síndico e porteiros sabem quem chamar em caso de bloqueio.
