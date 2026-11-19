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
Nada disso publica regex: a aprovação e a versão do artefato ainda serão
manuais. Os detalhes de segredos e agendamentos estão em
[`supabase/RECEBIMENTO.md`](./supabase/RECEBIMENTO.md).

### Acesso pelo celular (tela inicial)

Para abrir sem a barra de endereço, instale como app — não use “Adicionar
atalho”, que cria apenas um link para o navegador:

1. Abra `https://porteiro.henriquedejesus.dev/porter.html` no Chrome/Android.
2. Toque na página e espere alguns segundos. Quando o Chrome considerar o app
   instalável, aparece **Instalar app** no cabeçalho; toque e confirme.
   Alternativamente, use o menu do Chrome → **Instalar app** (e não
   **Adicionar atalho**).
3. No Safari/iOS, use **Compartilhar → Adicionar à Tela de Início**.

O manifest `public/manifest-porter.webmanifest` define `display: standalone`, o
nome "PortTag" e os ícones de 192/512 px; no iOS, as metas
`apple-mobile-web-app-*` fazem o mesmo. Depois da instalação o app mostra a
orientação para colocar o ícone na tela inicial: em vários Android o app
instalado vai para a **gaveta de apps** e não aparece sozinho na tela inicial.
Nesse caso, abra a gaveta, procure **PortTag**, toque e segure no ícone e
escolha **Adicionar à tela inicial**. O site não consegue fazer isso
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
`PUBLICAR`, exige a exclusão/sanitização das amostras usadas por
`purge_label_lab_samples_for_ruleset` — a purga é reexecutada para cobrir
amostras que entraram depois. As regras nunca tocam CEP, logradouro ou número:
a decisão de endereço permanece determinística no servidor.

### Central do Label Lab

O atalho **Label Lab** no painel do Super Admin abre `/label-lab` (em
`index.html`). A tela importa até 6 fotos: **Analisar** mostra o OCR e as
sugestões sem guardar nada, e **Salvar como amostra** envia a imagem ao bucket
privado e à fila. As amostras coletadas pelo porteiro também aparecem na lista
e podem ser reanalisadas ou descartadas.

Para calibrar, adicione sugestões ao editor de regex, crie casos de regressão
a partir das amostras, rode **Testar**, salve o rascunho, aprove e publique.
**Aprovar** pede o texto `APROVAR` e a regressão verde, apenas registrando o
aceite. **Publicar** pede `PUBLICAR`, exige a exclusão/sanitização das amostras
usadas por `purge_label_lab_samples_for_ruleset` (a purga é reexecutada para
alcançar amostras que entraram depois) e disponibiliza o artefato JSON
versionado para download. Nenhuma regra publicada altera CEP, logradouro ou
número.

A Edge Function `admin-label-lab` (`verify_jwt = true`) valida o JWT, exige
`profiles.is_super_admin`, chama `label-lab` com o segredo já existente
`LABEL_LAB_SECRET`, lê as fotos do bucket privado e chama as RPCs; nenhum
segredo chega ao frontend. Para implantar, aplique as migrations
`20261119140000_label_lab_console.sql` e
`20261119150000_fix_label_lab_storage_deletion.sql` (esta última habilita a
exclusão das fotos nas RPCs de descarte e purga, exigida pelo trigger
`storage.protect_delete`) e publique a função:

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
condomínio e os blocos de trabalho. No campo **Prazo de acesso**, escolha sem
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

O app do Porteiro é mobile-first: tira a foto com a câmera do celular e comprime
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
em CSV, **Moradores** filtra unidades sem WhatsApp cadastrado e **Porteiros**
mostra o último registro de cada operador. **Estrutura** reúne **Dados e
Endereço** e **Blocos e Unidades**; ao alterar o endereço, o painel pede
confirmação explícita porque ele alimenta a conferência determinística das
etiquetas. Nenhuma dessas melhorias exige migration adicional.

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
