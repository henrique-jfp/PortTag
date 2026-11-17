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
2. Gere a versão de produção com `npm run build` e publique as páginas
   `index.html`, `manager.html` e `porter.html` do diretório `dist` no mesmo
   domínio. As rotas locais são `/`, `/manager.html` e `/porter.html`.
   O app atualmente publicado para teste usa `https://porteiro.henriquedejesus.dev/`,
   `https://porteiro.henriquedejesus.dev/manager.html` e
   `https://porteiro.henriquedejesus.dev/porter.html`. No `pvserver`, ele roda
   como serviço systemd `encomenda-web.service`; o site principal do domínio
   não é substituído.
3. Associe o projeto ao Supabase CLI e publique as funções de gestão de
   porteiros e de leitura de etiqueta:

   ```powershell
   supabase link --project-ref SEU_PROJECT_REF
   supabase functions deploy manage-porter
   supabase secrets set GEMINI_API_KEY=SUA_CHAVE_AQUI
   supabase functions deploy extract-package-label
   ```

   A função `manage-porter` verifica a sessão e o perfil Super Admin no
   servidor. A função `extract-package-label` também exige JWT válido e confirma
   no banco se a conta ativa pertence ao condomínio informado. Ela usa a chave
   do Gemini somente no ambiente da Edge Function. Se a chave não estiver
   configurada, a função responde `503` com `fallback: true` e o app do porteiro
   continua com o OCR local. A chave `service_role` não deve ser adicionada ao
   frontend.

## Criar os acessos

- **Síndico:** crie ou convide a conta de e-mail em Supabase Authentication >
  Users. No app Super Admin, abra **Porteiros** e vincule esse e-mail ao
  condomínio como Síndico. O Síndico entra em `manager.html` com e-mail e
  senha.
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
comprimida no aparelho e a etiqueta é lida primeiro pelo Gemini Vision; se a
nuvem falhar ou não estiver configurada, o QR Code e o texto são processados
localmente como fallback para sugerir destinatário, rastreio, empresa e
unidade. O recebimento é liberado quando o endereço do destinatário confere com
CEP, logradouro e número cadastrados, ou quando a leitura é inconclusiva
(`unknown`) e o porteiro faz a conferência humana. Endereço divergente
(`mismatch`) exige aceite explícito antes de salvar. O porteiro confere o
destinatário, marca se confirmou que é morador, informa o entregador e revisa a
empresa. Se o rastreio confiável não for identificado, pode ser informado
manualmente ou deixado em branco.

O caderno em `manager.html` mostra o calendário do ano vigente e permite
pesquisar por período, dia, apartamento, empresa, porteiro, código de rastreio
e situação. Ele exibe quem recebeu a encomenda, data/hora, morador e quem
confirmou a retirada. Na retirada, o morador assina na tela do celular e o
porteiro confirma que presenciou o ato. A assinatura é mantida
permanentemente no registro, junto com o nome de quem retirou, a data/hora e a
conta do porteiro que confirmou; não é necessário criar conta para o morador.
Avise o morador antes da assinatura de que ela ficará registrada no caderno do
condomínio.

### Aviso ao morador

O canal inicial é manual e não tem custo por mensagem. Depois de registrar a
encomenda, o porteiro toca em **Avisar morador**: o servidor grava o aviso em
`package_notifications`, atualiza `packages.last_notified_at` e o app abre o
WhatsApp da portaria com o texto pronto, usando o WhatsApp cadastrado em
`unit_residents.whatsapp`. Se o apartamento não tiver contato cadastrado, o
aviso é recusado com uma mensagem pedindo o número. O caderno do síndico mostra
a data do último aviso e a foto da etiqueta.

Esse canal não envia sozinho nem confirma entrega: ele padroniza o texto e
deixa rastro de quem foi avisado. Canais automáticos (WhatsApp Cloud API, SMS,
e-mail, push) usam a mesma tabela e entram depois, sem alterar o fluxo do
porteiro.

As fotos ficam em bucket privado e expiram após 20 dias. A expiração só remove
o arquivo; os dados do caderno permanecem. A foto é aberta no caderno por URL
assinada de curta duração e deixa de aparecer depois da limpeza.

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
