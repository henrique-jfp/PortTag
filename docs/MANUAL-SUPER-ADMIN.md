# Manual do Super Admin — PortTag

Este manual é para quem opera a plataforma, não para o síndico nem para a
portaria. Aqui estão o cadastro dos condomínios, os prazos, a criação de
acessos, o caderno global e o Label Lab.

> Regra de ouro: o Super Admin vê e gerencia **todos** os condomínios. O síndico
> vê apenas os condomínios aos quais foi vinculado. O porteiro vê apenas a
> portaria em que está trabalhando.

---

## 1. Como entrar

1. Abra `https://porteiro.henriquedejesus.dev/` (em desenvolvimento,
   `http://localhost:5173/`).
2. Informe o **e-mail** e a **senha** da conta promovida a Super Admin.
3. Se a conta ainda não existir, crie em **Supabase → Authentication → Users**,
   confirme o e-mail e rode o SQL de promoção:

```sql
update public.profiles p
set is_super_admin = true
from auth.users u
where u.id = p.id
  and lower(u.email) = lower('SEU_EMAIL');
```

A sessão do Super Admin é independente da sessão do Síndico e da Portaria. Você
pode estar logado nos três apps ao mesmo tempo no mesmo navegador.

### O que fazer se a senha for perdida

O sistema não tem “esqueci minha senha” no Super Admin. Redefina a senha pelo
painel do Supabase (Authentication → usuário → Reset password) ou crie outra
conta e promova-a. Nunca compartilhe a chave `service_role`.

---

## 2. Navegação

O menu lateral tem quatro itens:

| Item | Rota | Para que serve |
| --- | --- | --- |
| **Painel** | `/` | Cadastrar condomínio e ver os cartões com prazo e situação |
| **Condomínios** | `/condominiums` | Mesma lista de cartões, sem o formulário de cadastro |
| **Caderno** | `/notebook` | Consultar recebimentos de todos os condomínios |
| **Label Lab** | `/label-lab` | Laboratório de leitura de etiquetas |

No rodapé do menu há atalhos para **Abrir Síndico** (`/manager.html`) e **Abrir
Portaria** (`/porter.html`). Esses atalhos abrem o outro app; não trocam o seu
perfil.

---

## 3. Cadastrar um condomínio

Em **Painel**, preencha **Cadastrar condomínio**.

### 3.1 Identificação e endereço

- **Nome do condomínio**: aparece para o síndico, para o porteiro e nos
  comprovantes.
- **CEP**: ao digitar os 8 dígitos, o sistema consulta o ViaCEP e preenche rua,
  bairro, cidade e UF. Confira e corrija se necessário.
- **Rua ou avenida**, **Número**, **Bairro**, **Cidade**, **Estado (UF)**.

> **Atenção:** CEP, rua e número são usados na conferência determinística da
> etiqueta. Um endereço errado faz o porteiro bloquear encomendas corretas ou
> aceitar encomendas de outro prédio. Depois do cadastro, o Super Admin não
> edita nome e endereço pela lista; o síndico pode ajustar o endereço em
> **Estrutura → Dados e Endereço**, com confirmação explícita.

### 3.2 Blocos

- **Este edifício possui blocos?**
  - **Não**: o condomínio nasce sem blocos; as unidades ficam em “Sem bloco”.
  - **Sim**: informe **quantos blocos existem** e **qual bloco será cadastrado
    primeiro** (por exemplo, `A`, `Bloco 1`, `Torre Sul`). Os demais podem ser
    criados depois.
- O número informado é uma previsão de estrutura: só o bloco inicial é criado
  agora; os demais nascem quando você os cadastrar. As portarias e os cadernos
  são ajustados quando os blocos reais são criados.

### 3.3 Modelo de operação

Escolha como a portaria funciona. Isso muda a quantidade de cadernos e a
permissão dos porteiros:

| Opção | Quando usar | Efeito |
| --- | --- | --- |
| **Bloco único** (`single`) | Um prédio, uma portaria | Uma portaria e um caderno |
| **Vários blocos com portaria central** (`central`) | Vários blocos, mas uma única portaria atende todos | Uma portaria; o caderno tem gavetas separadas por bloco |
| **Vários blocos com portaria por bloco** (`per_block`) | Cada bloco tem sua portaria e sua equipe | Uma portaria por bloco; o porteiro só vê o caderno da portaria atual |

O padrão é **portaria por bloco**. É possível trocar o modelo depois no cartão
do condomínio; as portarias são recalculadas e os vínculos existentes podem
precisar de ajuste. Avise o síndico antes de trocar.

### 3.4 Prazo de acesso

Escolha **Sem expiração**, **7 dias**, **14 dias**, **1 mês**, **3 meses**,
**6 meses** ou **1 ano**. A contagem começa na confirmação do cadastro e é
calculada no banco — o navegador não envia data.

