# Controle de Encomendas

Aplicação web para gestão de encomendas em condomínios, com áreas
independentes para Super Admin, Síndico e Porteiro, conectadas ao mesmo
projeto Supabase.

## Requisitos e instalação

- Node.js e npm
- Projeto Supabase

1. Execute `npm ci`.
2. Copie `.env.example` para `.env.local` e configure a URL do Supabase e a
   chave pública (publishable ou anon).
3. Execute `npm run dev`.

Antes de publicar, rode `npm test` (asserções sobre a leitura de etiqueta),
`npm run lint` e `npm run build`. O teste usa as quatro etiquetas reais
(Amazon, Shopee, Correios e Mercado Livre) como fixtures: ele mede a decisão de
endereço — o que confirma e o que bloqueia — e não a qualidade do OCR, que
depende da foto.

No desenvolvimento, as entradas são:

- Super Admin: `http://localhost:5173/`
- Síndico: `http://localhost:5173/manager.html`
- Porteiro: `http://localhost:5173/porter.html`

O build de produção gera as três páginas no diretório `dist`. Publique-as no
mesmo domínio para manter os três apps independentes e conectados ao mesmo
banco. Cada app mantém sua sessão separada.

Endereços publicados para teste:

- Super Admin: `https://porteiro.henriquedejesus.dev/`
- Síndico: `https://porteiro.henriquedejesus.dev/manager.html`
- Porteiro: `https://porteiro.henriquedejesus.dev/porter.html`

O build está hospedado no `pvserver` como serviço systemd
`encomenda-web.service`, com inicialização automática e acesso HTTPS pelo
Cloudflare Tunnel. O site principal do domínio não foi alterado.

### Publicar atualizações no pvserver

O código-fonte fica em `/home/pvserver/encomenda-app/source`; a pasta `current`
continua apontando para uma release pronta em `releases`. Depois de fazer
`git commit` e `git push` para `main`, publique a nova versão com:

```powershell
ssh pvserver "cd /home/pvserver/encomenda-app/source && bash scripts/deploy-pvserver.sh"
```

O script faz `git pull --ff-only`, instala as dependências pelo lockfile, gera
o build, valida as páginas e os arquivos do OCR, cria uma release separada e
troca `current` atomicamente. Se a verificação HTTP falhar, ele restaura a
release anterior. Releases antigas são mantidas para rollback. O serviço web
não precisa ser reiniciado.

Na primeira configuração, clone este repositório em
`/home/pvserver/encomenda-app/source` e configure ali um `.env.local` com
`VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`. O arquivo `.env.example` contém
somente nomes e placeholders; não coloque chaves reais no GitHub. Migrações e
Edge Functions do Supabase continuam sendo publicadas separadamente.

Para mapear novos modelos de etiqueta antes do lançamento, use o laboratório
local: `scripts/label-lab.mjs` envia lotes de fotos para a Edge Function
`label-lab`, que roda o mesmo pipeline de produção e gera um relatório de
cobertura com sugestões de regras. O manual completo está em
`scripts/label-lab/MANUAL.md`. A função é protegida por `LABEL_LAB_SECRET` e
não salva imagem nem relatório; os arquivos gerados ficam em
`scripts/label-reports/`, ignorado pelo Git.

Além desse laboratório manual, o app do porteiro coleta amostras de forma
invisível quando o OCR deixa lacuna real (destinatário, unidade, conflito de
unidade ou endereço divergente/desconhecido) ou falha. A decisão é
determinística em `src/lib/labelLabCollection.ts` e acontece depois do OCR: não
há tela, botão, aviso, loading, nova leitura nem segunda chamada ao Vision. A
mesma JPEG já comprimida vai para `collect-label-sample`, que usa a sessão do
porteiro, grava no bucket privado e cria a tarefa. O worker
`process-label-lab-queue` reaproveita `label-lab` fora do caminho crítico, e
`cleanup-label-lab` apaga a foto e sanitiza o OCR identificável após a retenção.
A Central do Label Lab no Super Admin completa o fluxo: a regex só entra no
teste de regressão enquanto o rascunho não é publicado; ao publicar, o artefato
é gravado em `label_lab_active_rules` e passa a valer no OCR de produção e no
fallback local sem download de JSON nem deploy. Regras publicadas antes podem
ser reativadas. CEP, logradouro e número continuam decididos apenas pelo código
determinístico. Os detalhes de segredos e agendamentos estão em
[`supabase/RECEBIMENTO.md`](./supabase/RECEBIMENTO.md).

