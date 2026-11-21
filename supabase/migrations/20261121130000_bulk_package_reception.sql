-- Recebimento em lote pelo porteiro.
--
-- Duas RPCs curtas substituem a sequência "consulta duplicado + grava" repetida
-- foto a foto:
--   * find_duplicate_packages confere todos os rastreios da fila de uma vez;
--   * create_packages_batch grava o lote inteiro em uma única chamada e devolve
--     o resultado de cada foto (salvo, duplicado ou erro), sem tudo-ou-nada.
--
-- O aceite do endereço no lote é único e fica registrado em
-- package_reception_acknowledgements para auditoria do síndico.

create table if not exists public.package_reception_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null
    references public.packages (id) on delete cascade,
  condominium_id uuid not null
    references public.condominiums (id) on delete cascade,
  acknowledged_by uuid not null
    references auth.users (id) on delete restrict,
  acknowledged_at timestamptz not null default now(),
  address_status text not null
    check (address_status in ('verified', 'mismatch', 'unknown')),
  duplicate_tracking boolean not null default false
);

create index if not exists package_reception_ack_package_idx
  on public.package_reception_acknowledgements (package_id);

create index if not exists package_reception_ack_condominium_idx
  on public.package_reception_acknowledgements (
    condominium_id,
    acknowledged_at desc
  );

alter table public.package_reception_acknowledgements enable row level security;

drop policy if exists "Staff can read reception acknowledgements"
  on public.package_reception_acknowledgements;
create policy "Staff can read reception acknowledgements"
  on public.package_reception_acknowledgements
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.packages p
      where p.id = package_reception_acknowledgements.package_id
        and public.can_access_condominium_block(p.condominium_id, p.block_id)
    )
  );

revoke insert, update, delete on public.package_reception_acknowledgements
  from anon, authenticated;
grant select on public.package_reception_acknowledgements to authenticated;

-- Pré-checagem: devolve, para cada rastreio já existente, o volume mais recente.
create or replace function public.find_duplicate_packages(
  p_condominium_id uuid,
  p_tracking_codes text[]
)
returns table (
  tracking_code text,
  unit_number text,
  block_name text,
  received_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct on (lower(p.tracking_code))
    p.tracking_code,
    p.unit_number,
    p.block_name,
    p.received_at
  from public.packages p
  where p.condominium_id = p_condominium_id
    and p.tracking_code is not null
    and lower(p.tracking_code) in (
      select lower(btrim(codes.code))
      from unnest(p_tracking_codes) as codes(code)
      where nullif(btrim(codes.code), '') is not null
    )
    and (select public.can_access_condominium_block(p.condominium_id, p.block_id))
  order by lower(p.tracking_code), p.received_at desc;
$$;

revoke all on function public.find_duplicate_packages(uuid, text[]) from public;
grant execute on function public.find_duplicate_packages(uuid, text[])
  to authenticated;

-- Gravação do lote. Cada item é independente: uma falha não desfaz os demais.
-- Um rastreio já existente volta como `duplicate_*` em vez de erro, para o
-- cliente pedir o aceite sem ter perdido os dados preenchidos.
create or replace function public.create_packages_batch(
  p_condominium_id uuid,
  p_items jsonb
)
returns table (
  item_index integer,
  package_id uuid,
  error_message text,
  duplicate_unit_number text,
  duplicate_block_name text,
  duplicate_received_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_count integer;
  v_index integer;
  v_item jsonb;
  v_unit_id uuid;
  v_tracking text;
  v_allow_duplicate boolean;
  v_address_acknowledged boolean;
  v_address_status text;
  v_package_id uuid;
  v_duplicate_found boolean;
  v_duplicate_unit text;
  v_duplicate_block text;
  v_duplicate_received timestamptz;
begin
  if v_user_id is null then
    raise exception 'Faça login para registrar encomendas.'
      using errcode = '42501';
  end if;

  if p_condominium_id is null then
    raise exception 'Informe o condomínio.'
      using errcode = '22023';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Lote de encomendas inválido.'
      using errcode = '22023';
  end if;

  v_count := jsonb_array_length(p_items);
  if v_count = 0 then
    return;
  end if;

  if v_count > 50 then
    raise exception 'Envie no máximo 50 encomendas por lote.'
      using errcode = '22023';
  end if;

  for v_index in 0 .. v_count - 1 loop
    v_item := p_items -> v_index;

    item_index := v_index;
    package_id := null;
    error_message := null;
    duplicate_unit_number := null;
    duplicate_block_name := null;
    duplicate_received_at := null;

    v_unit_id := null;
    begin
      v_unit_id := nullif(btrim(coalesce(v_item ->> 'unit_id', '')), '')::uuid;
    exception when others then
      v_unit_id := null;
    end;

    v_tracking := nullif(btrim(coalesce(v_item ->> 'tracking_code', '')), '');
    v_allow_duplicate := coalesce(
      (v_item ->> 'allow_duplicate')::boolean,
      false
    );
    v_address_acknowledged := coalesce(
      (v_item ->> 'address_acknowledged')::boolean,
      false
    );
    v_address_status := coalesce(
      nullif(btrim(coalesce(v_item ->> 'address_status', '')), ''),
      'unknown'
    );

    if v_address_status not in ('verified', 'mismatch', 'unknown') then
      v_address_status := 'unknown';
    end if;

    if v_unit_id is null then
      error_message := 'Selecione o apartamento desta encomenda.';
      return next;
      continue;
    end if;

    v_duplicate_found := false;
    if v_tracking is not null then
      select p.unit_number, p.block_name, p.received_at
      into v_duplicate_unit, v_duplicate_block, v_duplicate_received
      from public.packages p
      where p.condominium_id = p_condominium_id
        and p.tracking_code is not null
        and lower(p.tracking_code) = lower(v_tracking)
        and (select public.can_access_condominium_block(
          p.condominium_id,
          p.block_id
        ))
      order by p.received_at desc
      limit 1;

      v_duplicate_found := found;
    end if;

    if v_duplicate_found and not v_allow_duplicate then
      duplicate_unit_number := v_duplicate_unit;
      duplicate_block_name := v_duplicate_block;
      duplicate_received_at := v_duplicate_received;
      return next;
      continue;
    end if;

    begin
      v_package_id := public.create_package(
        p_condominium_id,
        v_unit_id,
        null,
        coalesce(v_item ->> 'sender', ''),
        coalesce(v_item ->> 'delivery_person', ''),
        v_tracking,
        nullif(btrim(coalesce(v_item ->> 'resident_name', '')), ''),
        coalesce((v_item ->> 'recipient_is_resident')::boolean, false),
        false
      );
      package_id := v_package_id;
    exception when others then
      package_id := null;
      error_message := sqlerrm;
    end;

    if package_id is not null
      and (v_address_acknowledged or v_duplicate_found)
    then
      begin
        insert into public.package_reception_acknowledgements (
          package_id,
          condominium_id,
          acknowledged_by,
          address_status,
          duplicate_tracking
        ) values (
          package_id,
          p_condominium_id,
          v_user_id,
          v_address_status,
          v_duplicate_found
        );
      exception when others then
        -- A auditoria do aceite não pode derrubar o recebimento já gravado.
        null;
      end;
    end if;

    return next;
  end loop;
end;
$$;

revoke all on function public.create_packages_batch(uuid, jsonb) from public;
grant execute on function public.create_packages_batch(uuid, jsonb)
  to authenticated;

notify pgrst, 'reload schema';