Quando o prazo vence (ou o condomínio é inativado), síndico e porteiro ficam
presos à tela inicial com o aviso “Acesso bloqueado”. O Super Admin continua
entrando. Renovar o prazo **não reativa** um condomínio inativo.

### 3.5 Depois de cadastrar

O condomínio aparece na lista de cartões. Para operar:

1. Clique em **Abrir** (ou vá em **Condomínios**).
2. Cadastre **blocos** e **unidades**.
3. Cadastre **moradores** (opcional por unidade).
4. Na aba **Equipe**, crie o acesso do síndico e dos porteiros.
5. Oriente o síndico a conectar o WhatsApp, se quiser aviso automático.

---

## 4. Cartões do condomínio

Cada cartão mostra nome, cidade/UF, endereço, quantidade de blocos, modelo de
operação, CEP, duração do acesso, data de vencimento e situação
(**Ativo**/**Inativo**). Quando vencido, aparece **Vencido** em vermelho.

Ações disponíveis:

| Ação | O que faz | Cuidados |
| --- | --- | --- |
| **Abrir** | Vai para Blocos e unidades / Equipe | — |
| **Modelo de operação** | Troca `single`, `central` ou `per_block` | Pode mudar as portarias; avise o síndico |
| **Renovar prazo** | Aplica nova duração a partir de agora | Não reativa condomínio inativo |
| **Ativo / Inativo** | Suspende ou reativa o acesso | Inativar bloqueia síndico e porteiros, mas preserva todos os dados |
| **Zerar dados** | Apaga encomendas, eventos, avisos, moradores, contatos, unidades, blocos, porteiros, vínculos, configuração local do WhatsApp, amostras do Label Lab e arquivos privados | Mantém nome, endereço, status, prazo e regras do Label Lab. Contas de login no Supabase e a instância externa da Evolution não são removidas. Exige digitar o nome exato e marcar o aceite de irreversibilidade |
| **Excluir** | Apaga o condomínio e os dados vinculados | Exige digitar o nome exato. Não há lixeira |

**Zerar dados** é para recomeçar a operação (por exemplo, encerramento de
contrato ou troca de administração). **Excluir** é definitivo. Antes de zerar,
leia a prévia **O que será apagado**, com as contagens por tipo de registro;
no **Excluir**, a confirmação mostra apenas o nome do condomínio.

---

## 5. Blocos, unidades e moradores

Abra o condomínio e fique na aba **Blocos e unidades**.

### 5.1 Bloco de trabalho

A lista de blocos mostra quantos apartamentos cada um tem. **Sem bloco** reúne
as unidades importadas sem bloco. Selecione o bloco antes de cadastrar
unidades; o formulário sempre cria no bloco selecionado.

Para criar um bloco, informe **Nome ou identificação do bloco** e clique em
**Adicionar bloco**. Blocos são paginados de 50 em 50.

### 5.2 Cadastrar unidades

Três modos:

- **Unidade avulsa**: informe o número do apartamento ou sala e clique em
  **Cadastrar unidade**. Exige um bloco selecionado quando o condomínio tem
  blocos.
- **Em lote**: informe a **faixa no primeiro andar** (por exemplo, `101-107`) e
  o **último andar** (por exemplo, `9`). O sistema gera `101-107`, `201-207`
  até `901-907`. A prévia mostra quantas unidades serão criadas.
- **Importar planilha**: ver 5.3.

A lista **Unidades cadastradas** agrupa por andar, permite buscar por número,
recolher/expandir andares e paginar. Cada unidade pode ser aberta para ver e
editar moradores.

### 5.3 Importar moradores por planilha

A importação aceita CSV e planilhas (`.xlsx`). O fluxo é:

1. Escolha o arquivo.
2. O sistema mostra **um seletor por coluna encontrada**. Para cada coluna,
   escolha o que ela representa: **Apartamento/unidade**, **Bloco**, **Andar**,
   **Morador**, **Telefone/WhatsApp**, **E-mail**, **Observações** ou **Não
   usar**. A sugestão inicial pode ser trocada.
3. Repita **Morador** em várias colunas para importar mais de um morador por
   unidade. A 1ª coluna de Morador combina com a 1ª de Telefone/E-mail/
   Observações, e assim por diante.
4. Se a planilha não tiver coluna de bloco, o sistema pergunta:
   - o condomínio é de **bloco único** → cria só os apartamentos;
   - está cadastrando o **primeiro bloco** → usa **Bloco 1**.
5. Marque se deseja **criar unidades ausentes**. Sem essa opção, linhas de
   unidades inexistentes são ignoradas.
6. Confira a prévia e confirme.

O resultado informa quantos blocos, unidades e moradores foram criados e
quantas duplicatas foram ignoradas. A operação é atômica: um erro em qualquer
linha cancela o lote inteiro. Moradores repetidos na mesma unidade são
ignorados.

> A importação também existe no app do Síndico (**Moradores** e **Estrutura →
> Blocos e Unidades**). O Porteiro nunca tem essa opção.

### 5.4 Moradores de uma unidade

Abra a unidade na lista. É possível:

- cadastrar morador com **nome** e **WhatsApp** (ambos opcionais);
- editar nome/WhatsApp;
- excluir o morador;
- manter a unidade sem nenhum morador.

O WhatsApp é usado para montar o link `wa.me` do aviso. Sem WhatsApp, o sistema
registra o aviso como “sem WhatsApp cadastrado” e o porteiro não tem para quem
enviar.

---

## 6. Equipe

Na aba **Equipe** do condomínio há duas áreas: **Porteiros** e **Síndicos**.

### 6.1 Cadastrar porteiro

Preencha:

- **Nome**;
- **Usuário para login**: o sistema sugere algo como iniciais do endereço +
  nome; pode ser editado. O usuário é normalizado (sem acentos, minúsculo,
  apenas letras/números/ponto/hífen/underscore, até 32 caracteres);
- **Portaria de origem**: onde o porteiro trabalha normalmente;
- **Prazo de acesso**: **Sem expiração**, **7 dias** ou **Data personalizada**
  (data e hora).

Ao salvar, o sistema mostra **usuário e senha temporária de 8 caracteres uma
única vez**. Use **Copiar credenciais** e entregue ao porteiro por um canal
seguro. A senha não pode ser consultada depois.

O porteiro entra em `/porter.html` com **usuário**, não com e-mail. O app
converte para `porter-<usuario>@porter.invalid`.

### 6.2 Ações do porteiro

| Ação | Efeito |
| --- | --- |
| **Trocar portaria** | Define a portaria **atual** (plantão). A permissão passa a ser a da portaria atual |
| **Voltar à portaria de origem** | Copia a origem para a atual |
| **Renovar prazo** | Define novo prazo sem trocar a senha |
| **Nova senha** | Gera nova senha temporária; a anterior deixa de funcionar |
| **Desativar (férias)** | Bloqueia o login e preserva todo o histórico |
| **Reativar e gerar senha** | Devolve o acesso com nova senha e novo prazo |
| **Excluir acesso** | Revoga somente o login, com confirmação `EXCLUIR`; os registros do caderno permanecem |

A lista mostra portaria de origem, portaria atual, situação, prazo e último
registro. Se o prazo venceu, aparece **Prazo expirado** e o botão de renovação.

**Férias:** use **Desativar (férias)**. Ao voltar, **Reativar e gerar senha**.
Não use **Excluir acesso** para férias: embora preserve o caderno, o vínculo é
removido e o retorno exige recriar o acesso.

**Cobertura em outro bloco:** use **Trocar portaria**. O cabeçalho do app do
porteiro mostra “Você está na [portaria]” e, quando não é a origem, o selo
“Plantão — origem: [portaria]”. Ao terminar, use **Voltar à portaria de
origem**.

### 6.3 Síndicos

Duas formas de dar acesso:

- **Criar síndico**: informe **nome** e **e-mail pessoal**. O sistema cria a
  conta e mostra uma senha temporária de 8 caracteres uma única vez. O síndico
  entra em `/manager.html` com e-mail e senha.
- **Vincular síndico existente**: informe o e-mail de uma conta que já existe no
  Supabase Authentication. A senha continua sendo a da conta existente.

Na lista de síndicos:

- **Nova senha** gera uma senha temporária;
- **Reativar e gerar senha** devolve o acesso;
- **Remover acesso** desfaz o vínculo com o condomínio.

Um mesmo síndico pode administrar mais de um condomínio. Nesse caso, o app dele
mostra um seletor de condomínio nas seções de gestão.

---

## 7. Caderno global

O item **Caderno** mostra os cadernos de todos os condomínios, separados por
portaria quando o modelo é `per_block` ou `central`.

1. Escolha o condomínio (lista “Cadernos dos condomínios”).
2. Escolha a portaria/caderno.
3. Use os filtros: **bloco**, **data**, **apartamento**, **empresa**,
   **porteiro**, **rastreio**, **situação** (Na portaria / Retirado) e
   **ordenação** (Mais recentes / Rastreio / Empresa-entregador).
4. Abra a gaveta do apartamento para ver os recebimentos.
5. Abra um registro para ver a **linha do tempo**, a **assinatura do morador**
   (quando houver) e a **foto da avaria** (quando houver).

O Super Admin usa o mesmo componente do síndico e do porteiro, mas **sem** o
botão de impressão de comprovante. Para emitir comprovante, use o app do
Síndico. O histórico é imutável: eventos não são editados nem apagados
manualmente.

> O caderno respeita a retenção configurada pelo síndico. Registros além do
> prazo podem ser apagados pela limpeza automática.

---

## 8. Label Lab

O **Label Lab** é o laboratório de leitura de etiquetas. Ele permite importar
fotos, ver o que o OCR entendeu, criar regras e publicar correções sem deploy.

### 8.1 Quando usar

- Uma transportadora nova começou a entregar e o nome/rastreio não é lido.
- Um layout de etiqueta mudou.
- Há muitas amostras coletadas automaticamente pelo app do porteiro.
- É preciso testar uma regex antes de publicar.

### 8.2 As quatro etapas da Central

1. **Importar e analisar** — selecione até 6 fotos e clique em analisar. O
   resultado mostra transportadora, rastreio, unidade, destinatário, endereço,
   motor usado e sugestões de regex. Nada é salvo nessa etapa. **Salvar como
   amostra** envia a imagem ao bucket privado e à fila.
2. **Editor de expressões** — para cada campo, adicione regras (regex), nomeie
   a versão e teste. CEP, logradouro e número não têm editor: continuam
   decididos pelo código determinístico.
3. **Teste de regressão** — os casos salvos precisam continuar passando. Uma
   regressão vermelha impede a aprovação.
4. **Versões, aprovação e publicação** — **Nova versão** cria um snapshot;
   **Atualizar** reescreve o rascunho aberto; **Aprovar** exige digitar
   `APROVAR`; **Publicar** exige `PUBLICAR`, purga as fotos das amostras usadas
   e grava o artefato em `label_lab_active_rules`.

Depois de publicar, o OCR de produção e o fallback local passam a usar as
regras. Versões publicadas antes podem ser reativadas. Rascunhos podem ser
excluídos; versões aprovadas/publicadas não.

### 8.3 Fila e amostras

- A lista mostra amostras coletadas pelo porteiro e amostras manuais.
- **Zerar fila** descarta em massa todas as amostras ativas (foto, OCR e
  análise), com contador exato e auditoria. Versões, regras ativas e artefato
  publicado permanecem.
- A coleta pode ser desligada sem deploy:
  `select public.update_label_lab_settings(p_collection_enabled => false);`

O passo a passo de regex está em
[`MANUAL-REGEX-LABEL-LAB.md`](./MANUAL-REGEX-LABEL-LAB.md).

---

## 9. Rotina recomendada

### Diária

- Conferir se algum condomínio está **Vencido** ou **Inativo** e se o cliente
  foi avisado.
- Ver se há condomínios sem síndico ou sem porteiro ativo.
- Acompanhar erros de acesso relatados pelo suporte.

### Semanal

- Revisar prazos que vencem nos próximos 7 dias.
- Verificar a fila do Label Lab e se há amostras acumuladas.
- Conferir se as Edge Functions e os jobs de limpeza estão rodando (logs do
  Supabase).

### Mensal

- Revisar condomínios sem movimento (possível contrato encerrado).
- Validar com o síndico se a retenção do caderno continua adequada.
- Testar um recebimento e uma retirada em ambiente de homologação antes de
  publicar mudanças.

---

## 10. Problemas comuns

| Sintoma | Causa provável | O que fazer |
| --- | --- | --- |
| Síndico ou porteiro vê “Acesso bloqueado” | Prazo vencido ou condomínio inativo | Renovar prazo e/ou reativar o condomínio |
| Porteiro não vê apartamentos | Nenhuma unidade ativa na portaria atual | Conferir blocos/unidades e a portaria atual |
| Porteiro não consegue trocar de bloco | A permissão é da portaria atual | Trocar a portaria atual na aba Equipe |
| Aviso não sai automaticamente | Sem instância Evolution conectada | O sistema cai no link manual `wa.me`; conectar em WhatsApp do Síndico |
| Senha do porteiro não aparece | Ela só é exibida na criação/redefinição | Gerar **Nova senha** |
| “Zerar dados” não apaga o cadastro | É o comportamento esperado | Para apagar tudo, use **Excluir** |
| Erro ao publicar regra no Label Lab | Regressão vermelha ou amostras não purgadas | Rodar o teste, revisar casos e publicar novamente |
| OCR indisponível | Segredo da Vision ausente/corrompido | Conferir **Diagnóstico da leitura** e os logs da função |

---

## 11. O que o Super Admin não deve fazer

- Não editar dados diretamente no banco sem entender as triggers de
  `package_events`.
- Não usar `service_role` no frontend nem em scripts versionados.
- Não trocar o modelo de operação de um condomínio em horário de pico sem
  avisar a portaria.
- Não excluir um condomínio para “limpar” dados: use **Zerar dados**.
- Não prometer que a IA decide endereço. Ela não decide; a conferência é
  determinística.
- Não alterar migrations já aplicadas em produção; crie uma nova migration com
  timestamp posterior.