### Acesso pelo celular (tela inicial)

Para abrir sem a barra de endereço, instale como app — não use “Adicionar
atalho”, que cria apenas um link para o navegador:

1. Abra `https://porteiro.henriquedejesus.dev/porter.html` (Portaria) ou
   `https://porteiro.henriquedejesus.dev/manager.html` (Síndico) no
   Chrome/Android.
2. Toque na página e espere alguns segundos. Quando o Chrome considerar o app
   instalável, aparece **Instalar app** no cabeçalho; toque e confirme.
   Alternativamente, use o menu do Chrome → **Instalar app** (e não
   **Adicionar atalho**).
3. No Safari/iOS, use **Compartilhar → Adicionar à Tela de Início**.

Os manifests `public/manifest-porter.webmanifest` e
`public/manifest-manager.webmanifest` definem `display: standalone`, os nomes
"Portaria" e "Síndico" e os ícones oficiais PortTag de 192/512 px; no iOS, as
metas `apple-mobile-web-app-*` fazem o mesmo. Depois da instalação o app mostra
a orientação para colocar o ícone na tela inicial: em vários Android o app
instalado vai para a **gaveta de apps** e não aparece sozinho na tela inicial.
Nesse caso, abra a gaveta, procure **Portaria** ou **Síndico**, toque e segure
no ícone e escolha **Adicionar à tela inicial**. O site não consegue fazer isso
programaticamente. Se o ícone tiver um emblema do Chrome, é um atalho simples:
apague-o e reinstale pelo passo 2.
Em aparelhos sem Google Play Services, o Chrome não consegue gerar o WebAPK e
sempre cai em atalho com barra de endereço — não há como forçar pelo site.

`public/sw.js` dá ao app um cache network-first para o casco da interface e
ícones; os dados e o OCR continuam exigindo rede. A câmera exige HTTPS e o
domínio publicado já é HTTPS. Para atualizar, basta publicar uma nova release.

A foto da etiqueta é usada apenas para a leitura e **não é armazenada**. O
comprovante do recebimento é o registro com data/hora do servidor, entregador,
porteiro, unidade e rastreio, mais a assinatura do morador na retirada. Se o
pacote chegar avariado, marque **Pacote chegou avariado** e tire uma foto do
volume inteiro: só essa foto é guardada, por 20 dias, e a limpeza automática a
exclui. A migração `20261118160000_damage_photo_only.sql` permite o
`create_package` sem foto e exige a foto quando a avaria é marcada.

Depois da leitura, se a etiqueta não for do condomínio, use **Cancelar** (junto
da foto ou no fim do formulário) para descartar tudo e voltar ao início sem
registrar a encomenda.

## Primeiro acesso e configuração

No SQL Editor do Supabase, execute as migrações nesta ordem:

