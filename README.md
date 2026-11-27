# PortTag — Controle de Encomendas

Sistema web para receber, avisar, guardar e entregar encomendas em
condomínios. Tem três aplicações independentes que compartilham o mesmo banco
Supabase:

| Aplicação | Página | Para quem | O que faz |
| --- | --- | --- | --- |
| Super Admin | `index.html` (`/`) | Responsável pela plataforma | Cadastra condomínios, prazos, equipe, consulta o caderno global e opera o Label Lab |
| Síndico | `manager.html` | Síndico ou administrador do condomínio | Acompanha indicadores, encomendas, relatórios, moradores, porteiros, estrutura e WhatsApp |
| Porteiro | `porter.html` | Portaria | Registra recebimentos (unitário, lote ou rajada), avisa moradores, registra retiradas e consulta o caderno |

Os manuais de uso ficam em:

- [`docs/PITCH-COMERCIAL.md`](./docs/PITCH-COMERCIAL.md) — briefing de apresentação comercial
- [`docs/MANUAL-SUPER-ADMIN.md`](./docs/MANUAL-SUPER-ADMIN.md)
- [`docs/MANUAL-SINDICO.md`](./docs/MANUAL-SINDICO.md)
- [`docs/MANUAL-PORTEIRO.md`](./docs/MANUAL-PORTEIRO.md)
- [`docs/MANUAL-REGEX-LABEL-LAB.md`](./docs/MANUAL-REGEX-LABEL-LAB.md)

## Acessos e sessões

No desenvolvimento (`npm run dev`):

- Super Admin: `http://localhost:5173/`
- Síndico: `http://localhost:5173/manager.html`
- Porteiro: `http://localhost:5173/porter.html`

Em produção: `https://porteiro.henriquedejesus.dev/`, `/manager.html` e
`/porter.html`. Publique as três páginas no mesmo domínio.

O login também é diferente por perfil:

- **Super Admin e Síndico** entram com e-mail e senha.
- **Porteiro** entra com **usuário** e senha. O app converte o usuário para o
  e-mail sintético `porter-<usuario>@porter.invalid` antes de autenticar.

Cada app guarda a sessão em uma chave própria (`data-app` no HTML):
`encomenda-manager-auth` e `encomenda-porter-auth`; o Super Admin usa a chave
padrão. Por isso, entrar em um app não derruba a sessão do outro no mesmo
navegador.

## Requisitos e instalação

- Node.js e npm
- Projeto Supabase com as migrations aplicadas

```powershell
npm ci
Copy-Item .env.example .env.local
# edite .env.local com VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY
npm run dev
```

Não há OCR local nem passo de preparação de assets: a leitura da etiqueta é
feita na Edge Function `extract-package-label`. Sem rede, o app só consegue ler
o código de barras.

### Verificação antes de publicar

```powershell
npm test
npm run lint
npm run build
```

- `npm test` roda `vitest run`. As fixtures de `src/lib/__fixtures__/labels.ts`
  são quatro etiquetas reais transcritas (Amazon, Shopee, Correios e Mercado
  Livre). Elas medem a decisão de endereço — o que confirma e o que bloqueia —
  não a qualidade do OCR, que depende da foto.
- `npm run lint` roda `oxlint`.
- `npm run build` roda `tsc -b && vite build` e gera `index.html`,
  `manager.html` e `porter.html` em `dist/`.

Não há workflow de CI; a verificação é manual, nesta ordem.

## Publicação no pvserver

O código-fonte fica em `/home/pvserver/encomenda-app/source`; `current` aponta
para uma release pronta em `releases`. Depois de `git commit` e `git push` para
`main`:

```powershell
ssh pvserver "cd /home/pvserver/encomenda-app/source && bash scripts/deploy-pvserver.sh"
```

O script faz `git pull --ff-only`, instala dependências pelo lockfile, gera o
build, valida as três páginas, cria uma release separada e
troca `current` atomicamente. Se a verificação HTTP falhar, restaura a release
anterior. O serviço `encomenda-web.service` não precisa ser reiniciado.

Na primeira configuração, clone o repositório em
`/home/pvserver/encomenda-app/source` e crie ali um `.env.local` com
`VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`. Nunca versione chaves reais.

### Instalação como app no celular

