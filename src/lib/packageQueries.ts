import { supabase } from "./supabase";

export type DrawerRecord = {
  unit_id: string | null;
  unit_number: string;
  block_name: string | null;
  package_count: number;
  pending_count: number;
  last_received_at: string;
};

export type PackageRecordRow = {
  id: string;
  condominium_id: string;
  unit_id: string | null;
  unit_number: string;
  block_name: string | null;
  resident_name: string | null;
  recipient_is_resident: boolean;
  sender: string | null;
  delivery_person: string | null;
  tracking_code: string | null;
  received_by: string;
  received_at: string;
  status: "received" | "collected";
  collected_at: string | null;
  collected_by_name: string | null;
  collected_confirmed_by: string | null;
  is_damaged: boolean;
  receipt_path: string | null;
  photo_expires_at: string;
  photo_deleted_at: string | null;
  last_notified_at: string | null;
};

export type DailyCount = {
  day: string;
  total: number;
  pending: number;
  collected: number;
};

export type PackageSort = "recent" | "tracking" | "sender";

export type PackageFilters = {
  dateFrom?: string;
  dateTo?: string;
  unit?: string;
  tracking?: string;
  company?: string;
  porter?: string;
  status?: string;
};

export type PageResult<T> = {
  items: T[];
  total: number;
};

export const DEFAULT_PAGE_SIZE = 20;
export const DRAWER_PAGE_SIZE = 12;
export const RECORD_PAGE_SIZE = 12;

function parseLocalDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** Meia-noite local do dia, em UTC — mantém o limite igual ao calendário. */
export function localDayStart(value: string) {
  return parseLocalDate(value).toISOString();
}

/** Meia-noite local do dia seguinte, em UTC (limite exclusivo). */
export function localDayAfter(value: string) {
  const date = parseLocalDate(value);
  date.setDate(date.getDate() + 1);
  return date.toISOString();
}

export function yearBounds(year: number) {
  return {
    from: new Date(year, 0, 1).toISOString(),
    to: new Date(year + 1, 0, 1).toISOString(),
  };
}

export function browserTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function dateKey(value: string) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dateBounds(filters: PackageFilters) {
  const from = filters.dateFrom ? localDayStart(filters.dateFrom) : null;
  let to = filters.dateTo ? localDayAfter(filters.dateTo) : null;
  if (filters.dateFrom && filters.dateTo === filters.dateFrom && from) {
    to = localDayAfter(filters.dateFrom);
  }
  return { from, to };
}

export async function fetchDailyCounts(condominiumId: string, year: number) {
  const { from, to } = yearBounds(year);
  const { data, error } = await supabase.rpc("package_daily_counts", {
    arg_condominium_id: condominiumId,
    arg_date_from: from,
    arg_date_to: to,
    arg_timezone: browserTimeZone(),
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as DailyCount[];
}

export async function fetchDrawers(
  condominiumId: string,
  filters: PackageFilters,
  page: number,
): Promise<PageResult<DrawerRecord>> {
  const { from, to } = dateBounds(filters);
  const { data, error } = await supabase.rpc("search_package_drawers", {
    arg_condominium_id: condominiumId,
    arg_date_from: from,
    arg_date_to: to,
    arg_unit_query: filters.unit || null,
    arg_tracking_query: filters.tracking || null,
    arg_company_query: filters.company || null,
    arg_porter_query: filters.porter || null,
    arg_status: filters.status || null,
    arg_limit: DRAWER_PAGE_SIZE,
    arg_offset: (page - 1) * DRAWER_PAGE_SIZE,
  });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<DrawerRecord & { total_drawers: number }>;
  return {
    items: rows.map(({ total_drawers: _total, ...drawer }) => drawer),
    total: rows[0]?.total_drawers ?? 0,
  };
}

export async function fetchPackageRecords(options: {
  condominiumId: string;
  unitId?: string | null;
  status?: string | null;
  filters?: PackageFilters;
  sort?: PackageSort;
  page: number;
  pageSize?: number;
}): Promise<PageResult<PackageRecordRow>> {
  const filters = options.filters ?? {};
  const { from, to } = dateBounds(filters);
  const pageSize = options.pageSize ?? RECORD_PAGE_SIZE;
  const { data, error } = await supabase.rpc("search_package_records", {
    arg_condominium_id: options.condominiumId,
    arg_unit_id: options.unitId ?? null,
    arg_status: options.status ?? filters.status ?? null,
    arg_date_from: from,
    arg_date_to: to,
    arg_unit_query: filters.unit || null,
    arg_tracking_query: filters.tracking || null,
    arg_company_query: filters.company || null,
    arg_porter_query: filters.porter || null,
    arg_sort: options.sort ?? "recent",
    arg_limit: pageSize,
    arg_offset: (options.page - 1) * pageSize,
  });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<PackageRecordRow & { total_records: number }>;
  return {
    items: rows.map(({ total_records: _total, ...record }) => record),
    total: rows[0]?.total_records ?? 0,
  };
}

/** A assinatura é base64 de imagem: só é buscada quando alguém pede para ver. */
export async function fetchPackageSignature(packageId: string) {
  const { data, error } = await supabase
    .from("packages")
    .select("collected_signature")
    .eq("id", packageId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.collected_signature ?? null;
}