1. `supabase/migrations/20261116000000_condominiums_foundation.sql`
2. `supabase/migrations/20261116221500_condominium_blocks.sql`
3. `supabase/migrations/20261116223000_condominium_units_management.sql`
4. `supabase/migrations/20261116225500_unit_residents_and_bulk_units.sql`
5. `supabase/migrations/20261117000000_package_reception.sql`
6. `supabase/migrations/20261117010000_porter_accounts_and_ledger.sql`
7. `supabase/migrations/20261117020000_package_collection_signatures.sql`
8. `supabase/migrations/20261117030000_porter_access_expiration.sql`
9. `supabase/migrations/20261117040000_condominium_user_created_by.sql`
10. `supabase/migrations/20261117050000_package_recipient_verification.sql`
11. `supabase/migrations/20261117060000_package_notifications.sql`
12. `supabase/migrations/20261117070000_package_duplicate_tracking.sql`
13. `supabase/migrations/20261117080000_collection_porter_confirmation.sql`
14. `supabase/migrations/20261117090000_revoke_anon_function_execute.sql`
15. `supabase/migrations/20261117190000_allow_webp_collection_signature.sql`
16. `supabase/migrations/20261117200000_confirm_collection_batch.sql`
17. `supabase/migrations/20261117210000_optional_sender.sql`
18. `supabase/migrations/20261117220000_notification_message.sql`
19. `supabase/migrations/20261118160000_damage_photo_only.sql`
20. `supabase/migrations/20261118180000_package_drawer_pagination.sql`
21. `supabase/migrations/20261119120000_manager_administration.sql`
22. `supabase/migrations/20261119130000_label_lab_collection.sql`
23. `supabase/migrations/20261119140000_label_lab_console.sql`
24. `supabase/migrations/20261119150000_fix_label_lab_storage_deletion.sql`
25. `supabase/migrations/20261119160000_delete_label_lab_ruleset.sql`
26. `supabase/migrations/20261119170000_label_lab_active_rules.sql`
27. `supabase/migrations/20261119200000_condominium_whatsapp_evolution.sql`
28. `supabase/migrations/20261119210000_condominium_access_duration.sql`
29. `supabase/migrations/20261119220000_residents_import.sql`
30. `supabase/migrations/20261120140000_preserve_label_lab_ocr.sql`
31. `supabase/migrations/20261120150000_create_resident_on_package_reception.sql`
32. `supabase/migrations/20261120160000_set_condominium_status.sql`
33. `supabase/migrations/20261120170000_bulk_package_notifications.sql`
34. `supabase/migrations/20261120180000_reset_condominium_data.sql`
35. `supabase/migrations/20261121000000_optional_block_import.sql`
36. `supabase/migrations/20261121010000_import_creates_blocks.sql`
37. `supabase/migrations/20261121120000_resident_import_extra_fields.sql`
38. `supabase/migrations/20261121130000_bulk_package_reception.sql`
39. `supabase/migrations/20261121140000_gatehouse_operation.sql`
40. `supabase/migrations/20261121150000_gatehouse_scoped_queries.sql`
41. `supabase/migrations/20261121160000_notebook_retention_and_reset.sql`
42. `supabase/migrations/20261121170000_reset_label_lab_queue.sql`

A migração 21 delega ao síndico ativo, somente no próprio condomínio, as RPCs
de cadastro (dados do condomínio, blocos, unidades e moradores), cria o
histórico imutável `package_events` com triggers e a RPC
`manager_package_report` para os relatórios. O Super Admin continua com acesso
a todos os condomínios. Depois de executá-la, faça redeploy da Edge Function
`manage-porter`: ela passou a aceitar também o síndico do condomínio, sem
expor `service_role` ao frontend.

A migração 22 cria o bucket privado `label-lab-private`, a fila
`label_lab_queue`, a configuração `label_lab_settings` e a auditoria
`label_lab_audit`. Ela não muda nenhuma regra de leitura: somente o Super Admin
pode consultar essas tabelas, e a escrita acontece nas Edge Functions. A coleta
pode ser desativada sem redeploy com
`select public.update_label_lab_settings(p_collection_enabled => false);`.

A migração 23 cria `label_lab_rulesets`, que versiona regras nos estados
`draft`, `approved`, `published` e `superseded` e guarda a regressão, o
artefato, o checksum e as amostras de origem. Ela amplia as ações registradas
em `label_lab_audit` e adiciona as RPCs `enqueue_label_lab_manual_sample`,
`discard_label_lab_sample`, `save_label_lab_ruleset`,
`approve_label_lab_ruleset` e `publish_label_lab_ruleset`. A aprovação apenas
registra o aceite com o texto `APROVAR` e a regressão verde. A publicação pede
`PUBLICAR` e chama internamente `purge_label_lab_samples_for_ruleset`: as fotos
são apagadas do cofre privado e o OCR das amostras usadas é preservado para
re-testes de regressão (migração 30). As regras nunca tocam CEP, logradouro ou
número: a decisão de endereço permanece determinística no servidor.

