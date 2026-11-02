import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { BpmAdminPage, BpmNewRequestPage, BpmVersionPage } from "../src/features/requisicoes-bpm/BpmPages";
import { bpmApi } from "../src/features/requisicoes-bpm/api";

vi.mock("../src/components/layout/AppLayout", () => ({
  AppLayout: ({ children }: any) => <main>{children}</main>,
}));
vi.mock("../src/context/AuthContext", () => ({
  useAuth: () => ({ user: { sub: "user-manager" } }),
}));
vi.mock("../src/features/requisicoes-bpm/api", () => ({
  bpmApi: {
    processes: vi.fn(),
    queues: vi.fn(),
    collaborators: vi.fn(),
    createQueue: vi.fn(),
    createProcess: vi.fn(),
    updateQueue: vi.fn(),
    grants: vi.fn(),
    version: vi.fn(),
    patchVersion: vi.fn(),
    validateVersion: vi.fn(),
    publishVersion: vi.fn(),
    enable: vi.fn(),
    catalog: vi.fn(),
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("A01 — publicação administrativa pela UI", () => {
  it("cria fila/membros, processo, formulário e duas metas, publica, habilita e lista no catálogo", async () => {
    const people = [
      { userId: "user-manager", collaboratorId: "collab-manager", fullName: "Gestor sintético", sectorId: "sector-1", sectorName: "Setor sintético", canPublish: true },
      { userId: "user-member", collaboratorId: "collab-member", fullName: "Triador sintético", sectorId: "sector-1", sectorName: "Setor sintético", canPublish: false },
    ];
    const queue = { id: "queue-1", name: "Fila P01", sectorId: "sector-1", revision: 1, bpmMembers: [] };
    const process = {
      id: "process-1", code: "P01-UI", name: "Processo P01 UI", runtimeEnabled: false,
      configRevision: 1, grants: [{ userId: "user-manager", role: "publisher", restrictedRead: false }],
      versions: [{ id: "version-1", version: 1, bpmStatus: "draft", bpmRevision: 0, bpmDefinition: { form: [], sla: { firstResponseMinutes: 240, resolutionMinutes: 2880 } }, category: { id: "process-1", configRevision: 1 } }],
    } as any;
    let queues: any[] = [];
    let processes: any[] = [];
    let published = false;
    vi.mocked(bpmApi.collaborators).mockResolvedValue(people as any);
    vi.mocked(bpmApi.queues).mockImplementation(async () => queues);
    vi.mocked(bpmApi.processes).mockImplementation(async () => processes);
    vi.mocked(bpmApi.createQueue).mockImplementation(async (input: any) => {
      queues = [{ ...queue, name: input.name, sectorId: input.sectorId, bpmMembers: [
        ...input.members.map((collaboratorId: string) => ({ collaboratorId, role: "member" })),
        ...input.managers.map((collaboratorId: string) => ({ collaboratorId, role: "manager" })),
      ] }];
      return queues[0];
    });
    vi.mocked(bpmApi.createProcess).mockImplementation(async (input: any) => {
      processes = [{ ...process, code: input.code, name: input.name, versions: [{ ...process.versions[0], category: { id: "process-1", configRevision: 1 } }] }];
      return processes[0];
    });
    vi.mocked(bpmApi.version).mockResolvedValue(process.versions[0] as any);
    vi.mocked(bpmApi.patchVersion).mockResolvedValue({});
    vi.mocked(bpmApi.validateVersion).mockResolvedValue({ valid: true, errors: [], validatedHash: "hash-a01" } as any);
    vi.mocked(bpmApi.publishVersion).mockImplementation(async () => {
      published = true;
      return {};
    });
    vi.mocked(bpmApi.enable).mockResolvedValue({ runtimeEnabled: true } as any);
    vi.mocked(bpmApi.catalog).mockResolvedValue([{
      ...process,
      runtimeEnabled: true,
      versions: [{ ...process.versions[0], bpmStatus: "published", bpmContentHash: "hash-a01" }],
    }] as any);

    render(<MemoryRouter><BpmAdminPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getAllByRole("option", { name: "Setor sintético" }).length).toBe(2));
    const adminSelects = screen.getAllByRole("combobox");
    fireEvent.change(adminSelects[0], { target: { value: "sector-1" } });
    fireEvent.change(screen.getByPlaceholderText("Nome da fila"), { target: { value: "Fila P01" } });
    fireEvent.change(adminSelects[1], { target: { value: "collab-member" } });
    fireEvent.change(adminSelects[2], { target: { value: "collab-manager" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar fila" }));
    await waitFor(() => expect(bpmApi.createQueue).toHaveBeenCalledWith(expect.objectContaining({ members: ["collab-member"], managers: ["collab-manager"] })));

    const selectsAfterQueue = screen.getAllByRole("combobox");
    fireEvent.change(screen.getByPlaceholderText("Código"), { target: { value: "P01-UI" } });
    fireEvent.change(screen.getByPlaceholderText("Nome"), { target: { value: "Processo P01 UI" } });
    fireEvent.change(screen.getByPlaceholderText("Descrição"), { target: { value: "Processo interno A01" } });
    fireEvent.change(selectsAfterQueue[3], { target: { value: "sector-1" } });
    await waitFor(() => expect(screen.getAllByRole("combobox").length).toBeGreaterThan(5));
    const processSelects = screen.getAllByRole("combobox");
    fireEvent.change(processSelects[4], { target: { value: "queue-1" } });
    fireEvent.change(processSelects[5], { target: { value: "queue-1" } });
    fireEvent.change(processSelects[6], { target: { value: "user-manager" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar draft" }));
    await waitFor(() => expect(bpmApi.createProcess).toHaveBeenCalled());

    cleanup();
    render(<MemoryRouter initialEntries={["/requests/bpm/admin/versions/version-1"]}><Routes><Route path="/requests/bpm/admin/versions/:id" element={<BpmVersionPage />} /></Routes></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("Formulário e metas")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Primeira resposta (minutos)"), { target: { value: "60" } });
    fireEvent.change(screen.getByLabelText("Resolução (minutos)"), { target: { value: "480" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar campo" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(bpmApi.patchVersion).toHaveBeenCalledWith("version-1", expect.objectContaining({ definition: expect.objectContaining({ sla: { firstResponseMinutes: 60, resolutionMinutes: 480 }, form: expect.any(Array) }) })));
    fireEvent.click(screen.getByRole("button", { name: "Validar" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Publicar" }).hasAttribute("disabled")).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Publicar" }));
    await waitFor(() => expect(bpmApi.publishVersion).toHaveBeenCalledWith("version-1", expect.objectContaining({ validatedHash: "hash-a01" })));
    expect(published).toBe(true);

    const publishedVersion = { ...process.versions[0], bpmStatus: "published", bpmContentHash: "hash-a01", category: { id: "process-1", configRevision: 1 } };
    vi.mocked(bpmApi.version).mockResolvedValue(publishedVersion as any);
    cleanup();
    render(<MemoryRouter initialEntries={["/requests/bpm/admin/versions/version-1"]}><Routes><Route path="/requests/bpm/admin/versions/:id" element={<BpmVersionPage />} /></Routes></MemoryRouter>);
    await waitFor(() => expect(screen.getByRole("button", { name: "Habilitar" }).hasAttribute("disabled")).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Habilitar" }));
    await waitFor(() => expect(bpmApi.enable).toHaveBeenCalledWith("process-1", 1));

    cleanup();
    render(<MemoryRouter><BpmNewRequestPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByRole("option", { name: "Processo P01 UI" })).toBeTruthy());
  });
});
