import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/context/AuthContext", () => ({
  useAuth: () => ({
    user: { email: "synthetic@example.invalid", roles: ["admin"] },
    logout: vi.fn(),
    hasPermission: () => true,
  }),
}));
vi.mock("../src/context/ThemeContext", () => ({
  useTheme: () => ({ theme: "light", toggleTheme: vi.fn() }),
}));
vi.mock("../src/features/requisicoes-bpm/api", () => ({
  bpmApi: { capabilities: vi.fn().mockResolvedValue({ enabled: true }) },
}));
vi.mock("../src/components/layout/NotificationsDropdown", () => ({
  NotificationsDropdown: () => <span aria-hidden="true" />,
}));

import { AppLayout } from "../src/components/layout/AppLayout";

describe("mobile navigation", () => {
  it("keeps the sidebar reachable by keyboard through an accessible toggle", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    render(
      <MemoryRouter>
        <AppLayout breadcrumb={["Teste"]}>
          <p>Conteúdo</p>
        </AppLayout>
      </MemoryRouter>,
    );
    const toggle = screen.getByRole("button", { name: "Abrir menu" });
    const sidebar = document.getElementById("axis-app-sidebar");
    expect(toggle.getAttribute("aria-controls")).toBe("axis-app-sidebar");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-label")).toBe("Fechar menu");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(sidebar?.className).toContain("axis-app-sidebar-open");
  });
});