A migração 28 adiciona o prazo de acesso por condomínio. No cadastro do
condomínio, o Super Admin escolhe entre **7 dias**, **14 dias**, **1 mês**,
**3 meses**, **6 meses**, **1 ano** e **sem expiração** (`7d`, `14d`, `1m`,
`3m`, `6m`, `1y` e `none` na RPC). A data é calculada no banco a partir de
`now()`; o app nunca envia data de expiração. A renovação é exclusiva do Super
Admin (`update_condominium_access`), que também pode devolver o prazo para
"sem expiração". Com o prazo vencido ou o condomínio inativo, síndico e
porteiro ficam presos à tela inicial, com aviso para contatar o suporte técnico:
a checagem está no banco (`condominium_access_is_active`, usada por
`is_condominium_admin` e `can_access_condominium_block`) e nas Edge Functions
`manage-manager` e `manage-porter`, não apenas na interface. O Super Admin
continua com acesso irrestrito.

A migração 33 agrupa os avisos da importação de fotos por apartamento: um único
texto lista todos os códigos de rastreio daquele lote. Após aplicá-la, faça o
deploy novamente da Edge Function `send-package-notification`, para que todos
os pacotes do grupo sejam marcados como avisados quando o envio automático
concluir. A função aceita `notificationId` (usado pelo app) ou `packageId`; neste
último caso, ela também consulta o vínculo do lote, então qualquer volume do
grupo resolve para o aviso correto.

