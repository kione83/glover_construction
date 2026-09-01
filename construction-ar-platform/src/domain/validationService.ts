import { starterCatalog } from "./catalog";
import type {
  CatalogObject,
  PlacedObject,
  Project,
  ValidationIssue,
} from "./projects";
import { defaultValidationRules } from "./validation";

const METERS_PER_UNIT = {
  in: 0.0254,
  ft: 0.3048,
  mm: 0.001,
  cm: 0.01,
  m: 1,
} as const;

type Bounds = { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } };

export function validateProject(project: Project, detectedAt = new Date().toISOString()): ValidationIssue[] {
  const catalogById = new Map(starterCatalog.map((item) => [item.id, item]));
  const issues = [
    ...validateAttachments(project, catalogById, detectedAt),
    ...validateCollisions(project, catalogById, detectedAt),
    ...validateClearances(project, catalogById, detectedAt),
  ];

  return issues;
}

function validateAttachments(project: Project, catalogById: Map<string, CatalogObject>, detectedAt: string) {
  const rule = getRule("attach-to-supported-surface");
  return project.placedObjects.flatMap((placedObject) => {
    if (placedObject.status !== "active") return [];
    const catalogObject = catalogById.get(placedObject.catalogObjectId);
    const anchor = project.anchors.find((candidate) => candidate.id === placedObject.anchorId);
    const room = project.roomCaptures.find((candidate) => candidate.id === placedObject.roomCaptureId);
    const surface = room?.surfaces.find((candidate) => candidate.id === anchor?.reference.surfaceId);
    const isSupported = Boolean(
      catalogObject && anchor && surface && catalogObject.allowedSurfaceKinds.includes(surface.kind),
    );
    if (isSupported) return [];

    return [issue(rule.id, rule.severity, `${placedObject.displayName} is not attached to a supported surface. Move it to an allowed surface before review.`, placedObject.id, anchor?.reference.surfaceId, detectedAt)];
  });
}

function validateCollisions(project: Project, catalogById: Map<string, CatalogObject>, detectedAt: string) {
  const rule = getRule("object-collision-check");
  const active = project.placedObjects.filter((item) => item.status === "active");
  const issues: ValidationIssue[] = [];
  for (let firstIndex = 0; firstIndex < active.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < active.length; secondIndex += 1) {
      const first = active[firstIndex];
      const second = active[secondIndex];
      if (first.roomCaptureId !== second.roomCaptureId || !catalogById.has(first.catalogObjectId) || !catalogById.has(second.catalogObjectId)) continue;
      if (boundsOverlap(objectBounds(first), objectBounds(second))) {
        issues.push(issue(rule.id, rule.severity, `${first.displayName} overlaps ${second.displayName}. Reposition one of the objects to remove the overlap.`, first.id, undefined, detectedAt, `${first.id}-${second.id}`));
      }
    }
  }
  return issues;
}

function validateClearances(project: Project, catalogById: Map<string, CatalogObject>, detectedAt: string) {
  const rule = getRule("minimum-clearance-check");
  const active = project.placedObjects.filter((item) => item.status === "active");
  const issues: ValidationIssue[] = [];
  for (const placedObject of active) {
    const catalogObject = catalogById.get(placedObject.catalogObjectId);
    if (!catalogObject?.defaultClearance) continue;
    const clearanceBounds = dimensionsBounds(placedObject.transform.position, catalogObject.defaultClearance);
    for (const otherObject of active) {
      if (otherObject.id === placedObject.id || otherObject.roomCaptureId !== placedObject.roomCaptureId) continue;
      if (boundsOverlap(clearanceBounds, objectBounds(otherObject))) {
        issues.push(issue(rule.id, rule.severity, `${otherObject.displayName} is inside ${placedObject.displayName}'s required clearance area. Move it outside the clearance area.`, placedObject.id, undefined, detectedAt, `${placedObject.id}-${otherObject.id}`));
      }
    }
  }
  return issues;
}

function objectBounds(placedObject: PlacedObject): Bounds {
  return dimensionsBounds(placedObject.transform.position, placedObject.dimensions);
}

function dimensionsBounds(position: { x: number; y: number; z: number }, dimensions: { width: number; height: number; depth: number; unit: keyof typeof METERS_PER_UNIT }): Bounds {
  const factor = METERS_PER_UNIT[dimensions.unit];
  const halfWidth = (dimensions.width * factor) / 2;
  const halfHeight = (dimensions.height * factor) / 2;
  const halfDepth = (dimensions.depth * factor) / 2;
  return {
    min: { x: position.x - halfWidth, y: position.y - halfHeight, z: position.z - halfDepth },
    max: { x: position.x + halfWidth, y: position.y + halfHeight, z: position.z + halfDepth },
  };
}

function boundsOverlap(first: Bounds, second: Bounds) {
  return first.min.x < second.max.x && first.max.x > second.min.x && first.min.y < second.max.y && first.max.y > second.min.y && first.min.z < second.max.z && first.max.z > second.min.z;
}

function getRule(id: string) {
  const rule = defaultValidationRules.find((candidate) => candidate.id === id);
  if (!rule) throw new Error(`Missing validation rule: ${id}`);
  return rule;
}

function issue(
  ruleId: string,
  severity: ValidationIssue["severity"],
  message: string,
  objectId: string,
  surfaceId: string | undefined,
  detectedAt: string,
  identity = objectId,
): ValidationIssue {
  return { id: `${ruleId}-${identity}`, ruleId, severity, message, objectId, surfaceId, detectedAt };
}
