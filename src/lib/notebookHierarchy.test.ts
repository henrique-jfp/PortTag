import { describe, expect, it } from "vitest";
import type { DrawerRecord } from "./packageQueries";
import { buildFloorGroups, buildNotebookHierarchy } from "./notebookHierarchy";

function drawer(
  unitNumber: string,
  blockName: string | null,
  lastReceivedAt: string,
  packageCount = 1,
  pendingCount = 0,
): DrawerRecord {
  return {
    unit_id: `unit-${blockName ?? "none"}-${unitNumber}`,
    unit_number: unitNumber,
    block_name: blockName,
    package_count: packageCount,
    pending_count: pendingCount,
    last_received_at: lastReceivedAt,
  };
}

const drawers: DrawerRecord[] = [
  drawer("101", "Bloco A", "2026-11-20T10:00:00Z", 3, 1),
  drawer("102", "Bloco A", "2026-11-22T10:00:00Z", 2, 2),
  drawer("201", "Bloco B", "2026-11-23T10:00:00Z", 1, 0),
  drawer("103", "Bloco A", "2026-11-18T10:00:00Z", 4, 0),
  drawer("Térreo 1", null, "2026-11-21T10:00:00Z", 1, 1),
];

describe("buildNotebookHierarchy", () => {
  it("ordena blocos pelo recebimento mais recente e soma as contagens", () => {
    const blocks = buildNotebookHierarchy(drawers);

    expect(blocks.map((block) => block.label)).toEqual([
      "Bloco B",
      "Bloco A",
      "Sem bloco",
    ]);
    const blocoA = blocks.find((block) => block.label === "Bloco A")!;
    expect(blocoA.packageCount).toBe(9);
    expect(blocoA.pendingCount).toBe(3);
    expect(blocoA.lastReceivedAt).toBe("2026-11-22T10:00:00Z");
  });

  it("ordena os apartamentos de cada bloco do mais recente ao mais antigo", () => {
    const blocks = buildNotebookHierarchy(drawers);
    const blocoB = blocks.find((block) => block.label === "Bloco B")!;
    const blocoA = blocks.find((block) => block.label === "Bloco A")!;

    expect(blocoB.drawers.map((item) => item.unit_number)).toEqual(["201"]);
    expect(blocoA.drawers.map((item) => item.unit_number)).toEqual([
      "102",
      "101",
      "103",
    ]);
  });
});

describe("buildFloorGroups", () => {
  it("abre a gaveta de andares com apartamentos recentes primeiro", () => {
    const blocoA = buildNotebookHierarchy(drawers).find(
      (block) => block.label === "Bloco A",
    );
    expect(blocoA).toBeDefined();

    const floors = buildFloorGroups(blocoA!.drawers);
    expect(floors).toHaveLength(1);
    expect(floors[0].label).toBe("1º andar");
    expect(floors[0].drawers.map((item) => item.unit_number)).toEqual([
      "102",
      "101",
      "103",
    ]);
    expect(floors[0].packageCount).toBe(9);
  });

  it("separa andares diferentes e coloca o mais recente primeiro", () => {
    const floors = buildFloorGroups([
      drawer("101", "Bloco A", "2026-11-20T10:00:00Z"),
      drawer("201", "Bloco A", "2026-11-23T10:00:00Z"),
    ]);

    expect(floors.map((floor) => floor.label)).toEqual([
      "2º andar",
      "1º andar",
    ]);
  });
});
