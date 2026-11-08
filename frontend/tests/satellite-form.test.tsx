import React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const eventTypes = vi.fn();
const get = vi.fn();
const updateSubscriptions = vi.fn();
const create = vi.fn();
vi.mock("../src/api/integration", () => ({
  integrationApi: {
    eventTypes: (...a: unknown[]) => eventTypes(...a),
    get: (...a: unknown[]) => get(...a),
    updateSubscriptions: (...a: unknown[]) => updateSubscriptions(...a),
    create: (...a: unknown[]) => create(...a),
  },
}));
vi.mock("../src/components/layout/AppLayout", () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { SatelliteFormPage } from "../src/pages/SatelliteFormPage";
import { groupEventTypes } from "../src/utils/eventGroups";
import { resyncSummary } from "../src/utils/resyncSummary";

const CATALOG = [
  { type: "client.created", description: "Cliente cadastrado", family: "client", familyLabel: "Clientes" },
  { type: "client.updated", description: "Cliente alterado", family: "client", familyLabel: "Clientes" },
  { type: "user.disabled", description: "Usuário desativado", family: "user", familyLabel: "Usuários" },
];

const SATELLITE = {
  id: "sat-1",
  name: "Field",
  webhookUrl: "http://field/webhook",
  frontendUrl: null,
  status: "active",
  subscribedEvents: ["client.created", "ticket.created"],
};

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/integrations" element={<p>Lista de integrações</p>} />
        <Route path="/integrations/new" element={<SatelliteFormPage />} />
        <Route path="/integrations/:id/edit" element={<SatelliteFormPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("SatelliteFormPage", () => {
  beforeEach(() => {
    [eventTypes, get, updateSubscriptions, create].forEach((m) => m.mockReset());
    eventTypes.mockResolvedValue(CATALOG);
    get.mockResolvedValue(SATELLITE);
  });
  afterEach(cleanup);

  it("na edição, mostra os eventos do catálogo por família, marca os assinados e salva a assinatura nova", async () => {
    updateSubscriptions.mockResolvedValue({ ...SATELLITE, subscribedEvents: ["client.created", "user.disabled"] });
    renderAt("/integrations/sat-1/edit");

    const clients = within((await screen.findByText("Clientes")).closest("fieldset") as HTMLElement);
    expect((clients.getByRole("checkbox", { name: /client\.created/ }) as HTMLInputElement).checked).toBe(true);
    expect((clients.getByRole("checkbox", { name: /client\.updated/ }) as HTMLInputElement).checked).toBe(false);
    // Assinatura antiga fora do catálogo aparece para poder ser desmarcada.
    expect(screen.getByText("Outros (o Core não emite)")).toBeTruthy();

    fireEvent.click(screen.getByRole("checkbox", { name: /ticket\.created/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /user\.disabled/ }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar assinatura" }));

    await waitFor(() => expect(updateSubscriptions).toHaveBeenCalledWith("sat-1", ["client.created", "user.disabled"]));
    expect(await screen.findByText("Lista de integrações")).toBeTruthy();
  });

  it("marca todos os eventos da família de uma vez", async () => {
    renderAt("/integrations/sat-1/edit");
    fireEvent.click(await screen.findByRole("checkbox", { name: "Todos os eventos de Clientes" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar assinatura" }));
    await waitFor(() =>
      expect(updateSubscriptions).toHaveBeenCalledWith("sat-1", ["ticket.created", "client.created", "client.updated"]),
    );
  });

  it("mostra na tela o erro do servidor ao salvar", async () => {
    updateSubscriptions.mockRejectedValue({ response: { status: 400, data: { message: "Evento desconhecido: x.y. Escolha entre os eventos que o Core emite." } } });
    renderAt("/integrations/sat-1/edit");
    fireEvent.click(await screen.findByRole("button", { name: "Salvar assinatura" }));
    expect(await screen.findByText("Evento desconhecido: x.y. Escolha entre os eventos que o Core emite.")).toBeTruthy();
  });

  it("mostra erro quando o catálogo não carrega", async () => {
    eventTypes.mockRejectedValue({ response: { status: 403 } });
    renderAt("/integrations/new");
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("Você não tem permissão para esta ação.")).toBeTruthy();
  });

  it("no cadastro, exige ao menos um evento", async () => {
    renderAt("/integrations/new");
    fireEvent.change(await screen.findByPlaceholderText("Nome do satélite"), { target: { value: "Field" } });
    fireEvent.change(screen.getByPlaceholderText("URL do webhook"), { target: { value: "http://field/webhook" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar satélite" }));
    expect(await screen.findByText("Escolha ao menos um evento.")).toBeTruthy();
    expect(create).not.toHaveBeenCalled();
  });
});

describe("helpers da tela de integrações", () => {
  it("agrupa por família na ordem do catálogo", () => {
    expect(groupEventTypes(CATALOG, []).map((g) => [g.label, g.events.length])).toEqual([
      ["Clientes", 2],
      ["Usuários", 1],
    ]);
  });

  it("resume o reenvio de cadastros com todas as contagens", () => {
    expect(
      resyncSummary({ costCenters: 2, collaborators: 10, allocations: 8, sites: 3, clients: 4, projects: 5, users: 6, jobTitles: 7, holidays: 9 }),
    ).toBe("2 centros de custo, 10 colaboradores, 8 alocações, 4 clientes, 3 sites, 5 projetos, 6 usuários, 7 cargos e 9 feriados");
  });
});
