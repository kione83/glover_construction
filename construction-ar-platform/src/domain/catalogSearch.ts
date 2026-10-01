import type { CatalogObject, ObjectCategory } from "./projects";
export const catalogCategoryLabels: Record<ObjectCategory, string> = {
  electrical: "Electrical", hvac: "Heating & cooling", "low-voltage": "Low voltage",
  "life-safety": "Life safety", plumbing: "Plumbing", architectural: "Architectural",
  furniture: "Furniture", general: "General",
};
export function searchCatalog(items: CatalogObject[], query: string, category?: ObjectCategory): CatalogObject[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter(item => (!category || item.category === category) && terms.every(term =>
    [item.name, item.sku, item.description, item.category, catalogCategoryLabels[item.category], item.placementMode, ...item.tags]
      .filter(Boolean).join(" ").toLowerCase().includes(term)));
}
