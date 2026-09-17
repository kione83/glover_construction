import type { Project, RoomCapture } from "./projects";
import { roomAssemblyBounds, roomDimensionLabel } from "./roomAssembly";
import { savedPlacementElements } from "./roomObjectHierarchy";
import { canonicalTransform, capturedTransform } from "./spatialTransforms";

export function savedViewerScan(scan: NonNullable<RoomCapture["roomScan"]>) {
  const { nativeCapturedRoomJSON: _archive, ...renderScan } = scan;
  return { ...renderScan,
    elements: renderScan.elements.map(element => ({ ...element, transform: element.roomLocalTransform ? canonicalTransform(element.roomLocalTransform) : capturedTransform(element.transform) })),
    arkitMesh: renderScan.arkitMesh ? { ...renderScan.arkitMesh, anchors: renderScan.arkitMesh.anchors.map(anchor => ({ ...anchor, transform: capturedTransform(anchor.transform) })) } : undefined,
  };
}

/** All geometry remains a child of its room. Camera/project transforms never enter child data. */
export function savedRoomModel(project: Project, mode: "room" | "project" | "alignment", roomId?: string) {
  return { projectId: project.id, mode, rooms: project.roomCaptures
    .filter(room => room.roomScan && (mode !== "room" || room.id === roomId))
    .map(room => ({ id: room.id, name: room.name, roomDimensionsLabel: roomDimensionLabel(room), assemblyCenter: roomAssemblyBounds(room).center,
      roomScan: room.roomScan ? savedViewerScan(room.roomScan) : undefined,
      placedObjects: savedPlacementElements(project, room),
      // A single-room inspection uses room coordinates; assembly uses saved room -> project.
      transform: canonicalTransform(mode === "room" ? undefined : project.spatialModel?.roomTransforms?.[room.id]),
    })),
  };
}
