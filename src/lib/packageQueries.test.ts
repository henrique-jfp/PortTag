import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("./supabase", () => ({ supabase: { rpc } }));

import { fetchDrawers, fetchPackageRecords } from "./packageQueries";

describe("filtro de bloco nas consultas do caderno", () => {
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockResolvedValue({ data: [], error: null });
  });

  it("envia arg_block_id nas gavetas quando o filtro de bloco está definido", async () => {
    await fetchDrawers("condominio-1", { blockId: "bloco-2" }, 1);

    expect(rpc).toHaveBeenCalledWith(
      "search_package_drawers",
      expect.objectContaining({ arg_block_id: "bloco-2" }),
    );
  });

  it("envia arg_block_id nos registros e mantém null quando não há bloco", async () => {
    await fetchPackageRecords({
      condominiumId: "condominio-1",
      unitId: "unidade-1",
      filters: { blockId: "bloco-3" },
      page: 1,
    });

    expect(rpc).toHaveBeenCalledWith(
      "search_package_records",
      expect.objectContaining({ arg_block_id: "bloco-3" }),
    );

    rpc.mockClear();
    await fetchPackageRecords({ condominiumId: "condominio-1", page: 1 });

    expect(rpc).toHaveBeenCalledWith(
      "search_package_records",
      expect.objectContaining({ arg_block_id: null }),
    );
  });
});