Abra `/porter.html` ou `/manager.html` no Chrome/Android e use **Instalar
app** (não “Adicionar atalho”). No Safari/iOS, use **Compartilhar → Adicionar à
Tela de Início**. Os manifests `public/manifest-porter.webmanifest` e
`public/manifest-manager.webmanifest` definem `display: standalone`, os nomes
“Portaria” e “Síndico” e os ícones PortTag. O service worker `public/sw.js`
pré-carrega manifestos e ícones e guarda cópias dos assets estáticos; as
navegações vão sempre à rede. Dados e OCR continuam exigindo conexão. A câmera
exige HTTPS — o domínio publicado já é HTTPS.

## Supabase

Projeto de produção: `ygtmyjrivavasjfwvioz`.

### Migrations

Aplique no SQL Editor **na ordem abaixo**. Várias funções são redefinidas com
`create or replace` ao longo do caminho: a última definição é a que vale.

1. `20261116000000_condominiums_foundation.sql`
2. `20261116221500_condominium_blocks.sql`
3. `20261116223000_condominium_units_management.sql`
4. `20261116225500_unit_residents_and_bulk_units.sql`
5. `20261117000000_package_reception.sql`
6. `20261117010000_porter_accounts_and_ledger.sql`
7. `20261117020000_package_collection_signatures.sql`
8. `20261117030000_porter_access_expiration.sql`
9. `20261117040000_condominium_user_created_by.sql`
10. `20261117050000_package_recipient_verification.sql`
11. `20261117060000_package_notifications.sql`
12. `20261117070000_package_duplicate_tracking.sql`
13. `20261117080000_collection_porter_confirmation.sql`
14. `20261117090000_revoke_anon_function_execute.sql`
15. `20261117190000_allow_webp_collection_signature.sql`
16. `20261117200000_confirm_collection_batch.sql`
17. `20261117210000_optional_sender.sql`
18. `20261117220000_notification_message.sql`
19. `20261118160000_damage_photo_only.sql`
20. `20261118180000_package_drawer_pagination.sql`
21. `20261119120000_manager_administration.sql`
22. `20261119130000_label_lab_collection.sql`
23. `20261119140000_label_lab_console.sql`
24. `20261119150000_fix_label_lab_storage_deletion.sql`
25. `20261119160000_delete_label_lab_ruleset.sql`
26. `20261119170000_label_lab_active_rules.sql`
27. `20261119200000_condominium_whatsapp_evolution.sql`
28. `20261119210000_condominium_access_duration.sql`
29. `20261119220000_residents_import.sql`
30. `20261120140000_preserve_label_lab_ocr.sql`
31. `20261120150000_create_resident_on_package_reception.sql`
32. `20261120160000_set_condominium_status.sql`
33. `20261120170000_bulk_package_notifications.sql`
34. `20261120180000_reset_condominium_data.sql`
35. `20261121000000_optional_block_import.sql`
36. `20261121010000_import_creates_blocks.sql`
37. `20261121120000_resident_import_extra_fields.sql`
38. `20261121130000_bulk_package_reception.sql`
39. `20261121140000_gatehouse_operation.sql`
40. `20261121150000_gatehouse_scoped_queries.sql`
41. `20261121160000_notebook_retention_and_reset.sql`
42. `20261121170000_reset_label_lab_queue.sql`
43. `20261122000000_burst_package_reception.sql`
44. `20261124000000_dashboard_query_indexes.sql`
45. `20261124100000_package_card_filters.sql`
46. `20261124110000_fix_utf8_function_literals.sql`
47. `20261127000000_fix_unit_creation_and_delete_block.sql`

Pontos que costumam passar batido:

- A migration 21 delega ao síndico ativo, **somente no próprio condomínio**, as
  RPCs de cadastro e cria a auditoria `package_events` e a RPC
  `manager_package_report`. O Super Admin continua com acesso a todos.
- A 28 calcula o prazo de acesso no banco (`now()`); o app nunca envia a data.
  A 32 permite suspender/reativar o condomínio sem apagar dados.
- A 33 agrupa avisos por apartamento; a 38 prepara o recebimento em lote (até 50
  fotos); a 43 grava a rajada volume a volume e consolida o aviso ao finalizar.
- A 44 cria índices para as contagens e amostras do painel e da tela inicial do
  porteiro. Ela não muda dados nem regras: só evita varrer o caderno inteiro em
  condomínios com histórico longo.
