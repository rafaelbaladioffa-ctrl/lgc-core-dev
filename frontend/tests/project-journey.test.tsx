import React from "react";
import { MemoryRouter } from "react-router-dom";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const journeyApi = vi.fn();
vi.mock("../src/api/projects", () => ({ projectsApi: { journey: (...args: unknown[]) => journeyApi(...args) } }));

import { JourneyTimeline, ProjectJourney } from "../src/components/ProjectJourney";

afterEach(cleanup);
beforeEach(() => journeyApi.mockReset());

const stage = (key: string, label: string, state: string, extra: Record<string, unknown> = {}) => ({
  key,
  label,
  state,
  date: null,
  summary: `${label} — resumo`,
  details: [],
  alerts: [],
  link: null,
  ...extra,
});

const journey = (overrides: Record<string, unknown> = {}) =>
  ({
    projectId: "p-1",
    code: "PROP-7.012-1126",
    name: "Cabeamento DC",
    status: "em_execucao",
    currentStage: "obra",
    stages: [
      stage("cotacao", "Cotação", "feito", { date: "2026-11-05T15:00:00Z", details: [{ label: "Revisão vigente", value: "2" }] }),
      stage("aprovado", "Aprovado", "feito", { date: "2026-11-08T15:00:00Z", details: [{ label: "PO do cliente", value: "PO-77" }] }),
      stage("requisicao", "Requisição de envio", "atencao", {
        date: "2026-11-12T16:00:00Z",
        alerts: ["Falta material no estoque da Logística (1 item)."],
        link: { label: "Abrir a requisição", to: "/requests/req-1" },
      }),
      stage("obra", "Obra no Field", "em_andamento", { date: "2026-11-16T22:00:00Z", link: { label: "Abrir a obra no Field", to: "https://field.lgc.local/projetos/42" } }),
      stage("encerrado", "Encerrado", "pendente"),
    ],
    shipment: { requestId: "req-1", code: "REQ-1", items: [], delivered: 1000, total: 1240, shortages: 1 },
    field: { url: "https://field.lgc.local/projetos/42", fieldProjectCode: "CSTR-PROJ-0042", sowPlanStatus: "generated", tasksCount: 12, percentComplete: 25.5, tasksTotal: 12, tasksDone: 3, realManHours: 40.5, plannedManHours: 400, progressDate: "2026-11-16", startedAt: "2026-11-15T08:00:00Z", completedAt: null },
    financeiroUrl: null,
    ...overrides,
  }) as never;

const renderTimeline = (data = journey()) =>
  render(
    <MemoryRouter>
      <JourneyTimeline journey={data} />
    </MemoryRouter>,
  );

