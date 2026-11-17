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

O Síndico precisa ter uma conta de e-mail no Supabase Authentication antes de
ser vinculado pelo Super Admin. Ele entra em `manager.html` com esse e-mail e
senha. O Porteiro entra em `porter.html` com o usuário e a senha temporária.

O app do Porteiro é mobile-first: tira a foto com a câmera do celular e comprime
a imagem antes do processamento. A leitura da etiqueta é tentada primeiro na
nuvem, com Gemini Vision, e sugere destinatário, unidade, empresa e rastreio;
se a nuvem falhar ou não estiver configurada, o app usa OCR local como fallback.
Confirme o apartamento e informe o nome do entregador; empresa e código de
rastreio são opcionais se não forem detectados. O caderno anual do Síndico permite filtrar
recebimentos por data, apartamento, empresa, porteiro, rastreio e situação.
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

### Leitura de etiqueta com Gemini Vision

A extração na nuvem exige uma chave de API do Google AI Studio. Crie a chave e
configure o segredo e a função no projeto do Supabase (o `project-ref` deste
projeto é `ygtmyjrivavasjfwvioz`):

```powershell
supabase link --project-ref ygtmyjrivavasjfwvioz
supabase secrets set GEMINI_API_KEY=SUA_CHAVE_AQUI
supabase functions deploy extract-package-label
```

A função usa `verify_jwt = true`, valida o vínculo do porteiro com o condomínio
e chama o Gemini com a foto comprimida. Sem a chave, ela responde `503` com
`fallback: true` e o app continua no OCR local. O modelo é
`gemini-3.5-flash-lite`, com resposta JSON estruturada e no máximo 350 tokens;
a chave fica somente no ambiente da Edge Function.

Para reduzir o consumo no piloto, a foto é redimensionada no celular para no
máximo 1280 px no maior lado, JPEG em qualidade 0.80, e a mesma imagem é usada
na IA e no Storage `package-receipts`. Nome/WhatsApp do morador, rastreio e
telefone do entregador continuam opcionais: o porteiro pode registrar com o
endereço em branco (`unknown`), mas divergência confirmada (`mismatch`) exige
checkbox explícito antes de salvar.

Nunca coloque a chave `service_role`, a chave do Gemini ou qualquer segredo no
frontend ou no repositório. As permissões dos dados devem ser protegidas pelo
RLS do Supabase.