- A 45 acrescenta `arg_without_notice` e `arg_active_damage` às RPCs do caderno.
  É o que permite o clique nos cards "Sem aviso ao morador" e "Avarias e fotos"
  abrir a lista já filtrada; os mesmos critérios viraram filtros visíveis no
  caderno.
- A 46 reescreve com acentuação correta oito funções cujos literais haviam sido
  gravados como U+FFFD em aplicações antigas. Sem ela, "Por unidade" mostrava
  `1 ? 1006` em vez de `1 · 1006`; também afeta mensagens como "Não informado".
- A 39 cria a entidade `portarias`, os três modelos de operação e a permissão
  por portaria atual. A 40 restringe as consultas por bloco. A 41 cria a
  limpeza do caderno por retenção e ajusta o “Zerar dados”.
- A 47 permite criar e editar unidades **sem bloco** mesmo em condomínios que
  usam blocos: apenas um bloco informado é validado, sem exigência gerada por
  `block_count`. Ela também cria `delete_condominium_block`, usada pelo botão
  **Excluir** de cada bloco; a RPC recusa a exclusão enquanto houver unidades
  ou encomendas vinculadas.

### Edge Functions

```powershell
supabase link --project-ref ygtmyjrivavasjfwvioz
supabase functions deploy <nome>
```

| Função | `verify_jwt` | Papel |
| --- | --- | --- |
| `extract-package-label` | true | OCR da etiqueta (Vision + regras + Groq) |
| `label-lab` | false | Pipeline do laboratório, autenticado por `LABEL_LAB_SECRET` |
| `collect-label-sample` | true | Coleta invisível de amostras pelo app do porteiro |
| `process-label-lab-queue` | false | Worker da fila do Label Lab |
| `cleanup-label-lab` | false | Apaga fotos e sanitiza OCR após a retenção |
| `admin-label-lab` | true | Central do Label Lab no Super Admin |
| `manage-porter` | true | Cria/gerencia acesso de porteiro |
| `manage-manager` | true | Cria/gerencia acesso de síndico |
| `manage-condominium-whatsapp` | true | Conecta/desconecta a instância Evolution e envia teste |
| `send-package-notification` | true | Envia o aviso automático pela Evolution |
| `cleanup-package-receipts` | false | Limpa fotos de avaria vencidas; autentica por `x-cron-secret` |

Segredos esperados: `GROQ_API_KEY`, `VISION_SERVICE_ACCOUNT_JSON` (ou
`VISION_API_KEY`), `LABEL_LAB_SECRET`, `PACKAGE_PHOTO_CLEANUP_SECRET`,
`EVOLUTION_API_URL` e `EVOLUTION_API_KEY`. Defina-os com
`supabase secrets set` e **republique** as funções que os usam.
`service_role` fica apenas dentro das Edge Functions.

### Agendamentos

Os arquivos de `supabase/schedules/` são executados no SQL Editor:

- `cleanup-package-receipts.sql` — de hora em hora, apaga fotos de avaria
  vencidas e registros do caderno além da retenção configurada.
- `process-label-lab-queue.sql` — processa a fila do Label Lab.
- `cleanup-label-lab.sql` — limpa as amostras do Label Lab.

Antes de ativar, cadastre no Vault os segredos usados pelos jobs
(`package-cleanup-project-url`, `package-cleanup-secret` etc.). Preserve o
placeholder `REPLACE_WITH_SUPABASE_PUBLISHABLE_OR_ANON_KEY` no arquivo
versionado; o valor real é colocado na hora de agendar.

### Primeiro Super Admin

Crie e confirme a conta em **Supabase Authentication → Users** e promova apenas
essa conta:

```sql
update public.profiles p
set is_super_admin = true
from auth.users u
where u.id = p.id
  and lower(u.email) = lower('SEU_EMAIL');
```

## Regras de operação que o código garante

Estas regras não são apenas de interface; elas são aplicadas no banco ou em
funções SQL. Não as substitua por validação “aproximada” no frontend.

### Endereço da etiqueta

`verifyPackageDestinationAddress` (`src/lib/packageOcr.ts`) compara CEP,
logradouro e número lidos com o endereço do condomínio. O resultado é
`verified`, `mismatch` ou `unknown`:

