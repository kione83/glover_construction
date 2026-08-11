import type { ValidationRule } from "./projects";

export const defaultValidationRules: ValidationRule[] = [
  {
    id: "attach-to-supported-surface",
    type: "attachment",
    name: "Supported surface attachment",
    description: "Mounted objects must be attached to an allowed surface type.",
    severity: "error",
    appliesToCategories: [
      "architectural",
      "electrical",
      "hvac",
      "life-safety",
      "low-voltage",
      "plumbing",
      "general",
    ],
  },
  {
    id: "object-collision-check",
    type: "collision",
    name: "Object collision check",
    description: "Placed objects should not overlap in the same physical space.",
    severity: "warning",
    appliesToCategories: [
      "architectural",
      "electrical",
      "hvac",
      "life-safety",
      "low-voltage",
      "plumbing",
      "general",
    ],
  },
  {
    id: "minimum-clearance-check",
    type: "clearance",
    name: "Minimum clearance check",
    description: "Clearance-sensitive objects must maintain their working space.",
    severity: "warning",
    appliesToCategories: ["electrical", "hvac", "plumbing"],
  },
];
