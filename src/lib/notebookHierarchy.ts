import type { DrawerRecord } from "./packageQueries";
import { groupUnitsByFloor } from "./unitFloors";

export type NotebookHierarchyGroup = {
  key: string;
  label: string;
  drawers: DrawerRecord[];
  packageCount: number;
  pendingCount: number;
  lastReceivedAt: string;
};

function timestamp(value: string) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

/** Apartamento com recebimento mais recente primeiro; desempate por número. */
export function sortDrawersByRecent(drawers: DrawerRecord[]) {
  return [...drawers].sort((a, b) => {
    const byDate = timestamp(b.last_received_at) - timestamp(a.last_received_at);
    if (byDate !== 0) return byDate;
    return a.unit_number.localeCompare(b.unit_number, "pt-BR", {
      numeric: true,
    });
  });
}

function summarize(
  key: string,
  label: string,
  drawers: DrawerRecord[],
): NotebookHierarchyGroup {
  const sorted = sortDrawersByRecent(drawers);
  return {
    key,
    label,
    drawers: sorted,
    packageCount: sorted.reduce(
      (sum, drawer) => sum + Number(drawer.package_count ?? 0),
      0,
    ),
    pendingCount: sorted.reduce(
      (sum, drawer) => sum + Number(drawer.pending_count ?? 0),
      0,
    ),
    lastReceivedAt: sorted[0]?.last_received_at ?? "",
  };
}

function compareGroups(a: NotebookHierarchyGroup, b: NotebookHierarchyGroup) {
  const byDate = timestamp(b.lastReceivedAt) - timestamp(a.lastReceivedAt);
  if (byDate !== 0) return byDate;
  return a.label.localeCompare(b.label, "pt-BR", { numeric: true });
}

/**
 * Nível superior do caderno do Síndico: blocos ordenados pelo recebimento mais
 * recente. O nome vem da etiqueta/compra (block_name), não de um id — a RPC de
 * gavetas não devolve block_id.
 */
export function buildNotebookHierarchy(
  drawers: DrawerRecord[],
): NotebookHierarchyGroup[] {
  const byBlock = new Map<string, DrawerRecord[]>();
  for (const drawer of drawers) {
    const label = drawer.block_name?.trim() || "Sem bloco";
    const bucket = byBlock.get(label) ?? [];
    bucket.push(drawer);
    byBlock.set(label, bucket);
  }
  return [...byBlock.entries()]
    .map(([label, blockDrawers]) => summarize(label, label, blockDrawers))
    .sort(compareGroups);
}

/**
 * Gaveta de andares de um bloco. `groupUnitsByFloor` infere o andar a partir do
 * número da unidade quando não há `floor_label` na gaveta.
 */
export function buildFloorGroups(
  drawers: DrawerRecord[],
): NotebookHierarchyGroup[] {
  return groupUnitsByFloor(drawers)
    .map((group) => summarize(group.key, group.label, group.units))
    .sort(compareGroups);
}