- `verified` confirma o recebimento.
- `mismatch` só é aceito com aceite explícito e registrado do porteiro,
  confirmando a conferência física da etiqueta.
- `unknown` permite seguir, mas exige conferência manual.

A IA **nunca** decide o endereço. Rastreio e transportadora também são
determinísticos; a IA só completa nome/unidade/CEP quando as regras deixam
lacuna, e todo valor devolvido precisa existir no texto do OCR.

### Aviso ao morador

O aviso é uma linha na fila `package_notifications`. O canal é escolhido pelo
banco:

- `whatsapp`: quando o condomínio tem uma instância Evolution conectada; o
  envio é feito pela Edge Function `send-package-notification`.
- `whatsapp_link`: fallback manual; o texto é montado no servidor e aberto via
  `wa.me`, sem custo por mensagem.

`packages.last_notified_at` é apenas cache do último aviso. No recebimento em
lote/rajada, os avisos individuais são substituídos por uma mensagem
consolidada por apartamento.

### Retirada

A retirada exige:

- nome de quem retirou;
- assinatura no canvas;
- checkbox “Confirmo que presenciei a retirada e a assinatura do morador”;
- envio de `p_porter_confirmed = true` para
  `confirm_package_collection_batch`.

Uma assinatura pode cobrir até 50 pacotes do mesmo apartamento. O lote é
validado inteiro antes de qualquer `UPDATE`; um pacote já retirado não deixa o
lote pela metade. Assinatura, nome, data e hora ficam guardados no registro.

### Fotos e retenção

- A foto da etiqueta é usada só para leitura e **não é armazenada**.
- Foto de avaria é opcional no fluxo, mas obrigatória quando “Pacote chegou
  avariado” está marcado; fica guardada por **20 dias** e é apagada pela
  limpeza automática.
- O caderno pode ser apagado após o prazo configurado pelo síndico em
  **Estrutura → Dados e Endereço → Manter registros do caderno por (meses)**.
  Vazio significa “nunca apagar”.

### Acesso, prazos e férias

- O prazo do condomínio é calculado no banco; síndico e porteiro ficam presos à
  tela inicial quando o prazo vence ou o condomínio está inativo.
- **Desativar (férias)** bloqueia o login do porteiro sem apagar o histórico;
  **Reativar e gerar senha** devolve o acesso.
- **Excluir acesso** revoga somente o login; os registros do caderno
  permanecem.
- A permissão é da **portaria atual** (`current_portaria_id`), não da pessoa. A
  portaria de origem (`home_portaria_id`) permite “Voltar à portaria de
  origem”. O síndico troca a portaria atual sem prazo.

### Modelos de operação

| Modelo | Descrição |
| --- | --- |
| `single` | Um bloco (ou nenhum), uma portaria |
| `central` | Vários blocos, uma portaria central com gavetas por bloco |
| `per_block` | Cada bloco com sua portaria e seu caderno |

As portarias são criadas automaticamente ao cadastrar o condomínio e
completadas por trigger quando blocos são adicionados.

## Leitura de etiqueta

O pipeline padrão roda na Edge Function `extract-package-label`:

1. **Google Cloud Vision** (`DOCUMENT_TEXT_DETECTION`, `languageHints: ["pt"]`)
   lê o texto da foto, inclusive etiqueta girada.
2. **Regras determinísticas** (`parser.ts`) fazem o primeiro voto. Rastreio e
   transportadora nunca saem da IA.
3. **Groq** (`gpt-oss-120b`) entra só nas exceções (nome, unidade ou CEP
   vazios, ou endereço que não conferiu). Recebe apenas o texto do OCR, nunca o
   endereço do condomínio nem a foto. Cada valor devolvido precisa aparecer no
   texto (`grounding.ts`).

O tempo total é orçado em 8,5 s. Se a Vision consumir quase todo o orçamento, a
etapa de IA é pulada. Sem Vision configurada, a função responde `503` com
`fallback: true`; o app lê apenas o código de barras e pede preenchimento
manual. Sem `GROQ_API_KEY`, o sistema funciona só com regras.

O caminho antigo com Gemini continua disponível para comparação A/B:
`supabase secrets set OCR_ENGINE=gemini GEMINI_API_KEY=...`. Para voltar,
`supabase secrets unset OCR_ENGINE`.