A migração 32 cria `set_condominium_status`, exclusiva do Super Admin, para
suspender ou reativar o acesso de um condomínio (por exemplo, por
inadimplência) sem excluir blocos, unidades, moradores, encomendas nem vínculos.
No painel, o botão **Ativo**/**Inativo** do cartão substituiu **Editar**: nome e
endereço são definitivos após o cadastro. Inativar já bloqueia síndico e
porteiro pelas mesmas regras do prazo vencido; renovar o prazo não reativa um
condomínio inativo, e somente o Super Admin pode reativá-lo.

A migração 38 prepara o recebimento em lote do porteiro. Ela cria a auditoria
`package_reception_acknowledgements` (aceite único de endereço divergente ou
inconclusivo e de rastreio repetido), a RPC `find_duplicate_packages`, que
confere todos os rastreios da fila em uma chamada, e a RPC
`create_packages_batch`, que registra até 50 encomendas por vez e devolve o
resultado de cada foto sem desfazer as demais. O aceite de endereço continua
sendo conferência física das etiquetas: a decisão determinística permanece em
`verifyPackageDestinationAddress`, no app. Sem a migration aplicada, o lote usa
o caminho antigo, foto a foto; por isso execute-a no SQL Editor antes de
publicar o frontend para teste em produção.

As migrações 39 a 41 implantam a operação por portaria. A 39 cria `portarias`
(`condominium_id`, `block_id`, `name`, `active`), os campos de modo de operação e
retenção em `condominiums`, e `home_portaria_id`, `current_portaria_id` e
`access_revoked_at` em `porter_accounts`. `create_condominium` passou a aceitar
`p_operation_mode`; a troca posterior usa `update_condominium_operation`, e a
retenção é gravada por `update_notebook_retention`. A permissão de bloco passa a ser
avaliada pela **portaria atual** do porteiro na função
`can_access_condominium_block`; a portaria de origem é lembrada para o botão
**Voltar à portaria de origem**. As portarias são criadas automaticamente
conforme o modelo escolhido (`single`, `central` ou `per_block`).

A 40 acrescenta `arg_block_id` a `search_package_drawers`,
`search_package_records` e `manager_package_report`, grava o bloco em
`package_events` e restringe `manager_package_report` a síndico ativo (ou Super
Admin). A 41 cria `cleanup_expired_notebook_records`, usada pela Edge Function
agendada para apagar definitivamente o caderno após o prazo configurado, e
ajusta `reset_condominium_data` para remover também as portarias.

Depois de aplicar as migrações 39 a 41, faça o deploy de `manage-porter` e de
`cleanup-package-receipts`. A criação de porteiro passa a receber `portariaId`;
as novas ações `set-portaria` e `delete-access` trocam a portaria atual e
excluem **somente o acesso** (o login é bloqueado e nenhum registro do caderno
é apagado). Férias continuam sendo **Desativar**, seguido de **Reativar**.

A migração 29 cria a RPC `import_condominium_residents`, usada pela importação
de planilha de moradores no cadastro de estrutura. Ela aceita unidade, bloco
(opcional), nome e WhatsApp, resolve o bloco pelo nome (sem diferenciar
maiúsculas) e aceita linhas sem bloco mesmo em condomínios com blocos. Cria
unidades ausentes apenas quando a opção estiver marcada e ignora moradores
repetidos na mesma unidade. A operação é atômica: um erro em
qualquer linha cancela o lote. A importação está disponível para o Síndico e
para o Super Admin, nunca para o Porteiro.

### Central do Label Lab

O atalho **Label Lab** no painel do Super Admin abre `/label-lab` (em
`index.html`). A tela importa até 6 fotos: **Analisar** mostra o OCR e as
sugestões sem guardar nada, e **Salvar como amostra** envia a imagem ao bucket
privado e à fila. As amostras coletadas pelo porteiro também aparecem na lista
e podem ser reanalisadas ou descartadas.

Para calibrar, adicione sugestões ao editor de regex, crie casos de regressão
a partir das amostras, rode **Testar**, salve o rascunho, aprove e publique.
**Salvar como nova versão** sempre cria um snapshot com o nome digitado;
**Atualizar versão selecionada** reescreve apenas o rascunho aberto. Cada
rascunho pode ser excluído pelo botão **Excluir** na lista de versões (a RPC
`delete_label_lab_ruleset` bloqueia versões aprovadas/publicadas).
**Aprovar** pede o texto `APROVAR` e a regressão verde, apenas registrando o
aceite. **Publicar** pede `PUBLICAR`, exige a exclusão/sanitização das amostras
usadas por `purge_label_lab_samples_for_ruleset` (a purga é reexecutada para
alcançar amostras que entraram depois) e disponibiliza o artefato JSON
versionado para download. Nenhuma regra publicada altera CEP, logradouro ou
número.

O botão **Zerar fila** no topo da Central descarta em massa todas as amostras
ainda ativas (`deleted_at` nulo), inclusive as já analisadas ou em
processamento, com o mesmo efeito do descarte individual: foto, OCR e análise
saem do cofre. A confirmação mostra o contador exato devolvido por
`get_label_lab_queue_preview()` — a lista da tela é limitada a 60 linhas e não
serve de contador. A RPC `discard_all_label_lab_samples` exige Super Admin e
aceite, usa `FOR UPDATE SKIP LOCKED` para não disputar com o worker do cron e
grava uma auditoria agregada `queue_reset`. Amostras já publicadas/descartadas,
versões, regras ativas e o artefato publicado permanecem intactos; o OCR
preservado das amostras consumidas continua disponível para regressão. A
migração 42 também restaura o `set_config` de exclusão do Storage na purga da
publicação, perdido quando o OCR passou a ser preservado.

A Edge Function `admin-label-lab` (`verify_jwt = true`) valida o JWT, exige
`profiles.is_super_admin`, chama `label-lab` com o segredo já existente
`LABEL_LAB_SECRET`, lê as fotos do bucket privado e chama as RPCs; nenhum
segredo chega ao frontend. Para implantar, aplique as migrations
`20261119140000_label_lab_console.sql`,
`20261119150000_fix_label_lab_storage_deletion.sql` (habilita a exclusão das
fotos no descarte, exigida pelo trigger `storage.protect_delete`),
`20261119160000_delete_label_lab_ruleset.sql` e
`20261121170000_reset_label_lab_queue.sql` (restaura o `set_config` na purga e
cria as RPCs do **Zerar fila**), e publique a função:

```powershell
supabase functions deploy admin-label-lab
```

Mantenha os schedules e o `LABEL_LAB_SECRET` atuais — nenhum segredo novo é
necessário. Antes de publicar o frontend (com o script `deploy-pvserver.sh`
acima, após commit/push), rode `npm test`, `npm run lint` e `npm run build`.

Crie e confirme a conta responsável pela plataforma em Supabase
Authentication > Users. Promova somente essa conta no SQL Editor, substituindo
o e-mail:

```sql
update public.profiles p
set is_super_admin = true
from auth.users u
where u.id = p.id
  and lower(u.email) = lower('SEU_EMAIL');
```

O Super Admin pode cadastrar porteiros na área **Porteiros**, escolhendo o
condomínio e a **portaria de origem**. No campo **Prazo de acesso**, escolha sem
expiração, teste por 7 dias ou uma data e hora personalizadas. Ao vencer o
prazo, o banco bloqueia o acesso do porteiro aos dados e o app informa que o
acesso expirou; contas sem prazo continuam ativas até serem revogadas pelo
Super Admin. Ao vencer o prazo, o botão **Renovar prazo** permite definir uma
nova data sem trocar a senha. O sistema gera usuário e senha temporária; anote e entregue a
senha ao porteiro, pois ela é exibida somente na criação ou redefinição. Para
detalhes de publicação da função e do caderno, consulte
[o guia de recebimento e acessos](./supabase/RECEBIMENTO.md).

O Super Admin pode **Criar síndico** no painel: informa nome e e-mail pessoal,
o sistema cria a conta e mostra uma senha temporária de 8 caracteres uma única
vez. O síndico entra em `manager.html` com esse e-mail e senha. O painel também
mantém **Vincular síndico existente** para contas já criadas no Supabase
Authentication; nesse caso a senha é a da conta existente. Na lista de síndicos
é possível gerar **Nova senha**, **Reativar e gerar senha** ou **Remover acesso**.
A função `manage-manager` exige JWT válido e perfil de Super Admin; a chave
`service_role` fica apenas na Edge Function. Porteiros funcionam de forma
equivalente em `porter.html`, com usuário `porter-*@porter.invalid`.

O app Portaria é mobile-first: tira a foto com a câmera do celular e comprime
a imagem antes do processamento. A leitura da etiqueta é feita na nuvem, com
Vision + regras + Groq, e sugere destinatário, unidade, empresa e rastreio. Não
existe leitura de texto no aparelho: se a nuvem falhar ou não estiver configurada, o aparelho lê só
o código de barras da foto original e o porteiro preenche unidade, morador e
endereço manualmente. Quando o código bate com um formato conhecido, ele
prevalece sobre rastreio e empresa sugeridos pela IA.
Confirme o apartamento e informe o nome do entregador; empresa e código de
rastreio são opcionais se não forem detectados. Ao confirmar que recebeu o volume
do entregador, o porteiro pode marcar o aviso ao morador: a mensagem é preparada
pelo banco e aberta no WhatsApp logo após o registro. O caderno do Síndico é
organizado em **gavetas de apartamento**: o calendário e os filtros (data,
apartamento, empresa, porteiro, rastreio e situação) definem o recorte, e cada
gaveta reúne os recebimentos daquele unidade do mais recente ao mais antigo.
Dentro da gaveta é possível ordenar por dia, rastreio ou entregador/loja, abrir
o detalhe com a assinatura sob demanda e paginar tanto as gavetas quanto os
recebimentos. A busca de apartamentos e as listas do porteiro (caderno,
"Na portaria" e encomendas do apartamento) usam a mesma paginação no servidor.
A migration `20261118180000_package_drawer_pagination.sql` cria o índice e as
RPCs `package_daily_counts`, `search_package_drawers` e `search_package_records`,
todas com `security invoker` para preservar as policies RLS existentes.

A área do Síndico tem seis seções no topo: **Visão geral**, **Encomendas**,
**Relatórios**, **Moradores**, **Porteiros** e **Estrutura**. A Visão geral
mostra alertas de avarias/fotos próximas do vencimento, pacotes sem aviso
registrado e uma lista curta do que requer atenção; os cards e os alertas abrem
as Encomendas com o filtro já aplicado. Em **Encomendas**, a aba **Registros**
mantém o caderno e o detalhe de cada pacote traz a linha do tempo e o botão
**Imprimir / Gerar Comprovante**, que usa a janela de impressão do navegador
para salvar um PDF com condomínio, unidade, rastreio, recebimento, aviso,
retirada, assinatura e foto da avaria. A aba **Linha do tempo / Auditoria**
continua com o log imutável de eventos. **Relatórios** exporta o recorte atual
em CSV e **Porteiros** mostra o último registro de cada operador. **Moradores**
usa o mesmo gerenciador da aba **Blocos e Unidades** do Super Admin: criação de
blocos, unidade avulsa, geração em lote, importação de planilha e contatos por
unidade. **Estrutura** reúne **Dados e Endereço** e **Blocos e Unidades**; ao
alterar o endereço, o painel pede confirmação explícita porque ele alimenta a
conferência determinística das etiquetas. Tanto em **Moradores** quanto em
**Blocos e Unidades**, Síndico e Super Admin podem importar uma planilha de
moradores pela RPC `import_condominium_residents` (o Porteiro não tem essa
opção). A tela lê o arquivo e mostra **um campo de mapeamento por coluna
encontrada**: se o arquivo tem 9 colunas, aparecem 9 seletores. Para cada um,
o usuário escolhe o que aquela coluna representa: Apartamento/unidade, Bloco,
Andar, Morador, Telefone/WhatsApp, E-mail, Observações ou Não usar. Basta
repetir a opção **Morador** em três colunas para importar três moradores no
mesmo apartamento; a 1ª coluna de Morador combina com a 1ª de Telefone, E-mail
e Observações, e assim por diante. O nome das colunas não precisa seguir um
padrão: a sugestão inicial pode ser trocada antes de gerar a prévia. Não existe
mais **bloco padrão**: se a coluna de bloco estiver
mapeada, todos os blocos encontrados (letras ou números) são criados
automaticamente pela RPC e as unidades são vinculadas a eles. Se a planilha não
informar bloco, a tela pergunta se o condomínio é de bloco único — nesse caso
cria só os apartamentos — ou se está sendo cadastrado o primeiro bloco — nesse
caso usa **Bloco 1**. As unidades sem bloco aparecem em **Sem bloco** no
gerenciador e ficam disponíveis aos porteiros com acesso a pelo menos um bloco.
As unidades ausentes só entram se a opção correspondente estiver marcada e os
contatos repetidos são ignorados. Andar, e-mail e observações informados na
planilha são gravados. O resultado informa blocos criados, unidades criadas,
moradores criados e duplicatas ignoradas.

A retirada é registrada pelo porteiro após confirmação presencial do morador.
Para confirmar a retirada, o morador assina na tela do celular e o porteiro
confirma que presenciou o ato. Nome, assinatura e confirmação ficam guardados
permanentemente no registro do caderno. A assinatura deve ser coletada com
conhecimento do morador e só é visível às contas autorizadas do condomínio.

O CEP consulta o ViaCEP para preencher o endereço; os campos continuam
editáveis. Na gestão de unidades, selecione o bloco atual para ver seus
apartamentos. Para gerar vários de uma vez, informe a faixa do primeiro andar
e o último andar; por exemplo, `101-107` até o andar `9` gera as faixas de
`101-107` até `901-907`.

Nome e WhatsApp dos moradores são opcionais. Abreviações como `ap`, `apto`,
`apartament` e `apart` são normalizadas para apartamento, e `cob`, `cobe` e
`cobert` para cobertura.

### Leitura de etiqueta: Vision + regras + Groq

O pipeline padrão tem três etapas na Edge Function:

1. **Google Cloud Vision** lê o texto da foto (`DOCUMENT_TEXT_DETECTION`,
   `languageHints: ["pt"]`). É o que lê etiqueta girada e texto miúdo sem
   exigir que o porteiro corrija a foto.
2. **Regras determinísticas** (`parser.ts`) fazem o 1º voto. Rastreio e
   transportadora **nunca** saem da IA — ela confunde NF-e, número de pedido e
   código de entrega, e não é determinística nem com `temperature: 0`.
3. **Groq** (`gpt-oss-120b`) entra só nas exceções: quando nome, unidade ou CEP
   ficaram vazios, ou quando o endereço não conferiu. Ele recebe **apenas o
   texto do OCR**, nunca o endereço do condomínio e nunca a foto. Cada valor
   devolvido precisa aparecer no texto (`grounding.ts`), senão é descartado.

`address_status`/`address_reason` continuam sendo calculados por `address.ts`,
com CEP, logradouro e número cadastrados. A IA nunca decide endereço.

Configure os segredos no projeto do Supabase (o `project-ref` é
`ygtmyjrivavasjfwvioz`):

```powershell
supabase link --project-ref ygtmyjrivavasjfwvioz
supabase secrets set GROQ_API_KEY="$groq"
supabase functions deploy extract-package-label
supabase functions deploy label-lab
```

Para `VISION_SERVICE_ACCOUNT_JSON`, **não** passe o JSON pela linha de comando:
o CLI/PowerShell já corrompeu esse valor uma vez (o segredo chegou com 2302 dos
2346 caracteres e o `JSON.parse` falhou, fazendo a função responder 503). Envie
o arquivo direto pela Management API, sem interpolação de shell:

```powershell
$token = "SEU_ACCESS_TOKEN"
$sa = (Get-Content ".\caminho\fora\do\repo\vision-sa.json" -Raw).Trim()
$body = '[{"name":"VISION_SERVICE_ACCOUNT_JSON","value":' +
  (ConvertTo-Json $sa -Compress) + '}]'
Invoke-RestMethod -Method Post `
  -Uri 'https://api.supabase.com/v1/projects/ygtmyjrivavasjfwvioz/secrets' `
  -Headers @{ Authorization = "Bearer $token" } `
  -ContentType 'application/json' -Body $body
```

Depois de trocar qualquer segredo, **republique as funções** (`supabase functions
deploy extract-package-label` e `supabase functions deploy label-lab`). As duas
usam o mesmo `parser.ts`/`carrier.ts`, mas são bundles separados; redeployar só
uma deixa o laboratório desatualizado. Se o app mostrar "Leitura na nuvem
indisponível", confira em **Diagnóstico da leitura**; o log da função registra
`credencial da Vision ausente` quando o segredo não chegou íntegro.

Também funciona `VISION_API_KEY` (chave de API simples) no lugar do JSON da
service account. Sem nenhuma das duas, a função responde `503` com
`fallback: true`, o app lê apenas o código de barras e pede preenchimento manual.
Se `GROQ_API_KEY` faltar, o app funciona só com regras — o recebimento não para.

O caminho antigo com Gemini fica disponível para comparação A/B:
`supabase secrets set OCR_ENGINE=gemini GEMINI_API_KEY=SUA_CHAVE_AQUI`. Para
voltar ao padrão, remova `OCR_ENGINE` (`supabase secrets unset OCR_ENGINE`).

O tempo total é orçado em 8,5 s: se a Vision consumir quase todo o orçamento,
a etapa de IA é pulada e a função devolve o que as regras encontraram. O
transporte de rastreio e transportadora é sempre determinístico; o app continua
permitindo empresa em branco e rastreio vazio/opcional.

> As credenciais usadas no piloto foram expostas em saída de terminal durante o
> diagnóstico. Gere novas chaves antes de usar em produção e revogue as antigas.

Para reduzir o consumo no piloto, a foto é redimensionada no celular para no
máximo 1280 px no maior lado, JPEG em qualidade 0.80, e a mesma imagem é usada
na IA e no Storage `package-receipts`. Nome/WhatsApp do morador, rastreio e
telefone do entregador continuam opcionais: o porteiro pode registrar com o
endereço em branco (`unknown`), mas divergência confirmada (`mismatch`) exige
checkbox explícito antes de salvar.

Nunca coloque a chave `service_role`, a chave do Gemini ou qualquer segredo no
frontend ou no repositório. As permissões dos dados devem ser protegidas pelo
RLS do Supabase.
