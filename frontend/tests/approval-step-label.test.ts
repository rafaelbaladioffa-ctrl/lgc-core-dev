import { describe, expect, it } from "vitest";
import { approvalStepLabel } from "../src/api/requests";
import { formatDateOnly } from "../src/utils/formatDate";

describe("approvalStepLabel", () => {
  it("rotula as etapas de compra e cai no nível da hierarquia", () => {
    expect(approvalStepLabel({ approvalSource: "centro_custo", requiredLevel: null })).toBe("Responsável pelo centro de custo");
    expect(approvalStepLabel({ approvalSource: "orcamento_cc", requiredLevel: null })).toBe("Responsável pelo centro de custo pai (orçamento estourado)");
    expect(approvalStepLabel({ approvalSource: "hierarquia", requiredLevel: "gerente" })).toBe("gerente");
    expect(approvalStepLabel({ requiredLevel: null })).toBe("gestor direto");
  });
});

describe("formatDateOnly", () => {
  it("formata data de calendário sem deslocar o dia pelo fuso", () => {
    expect(formatDateOnly("2026-11-10")).toBe("10/11/2026");
    expect(formatDateOnly("2026-11-10T00:00:00.000Z")).toBe("10/11/2026");
    expect(formatDateOnly(null)).toBe("—");
  });
});
