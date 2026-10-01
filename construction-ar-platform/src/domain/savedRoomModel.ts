import type { Transform3D } from "./spatial";
import type { Project, RoomCapture } from "./projects";
import { roomAssemblyBounds, roomDimensionLabel } from "./roomAssembly";
import { savedPlacementElements } from "./roomObjectHierarchy";
import { assemblyRootPose, capturedObjectPose, scannedObjectRoots } from "./scannedObjectAssemblies";
import { canonicalTransform, capturedTransform, composeTransforms, relativeTransform } from "./spatialTransforms";

export function savedViewerScan(scan: NonNullable<RoomCapture["roomScan"]>, overrides: Record<string, Transform3D> = {}) {
  const { nativeCapturedRoomJSON: _archive, ...renderScan } = scan;
  const roots = scannedObjectRoots(scan);
  const poses = new Map([...new Set(roots.values())].map(id => [id, assemblyRootPose(scan, id, overrides)]));
  return { ...renderScan,
    elements: renderScan.elements.map(element => {
      const rootId = roots.get(element.id);
      if (!rootId) return { ...element, transform: capturedObjectPose(element) };
      const root = scan.elements.find(candidate => candidate.id === rootId)!;
      const pose = poses.get(rootId)!;
      const local = relativeTransform(capturedObjectPose(root), capturedObjectPose(element));
      return { ...element, objectRootId: rootId, objectRootTransform: pose,
        transform: local ? composeTransforms(pose, local) : capturedObjectPose(element) };
    }),
    arkitMesh: renderScan.arkitMesh ? { ...renderScan.arkitMesh, anchors: renderScan.arkitMesh.anchors.map(anchor => ({ ...anchor, transform: capturedTransform(anchor.transform) })) } : undefined,
  };
}

/** All geometry remains a child of its room. Camera/project transforms never enter child data. */
export function savedRoomModel(project: Project, mode: "room" | "project" | "alignment", roomId?: string) {
  return { projectId: project.id, mode, rooms: project.roomCaptures
    .filter(room => room.roomScan && (mode !== "room" || room.id === roomId))
    .map(room => ({ id: room.id, name: room.name, roomDimensionsLabel: roomDimensionLabel(room), assemblyCenter: roomAssemblyBounds(room).center,
      roomScan: room.roomScan ? savedViewerScan(room.roomScan, project.spatialModel?.objectTransforms?.[room.id]) : undefined,
      placedObjects: savedPlacementElements(project, room),
      // A single-room inspection uses room coordinates; assembly uses saved room -> project.
      transform: canonicalTransform(mode === "room" ? undefined : project.spatialModel?.roomTransforms?.[room.id]),
    })),
  };
}
