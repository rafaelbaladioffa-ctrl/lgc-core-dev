import { describe, expect, it } from "vitest";
import { isBpmNavigationEnabled } from "../src/components/layout/AppLayout";

describe("BPM pilot navigation", () => {
  it("uses the server feature flag without requiring administrative BPM permissions", () => {
    const capabilities = {
      enabled: true,
      permissions: ["request_process:model"],
    };
    expect(isBpmNavigationEnabled(capabilities)).toBe(true);
    expect(isBpmNavigationEnabled({ enabled: false })).toBe(false);
  });
});
