import { scannedObstacleBoxes } from "./scannedObstacles";
import { starterCatalog } from "./catalog";
import type {
  CatalogObject,
  Project,
  ValidationIssue,
} from "./projects";
import { defaultValidationRules } from "./validation";

import { normalizePlacedObject } from "./roomObjectHierarchy";
import { placementBox, placementBoxesOverlap } from "./placementGeometry";

export function validateProject(project: Project, detectedAt = new Date().toISOString()): ValidationIssue[] {
  // Normalize legacy surface-anchored/project-local poses through the same path as the viewer.
  project = { ...project, placedObjects: project.placedObjects.map(object => normalizePlacedObject(object, project)) };
  const catalogById = new Map(starterCatalog.map((item) => [item.id, item]));
  const issues = [
    ...validatePlacementFrames(project, detectedAt),
    ...validateAttachments(project, catalogById, detectedAt),
    ...validateCollisions(project, catalogById, detectedAt),
    ...validateClearances(project, catalogById, detectedAt),
    ...validateScannedObstacles(project, catalogById, detectedAt),
  ];

  return issues;
}

function validatePlacementFrames(project: Project, detectedAt: string) {
  const rule = getRule("placement-frame-check");
  return project.placedObjects.filter(object => object.status === "active").flatMap(object => {
    const room = project.roomCaptures.find(candidate => candidate.id === object.roomCaptureId);
    const local = object.roomLocalTransform;
    if (room && local && placementBox(local, object.dimensions)) return [];
    return [issue(rule.id, rule.severity, `${object.displayName} needs a valid room alignment and size before fit checks can include it. Reopen AR tools and align this placement.`, object.id, undefined, detectedAt)];
  });
}

function validateAttachments(project: Project, catalogById: Map<string, CatalogObject>, detectedAt: string) {
  const rule = getRule("attach-to-supported-surface");
  return project.placedObjects.flatMap((placedObject) => {
    if (placedObject.status !== "active") return [];
    const catalogObject = catalogById.get(placedObject.catalogObjectId);
    const anchor = project.anchors.find((candidate) => candidate.id === placedObject.anchorId);
    if (catalogObject?.placementMode === "free-place") return [];
    const room = project.roomCaptures.find((candidate) => candidate.id === placedObject.roomCaptureId);
    const surface = room?.surfaces.find((candidate) => candidate.id === anchor?.reference.surfaceId);
    if (!anchor || !surface || anchor.roomCaptureId !== placedObject.roomCaptureId) return [issue(rule.id, "warning", `${placedObject.displayName}'s surface attachment is unverified. Confirm an allowed mounting surface before installation.`, placedObject.id, undefined, detectedAt)];
    const isSupported = Boolean(
      catalogObject && anchor && surface && catalogObject.allowedSurfaceKinds.includes(surface.kind),
    );
    if (isSupported) return [];

    return [issue(rule.id, rule.severity, `${placedObject.displayName} is not attached to a supported surface. Move it to an allowed surface before review.`, placedObject.id, anchor?.reference.surfaceId, detectedAt)];
  });
}

function validateCollisions(project: Project, catalogById: Map<string, CatalogObject>, detectedAt: string) {
  const rule = getRule("object-collision-check");
  const active = project.placedObjects.filter(item => item.status === "active" && project.roomCaptures.some(room => room.id === item.roomCaptureId));
  const issues: ValidationIssue[] = [];
  for (let firstIndex = 0; firstIndex < active.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < active.length; secondIndex += 1) {
      const first = active[firstIndex];
      const second = active[secondIndex];
      if (first.roomCaptureId !== second.roomCaptureId || !catalogById.has(first.catalogObjectId) || !catalogById.has(second.catalogObjectId)) continue;
      const firstBox = first.roomLocalTransform && placementBox(first.roomLocalTransform, first.dimensions);
      const secondBox = second.roomLocalTransform && placementBox(second.roomLocalTransform, second.dimensions);
      if (firstBox && secondBox && placementBoxesOverlap(firstBox, secondBox)) {
        issues.push(issue(rule.id, rule.severity, `${first.displayName} may overlap ${second.displayName}. Their oriented size envelopes intersect; review the layout.`, first.id, undefined, detectedAt, `${first.id}-${second.id}`));
      }
    }
  }
  return issues;
}

function validateClearances(project: Project, catalogById: Map<string, CatalogObject>, detectedAt: string) {
  const rule = getRule("minimum-clearance-check");
  const active = project.placedObjects.filter(item => item.status === "active" && project.roomCaptures.some(room => room.id === item.roomCaptureId));
  const issues: ValidationIssue[] = [];
  for (const placedObject of active) {
    const catalogObject = catalogById.get(placedObject.catalogObjectId);
    if (!catalogObject?.defaultClearance || !placedObject.roomLocalTransform) continue;
    const clearanceBounds = placementBox(placedObject.roomLocalTransform, catalogObject.defaultClearance);
    if (!clearanceBounds) continue;
    for (const otherObject of active) {
      if (otherObject.id === placedObject.id || otherObject.roomCaptureId !== placedObject.roomCaptureId) continue;
      const otherBounds = otherObject.roomLocalTransform && placementBox(otherObject.roomLocalTransform, otherObject.dimensions);
      if (otherBounds && placementBoxesOverlap(clearanceBounds, otherBounds)) {
        issues.push(issue(rule.id, rule.severity, `${otherObject.displayName} enters ${placedObject.displayName}'s planning clearance envelope. Confirm actual working-space requirements before installation.`, placedObject.id, undefined, detectedAt, `${placedObject.id}-${otherObject.id}`));
      }
    }
  }
  return issues;
}

function validateScannedObstacles(project: Project, catalogById: Map<string, CatalogObject>, detectedAt: string): ValidationIssue[] {
  const rule = getRule("scanned-obstacle-check");
  const issues: ValidationIssue[] = [];
  for (const room of project.roomCaptures) {
    const obstacles = scannedObstacleBoxes(project, room);
    for (const object of project.placedObjects) {
      if (object.status !== "active" || object.roomCaptureId !== room.id || !object.roomLocalTransform) continue;
      const box = placementBox(object.roomLocalTransform, object.dimensions);
      if (!box) continue;
      const clearance = catalogById.get(object.catalogObjectId)?.defaultClearance;
      const clearanceBox = clearance && placementBox(object.roomLocalTransform, clearance);
      for (const obstacle of obstacles) {
        const overlaps = placementBoxesOverlap(box, obstacle.box);
        if (!overlaps && !(clearanceBox && placementBoxesOverlap(clearanceBox, obstacle.box))) continue;
        issues.push({ ...issue(rule.id, rule.severity,
          `${object.displayName} ${overlaps ? "may overlap" : "has a planning clearance envelope intersecting"} scanned ${obstacle.label} in ${room.name}. Review the approximate captured envelope and verify the actual space before installation.`,
          object.id, undefined, detectedAt, `${object.id}-${room.id}-${obstacle.id}`), relatedScanElementId: obstacle.id });
      }
    }
  }
  return issues;
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