describe("linha do tempo da jornada do projeto (PT-11)", () => {
  it("mostra as cinco etapas na ordem, cada uma com estado e data", () => {
    renderTimeline();
    const list = screen.getByRole("list", { name: "Linha do tempo do projeto" });
    const rows = Array.from(list.children) as HTMLElement[];
    expect(rows.map((row) => row.getAttribute("data-testid"))).toEqual([
      "journey-stage-cotacao",
      "journey-stage-aprovado",
      "journey-stage-requisicao",
      "journey-stage-obra",
      "journey-stage-encerrado",
    ]);
    expect(rows.map((row) => row.getAttribute("data-state"))).toEqual(["feito", "feito", "atencao", "em_andamento", "pendente"]);
    const cotacao = within(rows[0]);
    expect(cotacao.getByText("Feito")).toBeTruthy();
    expect(cotacao.getByText("05/11/2026 12:00")).toBeTruthy(); // São Paulo
    expect(within(rows[4]).getByText("Pendente")).toBeTruthy();
    expect(within(rows[4]).getByText("Sem data ainda")).toBeTruthy();
    expect(within(rows[2]).getByText("Atenção")).toBeTruthy();
    expect(within(rows[3]).getByText("Em andamento")).toBeTruthy();
  });

  it("marca a etapa atual e mostra detalhes, alertas e links (interno e do Field)", () => {
    renderTimeline();
    expect(screen.getByTestId("journey-stage-obra").getAttribute("aria-current")).toBe("step");
    expect(screen.getByTestId("journey-stage-cotacao").getAttribute("aria-current")).toBeNull();
    expect(within(screen.getByTestId("journey-stage-cotacao")).getByText("Revisão vigente")).toBeTruthy();
    expect(within(screen.getByTestId("journey-stage-aprovado")).getByText("PO-77")).toBeTruthy();
    expect(within(screen.getByTestId("journey-stage-requisicao")).getByRole("alert").textContent).toContain("Falta material no estoque");
    expect(within(screen.getByTestId("journey-stage-requisicao")).getByRole("link", { name: "Abrir a requisição" }).getAttribute("href")).toBe("/requests/req-1");
    const field = within(screen.getByTestId("journey-stage-obra")).getByRole("link", { name: "Abrir a obra no Field" });
    expect(field.getAttribute("href")).toBe("https://field.lgc.local/projetos/42");
    expect(field.getAttribute("target")).toBe("_blank");
  });

  it("indicadores: etapa atual, material entregue, faltas, avanço, tarefas e HH real × previsto", () => {
    renderTimeline();
    expect(screen.getByText("Etapa atual").nextSibling?.textContent).toContain("Obra no Field");
    expect(screen.getByText("Material entregue").nextSibling?.textContent).toBe("1.000 de 1.240");
    expect(screen.getByText("Itens em falta").nextSibling?.textContent).toBe("1");
    expect(screen.getByText("Avanço da obra").nextSibling?.textContent).toBe("25,5%");
    expect(screen.getByText("Tarefas").nextSibling?.textContent).toBe("3 de 12");
    expect(screen.getByText("HH real × previsto").nextSibling?.textContent).toBe("40,5 h × 400 h");
  });

  it("sem obra e sem requisição, só aparece a etapa atual; sem URL do Financeiro, não há link de resultado", () => {
    renderTimeline(journey({ currentStage: "cotacao", shipment: null, field: null, stages: [stage("cotacao", "Cotação", "pendente"), stage("aprovado", "Aprovado", "pendente"), stage("requisicao", "Requisição de envio", "pendente"), stage("obra", "Obra no Field", "pendente"), stage("encerrado", "Encerrado", "pendente")] }));
    expect(screen.queryByText("Avanço da obra")).toBeNull();
    expect(screen.queryByText("Material entregue")).toBeNull();
    expect(screen.queryByText("Ver resultado no Financeiro")).toBeNull();
  });

  it("link Ver resultado no Financeiro só com a URL configurada, sem mostrar valores", () => {
    renderTimeline(journey({ financeiroUrl: "https://fin.lgc.local/#/projetos/p-1" }));
    const link = screen.getByRole("link", { name: "Ver resultado no Financeiro" });
    expect(link.getAttribute("href")).toBe("https://fin.lgc.local/#/projetos/p-1");
    expect(document.body.textContent).not.toMatch(/R\$/);
  });
});

describe("ProjectJourney (carga)", () => {
  it("mostra a linha do tempo depois de carregar", async () => {
    journeyApi.mockResolvedValue(journey());
    render(
      <MemoryRouter>
        <ProjectJourney projectId="p-1" />
      </MemoryRouter>,
    );
    expect(screen.getByText("Carregando a jornada do projeto…")).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("journey-stage-obra")).toBeTruthy());
    expect(journeyApi).toHaveBeenCalledWith("p-1");
  });

  it("erro da API aparece na tela e dá para tentar de novo", async () => {
    journeyApi.mockRejectedValueOnce({ response: { status: 500, data: { message: "Falha no servidor" } } }).mockResolvedValueOnce(journey());
    render(
      <MemoryRouter>
        <ProjectJourney projectId="p-1" />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    await waitFor(() => expect(screen.getByTestId("journey-stage-obra")).toBeTruthy());
    expect(journeyApi).toHaveBeenCalledTimes(2);
  });
});