No celular, a foto é redimensionada para no máximo 1280 px no maior lado e
JPEG qualidade 0.80 antes do envio.

### Coleta de amostras e Label Lab

Quando o OCR deixa lacuna real (destinatário, unidade, conflito de unidade ou
endereço divergente/desconhecido) ou falha, o app do porteiro envia a mesma
JPEG para `collect-label-sample`. Não há tela, aviso ou segunda leitura: a
decisão é determinística em `src/lib/labelLabCollection.ts`. A foto vai para um
bucket privado e vira tarefa; o worker `process-label-lab-queue` reaproveita o
pipeline fora do caminho crítico; `cleanup-label-lab` apaga a foto e sanitiza o
OCR identificável depois da retenção.

A **Central do Label Lab** (`/label-lab`) importa até 6 fotos, mostra OCR e
sugestões, salva amostras, versiona regras em rascunho, roda regressão, aprova
e publica. Ao publicar, o artefato entra em `label_lab_active_rules` e passa a
valer no OCR de produção — sem download de JSON nem deploy. Regras publicadas
antes podem ser reativadas; rascunhos podem ser excluídos, mas versões
aprovadas/publicadas não.

O passo a passo de edição de regex está em
[`docs/MANUAL-REGEX-LABEL-LAB.md`](./docs/MANUAL-REGEX-LABEL-LAB.md). Nenhuma
regra publicada altera CEP, logradouro ou número.

Para calibrar em lote pelo terminal, `scripts/label-lab.mjs` envia fotos para a
função `label-lab` e grava relatórios em `scripts/label-reports/` (ignorado pelo
Git). O manual está em `scripts/label-lab/MANUAL.md`.

## Variáveis de ambiente

`src/lib/supabase.ts` lê:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY` (publishable ou anon)

Sem as duas, o app lança erro na inicialização. Não coloque `service_role`,
chave da Evolution, chave da Vision ou qualquer segredo em `src/` ou no
repositório.

## Estrutura do repositório

```
controle-encomendas/
├─ index.html / manager.html / porter.html   # três entradas Vite
├─ src/
│  ├─ main.tsx / manager-main.tsx / porter-main.tsx
│  ├─ apps/ManagerApp.tsx, apps/PorterApp.tsx
│  ├─ pages/            # telas de cada perfil
│  ├─ components/       # caderno, painéis, formulários
│  ├─ lib/              # OCR, notificações, consultas, importação
│  └─ contexts/         # autenticação
├─ supabase/
│  ├─ migrations/       # 47 migrations, ordem acima
│  ├─ functions/        # Edge Functions
│  ├─ schedules/        # jobs pg_cron
│  └─ RECEBIMENTO.md    # publicação, acessos, notificações e limpeza
├─ scripts/             # deploy, laboratório de etiquetas e utilitários de dataset
└─ docs/                # manuais de produto e comerciais
```

## Segurança e LGPD

- O isolamento entre condomínios depende das policies RLS e das funções
  `security definer` das migrations. Não confie apenas na interface.
- As Edge Functions de WhatsApp têm um valor de fallback embutido para
  `EVOLUTION_API_URL`/`EVOLUTION_API_KEY`. Configure os dois segredos e remova
  esses fallbacks antes de abrir o repositório.
- A foto da etiqueta não é guardada; a foto de avaria tem prazo curto e
  finalidade específica.
- A assinatura do morador só é visível às contas autorizadas do condomínio e é
  coletada com ciência dele.
- Dados de contato (nome/WhatsApp) são opcionais; unidade pode existir sem
  morador.
- O aviso manual via `wa.me` é o padrão sem custo por mensagem. A troca para
  envio automático exige uma instância Evolution conectada e um número
  dedicado da portaria.

## Armadilhas conhecidas

- Não execute `criar-projeto.ps1` neste checkout: é um bootstrap antigo que
  sobrescreve arquivos do app e reinstala dependências.
- Não há OCR local: a leitura depende da Edge Function. Sem `VISION_*` ou
  `GROQ_API_KEY`, a função degrada o resultado (código de barras + preenchimento
  manual), não o contrário.
- Funções redefinidas em várias migrations: leia em ordem de timestamp antes de
  alterar qualquer RPC.
- O caderno do síndico, o do porteiro e o do Super Admin usam o mesmo componente
  `PackageNotebook`; mudanças nele afetam os três perfis.
