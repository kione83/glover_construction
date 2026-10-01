import { describe, expect, it } from "vitest";
import { starterCatalog } from "./catalog";
import { searchCatalog } from "./catalogSearch";
describe("catalog browsing", () => {
  it("searches names, SKUs, tags and trade labels without case or whitespace sensitivity", () => {
    expect(searchCatalog(starterCatalog, "  ELEC-001 ")[0].id).toBe("electrical-outlet-duplex");
    expect(searchCatalog(starterCatalog, "living-room")[0].id).toBe("furniture-sofa");
    expect(searchCatalog(starterCatalog, "Heating thermostat")[0].id).toBe("thermostat-standard");
  });
  it("combines all search terms with the selected trade", () => {
    expect(searchCatalog(starterCatalog, "ceiling", "hvac").map(item => item.id)).toEqual(["hvac-register-ceiling"]);
    expect(searchCatalog(starterCatalog, "sofa", "electrical")).toEqual([]);
    expect(searchCatalog(starterCatalog, "   ")).toEqual(starterCatalog);
  });
});
