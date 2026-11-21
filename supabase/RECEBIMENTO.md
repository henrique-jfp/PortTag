# Recebimento, acessos e caderno

## Preparar o banco e publicar os apps

1. Execute as migrações na ordem indicada no README. A migração
   `20261117010000_porter_accounts_and_ledger.sql` cria contas e atribuições
   por bloco, limita o acesso aos dados do porteiro e adiciona os campos do
   caderno. Em seguida, execute
   `20261117020000_package_collection_signatures.sql` para habilitar assinatura
   e confirmação presencial da retirada. Por fim, execute
   `20261117030000_porter_access_expiration.sql` para habilitar prazos de acesso
   individuais para os porteiros. Execute também
   `20261117040000_condominium_user_created_by.sql` para compatibilizar a coluna
   de auditoria dos vínculos com instalações existentes. Por fim, execute
   `20261117050000_package_recipient_verification.sql` para salvar o nome lido
   da etiqueta e a confirmação do porteiro sobre o vínculo com o apartamento.
   Em seguida, execute `20261117060000_package_notifications.sql` para a fila de
   avisos ao morador, `20261117070000_package_duplicate_tracking.sql` para o
   alerta de rastreio repetido e
   `20261117080000_collection_porter_confirmation.sql` para exigir o aceite do
   porteiro na retirada também no banco. Por último, execute
   `20261117090000_revoke_anon_function_execute.sql` para tirar do papel `anon`
   a execução das funções do schema `public` (as RPCs são todas autenticadas).
   Depois execute
   `20261117190000_allow_webp_collection_signature.sql` para aceitar assinaturas
   WebP além de PNG na confirmação da retirada. Por último, execute
   `20261117200000_confirm_collection_batch.sql` para habilitar a retirada em
   lote: a RPC `confirm_package_collection_batch(uuid[], text, text, boolean)`
   valida todas as encomendas no banco antes de atualizar qualquer uma e grava a
   mesma assinatura, nome, horário e porteiro confirmante em todos os selecionados.
   Execute por último `20261117210000_optional_sender.sql`: ela redefine
   `create_package` para aceitar empresa em branco, mantendo unidade e nome do
   entregador obrigatórios no banco. Depois aplique
   `20261117220000_notification_message.sql` para que o aviso ao morador cite
   o porteiro que recebeu, o rastreio e a retirada já disponível na portaria.
   Execute por último
   `20261118160000_damage_photo_only.sql`: a foto da etiqueta deixa de ser
   armazenada, `create_package` passa a aceitar `p_receipt_path` nulo e exige uma
   foto separada somente quando `p_is_damaged` for verdadeiro. Por último,
   execute `20261118180000_package_drawer_pagination.sql`: cria o índice
   `(condominium_id, unit_id, received_at desc)` e as RPCs paginadas
   `package_daily_counts`, `search_package_drawers` e `search_package_records`.
   Elas usam `security invoker`, então as policies RLS de `packages` continuam
   decidindo o que síndico e porteiro podem ler; não reduza esse isolamento.
    Execute em seguida
    `20261119120000_manager_administration.sql`: amplia as RPCs de cadastro
    para o síndico ativo do próprio condomínio, cria `package_events` (somente
    leitura, alimentada por triggers) e a RPC `manager_package_report`. As
    policies continuam limitando cada síndico ao seu condomínio; o Super Admin
    mantém o acesso global. Após essa migration, rode novamente
    `supabase functions deploy manage-porter` para liberar a gestão de
    porteiros aos síndicos.
    Execute por fim `20261119130000_label_lab_collection.sql`: cria o bucket
    privado `label-lab-private`, a fila `label_lab_queue`, os parâmetros de
    retenção em `label_lab_settings` e a auditoria `label_lab_audit`. Nenhuma
    policy concede escrita a `anon` ou `authenticated`; somente o Super Admin
    lê as tabelas e as Edge Functions escrevem com `service_role`.
    Depois aplique `20261119140000_label_lab_console.sql`: cria
    `label_lab_rulesets` (versões `draft`, `approved`, `published` e
    `superseded`, com regras, regressão, artefato, checksum e amostras de
    origem), amplia as ações em `label_lab_audit` e adiciona as RPCs
    `enqueue_label_lab_manual_sample`, `discard_label_lab_sample`,
    `save_label_lab_ruleset`, `approve_label_lab_ruleset` e
    `publish_label_lab_ruleset`. Aprovar apenas registra o aceite com o texto
    `APROVAR` e a regressão verde. Publicar exige `PUBLICAR` e a
    exclusão/sanitização das amostras usadas pela RPC
    `purge_label_lab_samples_for_ruleset`, reexecutada para cobrir amostras que
    entraram depois. Nenhuma regra altera CEP, logradouro ou número.
    Aplique por fim `20261119150000_fix_label_lab_storage_deletion.sql`:
    redefine `discard_label_lab_sample` e
    `purge_label_lab_samples_for_ruleset` para habilitar
    `storage.allow_delete_query` apenas no escopo da transação, já que o
    trigger `storage.protect_delete` bloqueia `DELETE` direto em
    `storage.objects`. Sem ela, descarte e publicação falham com HTTP 400.
    Aplique também `20261119160000_delete_label_lab_ruleset.sql`: cria a RPC
    `delete_label_lab_ruleset`, restrita a rascunhos e ao Super Admin, com
    auditoria `ruleset_deleted`. Versões aprovadas, publicadas ou superseded
    não podem ser excluídas e as amostras de origem são mantidas.
    Aplique por último `20261119170000_label_lab_active_rules.sql`: cria
    `label_lab_active_rules` e a RPC anônima `get_active_label_lab_rules`,
    redefine `publish_label_lab_ruleset` para gravar o artefato na linha ativa
    no mesmo commit e cria `activate_label_lab_ruleset` para reverter para uma
    versão publicada. O extrator de produção e o fallback local leem essa RPC;
    se ela falhar, o parser embutido continua valendo. A v1 já publicada é
    migrada automaticamente para a linha ativa. Nenhuma regex altera CEP,
    logradouro ou número.
    Aplique em seguida `20261119200000_condominium_whatsapp_evolution.sql`:
    instâncias por condomínio na Evolution API e roteamento das notificações
    entre envio automático (`whatsapp`) e o link manual (`whatsapp_link`).
    Depois execute `20261119210000_condominium_access_duration.sql`: cria
    `condominiums.access_expires_at` e `access_duration`, redefine
    `is_condominium_admin` e `can_access_condominium_block` para exigirem o
    prazo ativo e cria `condominium_access_is_active` e
    `update_condominium_access` (renovação só do Super Admin). As opções são
    `7d`, `14d`, `1m`, `3m`, `6m`, `1y` e `none`; a expiração é sempre calculada
    no servidor a partir de `now()`. Por fim, execute
    `20261119220000_residents_import.sql`, que cria a RPC
    `import_condominium_residents` para a importação de planilha de moradores.
    Por fim, execute `20261120140000_preserve_label_lab_ocr.sql`: a publicação
    continua apagando a foto privada, mas preserva o OCR da amostra para que os
    casos de regressão das versões antigas possam ser re-testados.
    Depois, execute `20261120150000_create_resident_on_package_reception.sql`:
    quando o porteiro confirma que o destinatário é morador do apartamento, cria
    o morador automaticamente na unidade se ainda não constar.
    Por fim, execute `20261120160000_set_condominium_status.sql`: cria a RPC
    `set_condominium_status`, exclusiva do Super Admin, usada pelo botão
    **Ativo**/**Inativo** no cartão do condomínio. Ela suspende ou reativa o
    acesso sem apagar nenhum dado; renovar o prazo não reativa um condomínio
    inativo. Com o prazo vencido ou o condomínio inativo, síndico e porteiro
    ficam presos à tela inicial com aviso de contato com o suporte técnico: o
    bloqueio vale para RLS, RPCs e Edge Functions (`manage-manager` e
    `manage-porter` devem ser redeployadas), e o Super Admin mantém o acesso. A
    importação é permitida
    ao Síndico e ao Super Admin, nunca ao Porteiro; a RPC é atômica e devolve
    `units_created`, `residents_created` e `duplicates_skipped`.
    Depois execute `20261120170000_bulk_package_notifications.sql`: cria o
    vínculo dos volumes de um aviso em lote e a RPC que agrupa, por apartamento,
    os pacotes importados juntos. Em seguida faça deploy novamente de
    `send-package-notification`, para atualizar todos os volumes agrupados após
    um envio automático bem-sucedido. Por fim, execute
    `20261120180000_reset_condominium_data.sql`: cria a tabela de auditoria
    `condominium_reset_audit` e as RPCs `get_condominium_reset_preview` e
    `reset_condominium_data`, usadas pelo botão **Zerar dados** do Super Admin.
    A RPC apaga encomendas, eventos, avisos, moradores, unidades, blocos,
    porteiros, vínculos, amostras do Label Lab e os arquivos dos buckets
    `package-receipts`/`label-lab-private` daquele condomínio, mas mantém o
    cadastro e as regras publicadas. Exige nome exato e aceite do aviso; contas
    de login e a instância externa da Evolution não são removidas.
2. Gere a versão de produção com `npm run build` e publique as páginas
   `index.html`, `manager.html` e `porter.html` do diretório `dist` no mesmo
   domínio. As rotas locais são `/`, `/manager.html` e `/porter.html`.
   O app atualmente publicado para teste usa `https://porteiro.henriquedejesus.dev/`,
   `https://porteiro.henriquedejesus.dev/manager.html` e
   `https://porteiro.henriquedejesus.dev/porter.html`. No `pvserver`, ele roda
   como serviço systemd `encomenda-web.service`; o site principal do domínio
   não é substituído.
3. Associe o projeto ao Supabase CLI e publique as funções de gestão de
   porteiros, de gestão de síndicos e de leitura de etiqueta:

   ```powershell
   supabase link --project-ref SEU_PROJECT_REF
   supabase functions deploy manage-porter
   supabase functions deploy manage-manager
   $groq = (Get-Content ".\caminho\fora\do\repo\groq-key.txt" -Raw).Trim() -replace '^GROQ_API_KEY=', ''
   supabase secrets set GROQ_API_KEY="$groq"
   # O JSON da service account deve ir pela Management API: passá-lo como
   # argumento do CLI corrompe o valor e a função responde 503.
   $token = "SEU_ACCESS_TOKEN"
   $sa = (Get-Content ".\caminho\fora\do\repo\vision-sa.json" -Raw).Trim()
   $body = '[{"name":"VISION_SERVICE_ACCOUNT_JSON","value":' +
     (ConvertTo-Json $sa -Compress) + '}]'
   Invoke-RestMethod -Method Post `
     -Uri 'https://api.supabase.com/v1/projects/SEU_PROJECT_REF/secrets' `
     -Headers @{ Authorization = "Bearer $token" } `
     -ContentType 'application/json' -Body $body
   supabase functions deploy extract-package-label
   ```

   Para o laboratório de etiquetas (opcional, usado antes do lançamento para
   mapear novos modelos), configure um segredo próprio e publique a função.
   Ela usa `verify_jwt = false` e exige o cabeçalho `x-label-lab-secret`:

   ```powershell
   npx supabase secrets set LABEL_LAB_SECRET="ESCOLHA_UMA_SENHA_LONGA"
   npx supabase functions deploy label-lab --yes
   ```

   O uso está documentado em `scripts/label-lab/MANUAL.md`. A função não salva
   fotos nem gera arquivos no servidor.

   Para habilitar a coleta invisível do Label Lab, publique as três funções
   abaixo. `collect-label-sample` exige JWT e usa a sessão do porteiro; as
   outras duas são chamadas pelo cron com segredos próprios:

   ```powershell
   supabase functions deploy collect-label-sample
   supabase secrets set LABEL_LAB_SECRET="O_MESMO_SEGREDO_DO_LABORATORIO"
   $workerSecret = "ESCOLHA_UMA_SENHA_LONGA"
   $cleanupSecret = "ESCOLHA_OUTRA_SENHA_LONGA"
   supabase secrets set LABEL_LAB_WORKER_SECRET="$workerSecret"
   supabase secrets set LABEL_LAB_CLEANUP_SECRET="$cleanupSecret"
   supabase functions deploy process-label-lab-queue
   supabase functions deploy cleanup-label-lab
   ```

   `LABEL_LAB_SECRET` já protege `label-lab`; o worker precisa dele para chamar
   o laboratório internamente. Não coloque nenhum desses segredos nem a chave
   `service_role` em `src/` ou no repositório. O envio da amostra acontece
   depois do OCR, sem segunda leitura de imagem, e falhas de rede são
   ignoradas pelo app.

   A Central do Label Lab usa esse mesmo `LABEL_LAB_SECRET` e a Edge Function
   `admin-label-lab`, que exige JWT e perfil de Super Admin:

   ```powershell
   supabase functions deploy admin-label-lab
   ```

   As funções `manage-porter` e `manage-manager` verificam a sessão no servidor.
   `manage-manager` exige perfil Super Admin; `manage-porter` aceita também o
   vínculo de síndico ativo e limita cada ação ao condomínio correspondente. A função `extract-package-label` também exige JWT válido e confirma
   no banco se a conta ativa pertence ao condomínio informado. O pipeline padrão
   lê o texto com Google Cloud Vision, aplica regras determinísticas e só chama
   o Groq nas exceções (nome/unidade/endereço vazios ou divergentes), com cada
   valor conferido como substring do OCR. Rastreio e transportadora vêm sempre
   das regras; a decisão de endereço é calculada no servidor. Sem credencial da
   Vision a função responde `503` com `fallback: true` e o app do porteiro
   o app lê só o código de barras e pede preenchimento manual de unidade, morador e endereço. Para comparar com o caminho antigo, use
   `supabase secrets set OCR_ENGINE=gemini GEMINI_API_KEY=...` e depois remova a
   flag. A chave `service_role` não deve ser adicionada ao frontend.

## Criar os acessos

- **Síndico:** no app Super Admin, abra a seção **Criar síndico**, selecione o
  condomínio, informe nome e e-mail pessoal e clique em **Criar síndico e gerar
  senha**. A senha temporária de 8 caracteres aparece uma única vez; anote e
  entregue ao síndico. Ele entra em `manager.html` com esse e-mail e senha. Se a
  conta de e-mail já existir no Supabase Authentication, use **Vincular síndico
  existente** — nesse caso a senha é a da conta existente. Na lista de síndicos,
  **Nova senha** gera outra senha temporária, **Reativar e gerar senha** devolve
  o acesso e **Remover acesso** desativa o vínculo com o condomínio.
- **Porteiro:** no mesmo painel, selecione o condomínio, informe nome e
  usuário, marque um ou mais blocos de trabalho e escolha o prazo de acesso:
  sem expiração, 7 dias a partir do cadastro ou uma data/hora personalizada.
  Sem prazo é a opção padrão; o Super Admin pode revogar o acesso a qualquer
  momento. Quando o prazo vence, as políticas do banco bloqueiam o acesso aos
  dados do porteiro, inclusive se ele ainda tiver uma sessão aberta. O sistema
  cria a conta e mostra uma senha temporária uma única vez. Entregue-a ao
  porteiro; se for perdida, redefina-a no painel e compartilhe a nova senha.

O Porteiro entra em `porter.html` com usuário e senha. A tela é mobile-first e
usa o botão **Tirar foto** para abrir a câmera traseira do celular. A foto é
comprimida no aparelho e a etiqueta é lida primeiro pelo Google Cloud Vision;
se a nuvem falhar ou não estiver configurada, o QR Code e o texto são processados
localmente como fallback para sugerir destinatário, rastreio, empresa e
unidade. A IA somente extrai campos: a decisão `verified` / `mismatch` /
`unknown` é recalculada no servidor comparando CEP, logradouro e número com o
cadastro do condomínio — por isso o CEP cadastrado precisa estar correto. O
recebimento é liberado quando o endereço do destinatário confere com
CEP, logradouro e número cadastrados, ou quando a leitura é inconclusiva
(`unknown`) e o porteiro faz a conferência humana. Endereço divergente
(`mismatch`) exige aceite explícito antes de salvar. O porteiro confere o
destinatário, marca se confirmou que é morador e informa o entregador. A
empresa é opcional. Se o rastreio confiável não for identificado, pode ser informado
manualmente ou deixado em branco.

O caderno em `manager.html` mostra o calendário do ano vigente e permite
pesquisar por período, dia, apartamento, empresa, porteiro, código de rastreio
e situação. O resultado aparece como **gavetas de apartamento**, paginadas no
servidor (12 por página). Ao abrir uma gaveta, os recebimentos daquele
apartamento vêm do mais recente ao mais antigo, com 12 registros por página e
ordenação por dia, rastreio ou entregador/loja. O detalhe de cada recebimento
mostra quem recebeu, data/hora, morador, estado na chegada e quem confirmou a
retirada; a assinatura é carregada só quando você pede para vê-la. Na retirada, o morador assina na tela do celular e o
porteiro confirma que presenciou o ato. A assinatura é mantida
permanentemente no registro, junto com o nome de quem retirou, a data/hora e a
conta do porteiro que confirmou; não é necessário criar conta para o morador.
Avise o morador antes da assinatura de que ela ficará registrada no caderno do
condomínio.

### Importação em massa e retirada em lote

Na tela inicial do porteiro, **Importar várias fotos** aceita várias etiquetas
da galeria de uma vez. O entregador padrão pode ser preenchido antes de
começar; a empresa é opcional. A fila processa **uma foto por vez**: cada imagem é comprimida uma
única vez no aparelho, lida pela nuvem e salva separadamente
com sua própria foto no Storage. O progresso mostra quantas foram registradas,
quantas estão na fila, quantas precisam de revisão e quantas falharam. É
possível cancelar a fila, tentar novamente um item com erro e revisar os itens
que ficaram sem unidade, entregador ou com endereço divergente; a empresa pode
ficar em branco. No painel de revisão é possível corrigir apartamento e
entregador antes de salvar.
Rastreio repetido tem confirmação própria: só é registrado depois que o
porteiro confirma que se trata de outro volume. Cada item salvo tem seu próprio
link `wa.me` para avisar o morador.

Para a retirada, ao tocar em **Registrar retirada**, o porteiro vê todos os
pacotes `received` do mesmo condomínio/bloco/unidade já marcados e pode
desmarcar os que não foram retirados. Uma única assinatura é copiada em cada
pacote selecionado, junto com o mesmo nome de quem retirou, o mesmo horário e a
conta do porteiro que confirmou. A operação é atômica (máximo de 50 pacotes):
se qualquer pacote não estiver mais na portaria ou pertencer a outro
apartamento, nada é alterado e o porteiro deve atualizar a lista. O aviso ao
morador continua manual: o link de WhatsApp pode ser gerado no ato do
recebimento ou depois, enquanto a encomenda estiver na portaria. Quando o
apartamento não tem mais nada pendente, o botão de avisar não aparece.

### Aviso ao morador

O canal inicial é manual e não tem custo por mensagem. No recebimento, o
porteiro confirma que recebeu a encomenda do entregador e pode marcar
**Quero avisar o morador no WhatsApp**: o servidor grava o aviso em
`package_notifications`, atualiza `packages.last_notified_at` e o app abre o
WhatsApp da portaria com o texto pronto, usando o WhatsApp cadastrado em
`unit_residents.whatsapp`. O texto cita o porteiro que recebeu (gravado em
`packages.received_by`), o código de rastreio e que a encomenda já pode ser
retirada. Se o apartamento não tiver contato cadastrado, o aviso é recusado com
uma mensagem pedindo o número. O caderno do síndico mostra a data do último
aviso e, quando houver, a foto da avaria.

Esse canal não envia sozinho nem confirma entrega: ele padroniza o texto e
deixa rastro de quem foi avisado. Canais automáticos (WhatsApp Cloud API, SMS,
e-mail, push) usam a mesma tabela e entram depois, sem alterar o fluxo do
porteiro.

A foto da etiqueta é usada apenas na leitura e não é salva. Quando o porteiro
marca **Pacote chegou avariado**, ele tira uma foto do volume inteiro; essa é a
única imagem guardada, em bucket privado, e expira após 20 dias. A limpeza só
remove o arquivo; os dados do caderno permanecem. A foto é aberta no caderno por
URL assinada de curta duração e deixa de aparecer depois da limpeza.

## Publicar a limpeza automática das fotos

1. Publique a Edge Function:

   ```powershell
   supabase functions deploy cleanup-package-receipts
   ```

   O arquivo `supabase/config.toml` desativa a verificação JWT dessa função
   porque o cron a autentica com um segredo próprio.
2. Gere um segredo aleatório forte. No Supabase, adicione esse valor como
   `PACKAGE_PHOTO_CLEANUP_SECRET` em Edge Functions > Secrets. A URL do projeto
   e a chave service role são fornecidas pelo ambiente da Edge Function; não
   coloque a chave service role no app nem no repositório.
3. No SQL Editor, armazene a URL do projeto e o mesmo segredo no Vault. Substitua
   os dois valores entre aspas antes de executar; faça isso uma única vez:

   ```sql
   select vault.create_secret(
     'https://SEU_PROJECT_REF.supabase.co',
     'package-cleanup-project-url'
   );
   select vault.create_secret(
     'O_MESMO_SEGREDO_CONFIGURADO_NA_EDGE_FUNCTION',
     'package-cleanup-secret'
   );
   ```

4. Abra `supabase/schedules/cleanup-package-receipts.sql`, substitua
   `REPLACE_WITH_SUPABASE_PUBLISHABLE_OR_ANON_KEY` pela chave pública (publishable
   ou anon) do projeto e execute o SQL no editor. O job chama a função a cada
   hora. Não substitua o placeholder no arquivo versionado por uma chave real.
5. Confira a criação do job:

   ```sql
   select jobname, schedule
   from cron.job
   where jobname = 'cleanup-package-receipts';
   ```

Se o projeto não tiver `pg_cron`, `pg_net` ou Vault habilitados, habilite as
extensões disponíveis no painel Supabase antes de executar o script de
agendamento. A limpeza ainda não é automática até a função e o job estarem
publicados e configurados.

## Publicar a análise e a retenção do Label Lab

A coleta invisível depende de três jobs/segredos além dos do caderno. O projeto
já precisa ter o Vault configurado para a limpeza de fotos de avaria; os scripts
reaproveitam o segredo `package-cleanup-project-url` como URL do projeto.

1. Publique `process-label-lab-queue` e `cleanup-label-lab` (comandos na seção
   de deploy). O arquivo `supabase/config.toml` desativa o JWT nessas duas
   funções porque o cron usa `x-cron-secret`.
2. Guarde os dois segredos no Vault, com os mesmos valores usados em
   `LABEL_LAB_WORKER_SECRET` e `LABEL_LAB_CLEANUP_SECRET`:

   ```sql
   select vault.create_secret(
     'O_MESMO_VALOR_DE_LABEL_LAB_WORKER_SECRET',
     'label-lab-worker-secret'
   );
   select vault.create_secret(
     'O_MESMO_VALOR_DE_LABEL_LAB_CLEANUP_SECRET',
     'label-lab-cleanup-secret'
   );
   ```

3. Abra `supabase/schedules/process-label-lab-queue.sql` e
   `supabase/schedules/cleanup-label-lab.sql`, substitua
   `REPLACE_WITH_SUPABASE_PUBLISHABLE_OR_ANON_KEY` pela chave pública
   (publishable ou anon) do projeto e execute ambos no SQL Editor. O worker roda
   a cada 10 minutos; a limpeza, a cada hora. Não substitua o placeholder nos
   arquivos versionados.
4. Confira os jobs:

   ```sql
   select jobname, schedule
   from cron.job
   where jobname in ('process-label-lab-queue', 'cleanup-label-lab');
   ```

A retenção padrão é de 7 dias para amostras pendentes e 15 dias para amostras
em análise/analisadas; registros `discarded` ou `published` são removidos na
primeira limpeza. O Super Admin pode ajustar os prazos e desativar a coleta sem
migration:

```sql
select public.update_label_lab_settings(
  p_collection_enabled => true,
  p_pending_retention_days => 7,
  p_processing_retention_days => 15,
  p_max_attempts => 3
);
```

A limpeza apaga o arquivo do bucket, zera `ocr_text`, rastreio, resultado
parseado, diagnóstico e análise, e grava apenas metadados em
`label_lab_audit`. Fotos órfãs (upload concluído sem tarefa persistida) também
são reconciliadas. Este pipeline apenas prepara e conserva a evidência por
tempo limitado; a publicação de regex depende da Central do Label Lab,
descrita abaixo.

## Central do Label Lab

A Central fica no app Super Admin: o atalho **Label Lab** no painel abre
`/label-lab` (em `index.html`). A tela importa até 6 fotos e envia cada uma à
Edge Function `admin-label-lab`. **Analisar** mostra o OCR e as sugestões sem
guardar nada; **Salvar como amostra** grava a imagem no bucket privado
`label-lab-private` e cria a tarefa na fila. As amostras vindas do porteiro
também aparecem na lista e podem ser reanalisadas ou descartadas.

O fluxo de calibração é: analisar → incluir sugestões no editor de regex →
criar casos de regressão a partir das amostras → **Testar** (a regex roda
contra o OCR salvo e já grava um rascunho) → **Salvar rascunho** → **Aprovar**
→ **Publicar**. **Aprovar** exige o texto `APROVAR` e a regressão verde, apenas
registrando o aceite. **Publicar** exige `PUBLICAR` e a exclusão/sanitização das
amostras usadas por `purge_label_lab_samples_for_ruleset`, reexecutada para
cobrir amostras que entraram depois; o artefato JSON versionado fica disponível
para download. Nenhuma regra altera CEP, logradouro ou número — a decisão de
endereço continua determinística no banco.

`admin-label-lab` roda com `verify_jwt = true`: valida o JWT, exige
`profiles.is_super_admin`, chama `label-lab` com o segredo já existente
`LABEL_LAB_SECRET`, lê as fotos do bucket privado e chama as RPCs
`enqueue_label_lab_manual_sample`, `discard_label_lab_sample`,
`save_label_lab_ruleset`, `approve_label_lab_ruleset` e
`publish_label_lab_ruleset`. Nenhum segredo é exposto ao frontend. A coleta e a
limpeza automática seguem nos schedules já publicados; não crie segredos nem
jobs novos.

### Publicar

1. Aplique as migrations `20261119140000_label_lab_console.sql`,
   `20261119150000_fix_label_lab_storage_deletion.sql`,
   `20261119160000_delete_label_lab_ruleset.sql` e
   `20261119170000_label_lab_active_rules.sql` no SQL Editor e execute
   `supabase functions deploy admin-label-lab`,
   `supabase functions deploy extract-package-label` e
   `supabase functions deploy label-lab`. As duas últimas precisam ser
   redeployadas porque agora leem as regras ativas em runtime; depois disso,
   publicar uma versão na Central não exige mais deploy.
2. Mantenha `LABEL_LAB_SECRET`, `LABEL_LAB_WORKER_SECRET`,
   `LABEL_LAB_CLEANUP_SECRET` e os schedules `process-label-lab-queue` e
   `cleanup-label-lab` como estão.
3. Antes de publicar o frontend, rode `npm test`, `npm run lint` e
   `npm run build`. Após commit/push, publique as páginas com o script
   `scripts/deploy-pvserver.sh` descrito no README.
