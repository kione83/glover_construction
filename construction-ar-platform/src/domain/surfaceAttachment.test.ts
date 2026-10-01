import { describe, expect, it } from "vitest";
import { createEmptyProjectDocument } from "../storage/projectDocument";
import { identityTransform, type PlacedObject } from "./projects";
import { canonicalTransform, composeTransforms } from "./spatialTransforms";
import { placementSurfaceForAR, savePlacementSurface, type PlacementSurfaceObservation } from "./surfaceAttachment";
import { validateProject } from "./validationService";
import { applyCatalogPlacementEdits } from "./catalogPlacement";
const local = canonicalTransform({ position: { x: 1, y: 1.2, z: 0.02 } });
function fixture() {
  const project = createEmptyProjectDocument({ id: "p", name: "Room", roomCaptures: [{ id: "room", name: "Room", status: "completed", source: "roomplan", unit: "m", surfaces: [] }] }).project;
  const object: PlacedObject = { id: "outlet", catalogObjectId: "electrical-outlet-duplex", roomCaptureId: "room", anchorId: "old", displayName: "Outlet", transform: local, roomLocalTransform: local, transformSpace: "room-local", dimensions: { width: 0.08, height: 0.12, depth: 0.04, unit: "m" }, status: "active", placedAt: "2026-10-01", updatedAt: "2026-10-01" };
  return { project, object };
}
const observation: PlacementSurfaceObservation = { id: "plane", kind: "wall", observedAt: "2026-10-01T22:00:00Z", transformMatrix: canonicalTransform({ position: { x: 1, y: 1.2, z: 0 } }).matrix! };
it("converts observed support evidence into the room frame and restores it into a different AR session", () => {
  const { project, object } = fixture();
  const worldFromRoom = canonicalTransform({ position: { x: 4, y: 2, z: -8 }, rotation: { pitch: 0, yaw: 0.8, roll: 0 } });
  const worldObservation = { ...observation, transformMatrix: composeTransforms(worldFromRoom, { matrix: observation.transformMatrix }).matrix! };
  const saved = savePlacementSurface(project, object, worldObservation, worldFromRoom);
  expect(saved.anchors).toHaveLength(1);
  expect(saved.anchors[0].transform.position.x).toBeCloseTo(1);
  expect(saved.anchors[0].transform.position.y).toBeCloseTo(1.2);
  expect(saved.anchors[0].transform.position.z).toBeCloseTo(0);
  expect(validateProject(saved).filter(issue => issue.ruleId === "attach-to-supported-surface")).toHaveLength(0);
  const reopened = JSON.parse(JSON.stringify(saved));
  const otherSession = canonicalTransform({ position: { x: -2, y: 0, z: 9 }, rotation: { pitch: 0, yaw: -0.4, roll: 0 } });
  const restored = placementSurfaceForAR(reopened, reopened.placedObjects[0], otherSession)!;
  const expected = composeTransforms(otherSession, { matrix: observation.transformMatrix }).matrix!;
  restored.transformMatrix.forEach((value, i) => expect(value).toBeCloseTo(expected[i]));
  expect(restored.observedAt).toBe(observation.observedAt);
  expect(project.anchors).toHaveLength(0);
});

describe("attachment trust", () => {
  it.each([undefined, { ...observation, kind: "floor" as const }, { ...observation, observedAt: "bad-date" }, { ...observation, transformMatrix: [1,2] }, { ...observation, transformMatrix: Array(16).fill(0) }])("leaves invalid or unsupported evidence unverified", candidate => {
    const { project, object } = fixture();
    const saved = savePlacementSurface(project, object, candidate, identityTransform());
    expect(saved.anchors).toHaveLength(0);
    expect(saved.roomCaptures[0].surfaces).toHaveLength(0);
    expect(validateProject(saved).some(issue => issue.message.includes("unverified"))).toBe(true);
  });
  it("does not reinterpret an unaligned AR observation as room-local evidence", () => {
    const { project, object } = fixture();
    const saved = savePlacementSurface(project, { ...object, roomLocalTransform: undefined, transformSpace: "ar-world" }, observation);
    expect(saved.anchors).toHaveLength(0);
  });
  it("replaces evidence on moves without accumulating surface records and invalidates saved-model edits", () => {
    const { project, object } = fixture();
    let saved = savePlacementSurface(project, object, observation, identityTransform());
    saved = savePlacementSurface(saved, saved.placedObjects[0], { ...observation, id: "new-plane" }, identityTransform());
    expect(saved.anchors).toHaveLength(1);
    expect(saved.roomCaptures[0].surfaces).toHaveLength(1);
    const edited = applyCatalogPlacementEdits(saved, { outlet: canonicalTransform({ position: { x: 2, y: 1, z: 1 } }) });
    expect(placementSurfaceForAR(edited, edited.placedObjects[0], identityTransform())).toBeUndefined();
    expect(validateProject(edited).some(issue => issue.message.includes("unverified"))).toBe(true);
    saved = savePlacementSurface(saved, saved.placedObjects[0], undefined, identityTransform());
    expect(saved.anchors).toHaveLength(0);
    expect(saved.roomCaptures[0].surfaces).toHaveLength(0);
  });
});
