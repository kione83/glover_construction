import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";

import {
  disconnectRoomFromProject,
  identityTransform,
  relativeYawTransform,
  setRoomProjectTransform,
  type Project,
  type RoomCapture,
  type RoomScanElement,
  type Transform3D,
} from "../../domain";
import { updateProjectSummary } from "../../storage/projectDocument";
import { loadProjectDocuments, saveProjectDocuments } from "../../storage/projectRepository";
import { colors } from "../../theme/colors";
import { NativeSavedRoom3DView, savedRoom3DViewAvailable, type SceneSelectionEvent } from "./NativeSavedRoom3DView";

export type SavedRoomViewerMode = "room" | "project" | "alignment";

interface SavedRoomViewerScreenProps {
  projectId: string;
  roomId?: string;
  mode: SavedRoomViewerMode;
  onClose: () => void;
  onOpenAlignment?: (roomId?: string) => void;
}

const architecturalKinds = new Set(["door", "opening", "wall", "floor", "ceiling", "window", "built-in"]);

function roomTransform(project: Project, roomId: string): Transform3D {
  return project.spatialModel?.roomTransforms[roomId] ?? identityTransform();
}

function modelFor(project: Project, mode: SavedRoomViewerMode, roomId?: string, transforms?: Record<string, Transform3D>) {
  const rooms = project.roomCaptures
    .filter((room) => mode !== "room" || room.id === roomId)
    .map((room) => ({
      id: room.id,
      name: room.name,
      roomScan: room.roomScan,
      transform: transforms?.[room.id] ?? roomTransform(project, room.id),
    }));
  return JSON.stringify({ projectId: project.id, mode, rooms });
}

function featureList(room?: RoomCapture): RoomScanElement[] {
  return (room?.roomScan?.elements ?? []).filter((element) => architecturalKinds.has(element.kind));
}

function connectionTypeFor(feature?: RoomScanElement): "door" | "doorway" | "shared-wall" | "corner" | "opening" | "hallway" | "stairs" | "other" {
  if (!feature) return "other";
  if (feature.representation === "stairs" || feature.category === "stairs") return "stairs";
  if (feature.kind === "door") return "door";
  if (feature.kind === "opening") return "opening";
  if (feature.kind === "wall") return "shared-wall";
  return "other";
}

export function SavedRoomViewerScreen({ projectId, roomId, mode, onClose, onOpenAlignment }: SavedRoomViewerScreenProps) {
  const [project, setProject] = useState<Project>();
  const [selectedRoomId, setSelectedRoomId] = useState(roomId);
  const [selectedFeatureIds, setSelectedFeatureIds] = useState<string[]>([]);
  const [draftTransforms, setDraftTransforms] = useState<Record<string, Transform3D>>({});
  const [roomAId, setRoomAId] = useState("");
  const [roomBId, setRoomBId] = useState("");
  const [featureAId, setFeatureAId] = useState("");
  const [featureBId, setFeatureBId] = useState("");
  const [showMeasurements, setShowMeasurements] = useState(true);
  const [resetRequestId, setResetRequestId] = useState(0);

  useEffect(() => {
    void loadProjectDocuments().then((documents) => {
      const loaded = documents.find((document) => document.project.id === projectId)?.project;
      if (!loaded) return;
      setProject(loaded);
      const transforms = Object.fromEntries(loaded.roomCaptures.map((room) => [room.id, roomTransform(loaded, room.id)]));
      setDraftTransforms(transforms);
      const scanRooms = loaded.roomCaptures.filter((room) => room.roomScan);
      const defaultRoomA = scanRooms.find((room) => room.id !== roomId)?.id ?? scanRooms[0]?.id ?? loaded.roomCaptures[0]?.id ?? "";
      const defaultRoomB = mode === "alignment" && roomId ? roomId : scanRooms.find((room) => room.id !== defaultRoomA)?.id ?? scanRooms[1]?.id ?? loaded.roomCaptures[1]?.id ?? "";
      setRoomAId(defaultRoomA);
      setRoomBId(defaultRoomB);
      setSelectedRoomId(roomId ?? scanRooms[0]?.id ?? loaded.roomCaptures[0]?.id);
    });
  }, [projectId, roomId, mode]);

  const roomA = project?.roomCaptures.find((room) => room.id === roomAId);
  const roomB = project?.roomCaptures.find((room) => room.id === roomBId);
  const title = mode === "room" ? "Saved 3D scan" : mode === "alignment" ? "Manual room alignment" : "Project 3D model";
  const visibleTransforms = mode === "alignment" ? draftTransforms : undefined;
  const modelJSON = project ? modelFor(project, mode, roomId, visibleTransforms) : JSON.stringify({ rooms: [] });
  const selectedFeatureIdsForNative = [featureAId, featureBId].filter(Boolean);

  async function persistProject(nextProject: Project) {
    const documents = await loadProjectDocuments();
    await saveProjectDocuments(documents.map((document) => document.project.id === nextProject.id ? { ...document, project: nextProject } : document));
    setProject(nextProject);
  }

  function handleSelection(event: { nativeEvent: SceneSelectionEvent }) {
    const selection = event.nativeEvent;
    if (selection.roomId) setSelectedRoomId(selection.roomId);
    if (mode !== "alignment" || !selection.featureId || !selection.roomId) return;
    if (selection.roomId === roomAId) setFeatureAId(selection.featureId);
    if (selection.roomId === roomBId) setFeatureBId(selection.featureId);
  }

  function updateDraftTransform(roomIdValue: string, transform: Transform3D) {
    setDraftTransforms((current) => ({ ...current, [roomIdValue]: transform }));
  }

  function adjust(axis: "x" | "y" | "z" | "yaw", amount: number) {
    if (!roomBId) return;
    const current = draftTransforms[roomBId] ?? identityTransform();
    const next = {
      ...current,
      position: { ...current.position, ...(axis === "x" ? { x: current.position.x + amount } : {}), ...(axis === "y" ? { y: current.position.y + amount } : {}), ...(axis === "z" ? { z: current.position.z + amount } : {}) },
      rotation: { ...current.rotation, ...(axis === "yaw" ? { yaw: current.rotation.yaw + amount } : {}) },
    };
    updateDraftTransform(roomBId, next);
  }

  function alignSelectedFeatures() {
    if (!project || !roomA || !roomB || !featureAId || !featureBId) {
      Alert.alert("Select two features", "Tap or choose one architectural feature in Room A and one in Room B.");
      return;
    }
    const featureA = roomA.roomScan?.elements.find((element) => element.id === featureAId);
    const featureB = roomB.roomScan?.elements.find((element) => element.id === featureBId);
    if (!featureA || !featureB) return;
    const transformA = draftTransforms[roomA.id] ?? roomTransform(project, roomA.id);
    const featureYawA = transformA.rotation.yaw + featureA.transform.rotation.yaw;
    const targetYaw = featureYawA - featureB.transform.rotation.yaw;
    const cos = Math.cos(targetYaw);
    const sin = Math.sin(targetYaw);
    const featureWorldA = {
      x: transformA.position.x + featureA.transform.position.x * Math.cos(transformA.rotation.yaw) - featureA.transform.position.z * Math.sin(transformA.rotation.yaw),
      y: transformA.position.y + featureA.transform.position.y,
      z: transformA.position.z + featureA.transform.position.x * Math.sin(transformA.rotation.yaw) + featureA.transform.position.z * Math.cos(transformA.rotation.yaw),
    };
    updateDraftTransform(roomB.id, {
      position: { x: featureWorldA.x - (featureB.transform.position.x * cos - featureB.transform.position.z * sin), y: featureWorldA.y - featureB.transform.position.y, z: featureWorldA.z - (featureB.transform.position.x * sin + featureB.transform.position.z * cos) },
      rotation: { pitch: 0, yaw: targetYaw, roll: 0 },
      scale: { x: 1, y: 1, z: 1 },
    });
  }

  async function saveAlignment() {
    if (!project || !roomAId || !roomBId || roomAId === roomBId) return;
    const parent = draftTransforms[roomAId] ?? roomTransform(project, roomAId);
    const child = draftTransforms[roomBId] ?? roomTransform(project, roomBId);
    const relative = relativeYawTransform(parent, child);
    const parentFeature = roomA?.roomScan?.elements.find((element) => element.id === featureAId);
    const nextProject = updateProjectSummary({
      ...setRoomProjectTransform(project, roomBId, child),
      spatialModel: {
        coordinateSystem: "project-local",
        roomTransforms: { ...(project.spatialModel?.roomTransforms ?? {}), [roomAId]: parent, [roomBId]: child },
        connections: [
          ...(project.spatialModel?.connections ?? []).filter((connection) => connection.childRoomId !== roomBId),
          { id: `connection-${Date.now()}`, parentRoomId: roomAId, childRoomId: roomBId, connectionType: connectionTypeFor(parentFeature), parentFeatureId: featureAId || undefined, childFeatureId: featureBId || undefined, transform: relative, alignmentMethod: "user-assisted", elevationChangeMeters: relative.position.y, createdAt: new Date().toISOString() },
        ],
      },
    });
    await persistProject(nextProject);
    Alert.alert("Alignment saved", "The room-to-project transform is stored separately from the captured room geometry.");
  }

  async function disconnectSelectedRoom() {
    if (!project || !selectedRoomId) return;
    await persistProject(updateProjectSummary(disconnectRoomFromProject(project, selectedRoomId)));
  }

  const selectedRoom = project?.roomCaptures.find((room) => room.id === selectedRoomId);
  if (!project) return <SafeAreaView style={styles.center}><Text style={styles.text}>Loading saved model…</Text></SafeAreaView>;

  return <SafeAreaView style={styles.screen}>
    <View style={styles.header}><View><Text style={styles.eyebrow}>PERSISTED ROOMPLAN GEOMETRY</Text><Text style={styles.title}>{title}</Text></View><Pressable onPress={onClose} style={styles.close}><Text style={styles.closeText}>Close</Text></Pressable></View>
    {!savedRoom3DViewAvailable && <Text style={styles.warning}>The interactive 3D viewer requires the iOS development build. The saved scan data remains intact.</Text>}
    <NativeSavedRoom3DView style={styles.viewer} modelJSON={modelJSON} selectedRoomId={selectedRoomId} selectedFeatureIdsJSON={JSON.stringify(mode === "alignment" ? selectedFeatureIdsForNative : selectedFeatureIds)} editingRoomId={mode === "alignment" ? roomBId : undefined} allowDirectManipulation={mode === "alignment"} showMeasurements={showMeasurements} resetRequestId={resetRequestId} onSceneSelection={handleSelection} onRoomTransformChange={(event) => updateDraftTransform(event.nativeEvent.roomId, event.nativeEvent.transform)} />
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.toolbar}><Text style={styles.helper}>Orbit, pan, and pinch to inspect. Tap a room or architectural feature to select it.</Text><View style={styles.buttonRow}><Button label="Reset view" onPress={() => setResetRequestId((value) => value + 1)} /><Button label={showMeasurements ? "Hide measurements" : "Show measurements"} onPress={() => setShowMeasurements((value) => !value)} /></View></View>
      {mode === "alignment" && <>
        <View style={styles.panel}><Text style={styles.section}>1. Select rooms</Text><RoomChips rooms={project.roomCaptures.filter((room) => room.roomScan)} value={roomAId} onChange={setRoomAId} label="Room A" /><RoomChips rooms={project.roomCaptures.filter((room) => room.roomScan)} value={roomBId} onChange={setRoomBId} label="Room B" /></View>
        <View style={styles.panel}><Text style={styles.section}>2. Select architectural features</Text><FeatureChips label="Room A feature" features={featureList(roomA)} value={featureAId} onChange={setFeatureAId} /><FeatureChips label="Room B feature" features={featureList(roomB)} value={featureBId} onChange={setFeatureBId} /><Button label="Align selected features" onPress={alignSelectedFeatures} /><Text style={styles.helper}>Doors, openings, walls, corners, floors, landings, and stair geometry are eligible. Furniture is never used as an anchor.</Text></View>
        <View style={styles.panel}><Text style={styles.section}>3. Fine adjustment · Room B</Text><Text style={styles.helper}>Directly drag the highlighted Room B where supported, or use 1 cm / 1° increments.</Text><View style={styles.adjustGrid}>{[["X −", "x", -0.01], ["X +", "x", 0.01], ["Y −", "y", -0.01], ["Y +", "y", 0.01], ["Z −", "z", -0.01], ["Z +", "z", 0.01], ["Yaw −", "yaw", -Math.PI / 180], ["Yaw +", "yaw", Math.PI / 180]].map(([label, axis, amount]) => <Button key={String(label)} label={String(label)} onPress={() => adjust(axis as "x" | "y" | "z" | "yaw", Number(amount))} />)}</View><Button label="Save room-to-project alignment" onPress={() => void saveAlignment()} /></View>
      </>}
      {mode === "project" && <View style={styles.panel}><Text style={styles.section}>Project rooms</Text>{project.roomCaptures.map((room) => <View key={room.id} style={[styles.roomLine, selectedRoomId === room.id && styles.selectedLine]}><Pressable style={styles.roomSelect} onPress={() => setSelectedRoomId(room.id)}><Text style={styles.roomName}>{room.name}</Text><Text style={styles.helper}>Transform: {(draftTransforms[room.id] ?? roomTransform(project, room.id)).position.y.toFixed(2)} m elevation</Text></Pressable>{room.roomScan && onOpenAlignment && <Button label="Edit alignment" onPress={() => onOpenAlignment(room.id)} />}</View>)}{selectedRoomId && <Button label={`Disconnect ${selectedRoom?.name ?? "room"}`} onPress={() => void disconnectSelectedRoom()} />}</View>}
      {mode === "room" && <View style={styles.panel}><Text style={styles.section}>{selectedRoom?.name ?? "Room"}</Text><Text style={styles.helper}>This model is reconstructed from the saved RoomPlan-derived geometry and native CapturedRoom archive. No new scan is started.</Text>{selectedRoom?.roomScan?.arkitMesh && <Text style={styles.helper}>Bounded ARKit mesh retained: {selectedRoom.roomScan.arkitMesh.anchors.length} architectural mesh anchors.</Text>}</View>}
    </ScrollView>
  </SafeAreaView>;
}

function RoomChips({ rooms, value, onChange, label }: { rooms: RoomCapture[]; value: string; onChange: (value: string) => void; label: string }) {
  return <View style={styles.field}><Text style={styles.label}>{label}</Text><View style={styles.chips}>{rooms.map((room) => <Pressable key={room.id} onPress={() => onChange(room.id)} style={[styles.chip, value === room.id && styles.chipSelected]}><Text style={styles.chipText}>{room.name}</Text></Pressable>)}</View></View>;
}

function FeatureChips({ features, value, onChange, label }: { features: RoomScanElement[]; value: string; onChange: (value: string) => void; label: string }) {
  return <View style={styles.field}><Text style={styles.label}>{label}</Text><View style={styles.chips}>{features.length === 0 && <Text style={styles.helper}>No saved architectural features.</Text>}{features.map((feature) => <Pressable key={feature.id} onPress={() => onChange(feature.id)} style={[styles.chip, value === feature.id && styles.chipSelected]}><Text style={styles.chipText}>{feature.category} · {feature.id.slice(0, 8)}</Text></Pressable>)}</View></View>;
}

function Button({ label, onPress }: { label: string; onPress: () => void }) { return <Pressable onPress={onPress} style={styles.button}><Text style={styles.buttonText}>{label}</Text></Pressable>; }

const styles = StyleSheet.create({ screen: { flex: 1, backgroundColor: colors.background }, center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }, header: { padding: 18, flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: colors.surface, borderBottomWidth: 1, borderColor: colors.border }, eyebrow: { color: colors.accent, fontSize: 11, fontWeight: "800", letterSpacing: 1 }, title: { color: colors.text, fontSize: 24, fontWeight: "800", marginTop: 5 }, close: { borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 9 }, closeText: { color: colors.text, fontWeight: "700" }, viewer: { height: 390, margin: 12, backgroundColor: "#111827", borderWidth: 1, borderColor: colors.border }, content: { padding: 12, gap: 12, paddingBottom: 32 }, toolbar: { gap: 10 }, buttonRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, button: { alignSelf: "flex-start", backgroundColor: colors.accent, paddingHorizontal: 12, paddingVertical: 9 }, buttonText: { color: colors.surface, fontWeight: "800", fontSize: 12 }, panel: { gap: 10, padding: 13, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }, section: { color: colors.text, fontSize: 15, fontWeight: "800" }, field: { gap: 6 }, label: { color: colors.text, fontSize: 12, fontWeight: "700" }, chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 }, chip: { borderWidth: 1, borderColor: colors.border, paddingHorizontal: 8, paddingVertical: 7, backgroundColor: colors.surface }, chipSelected: { borderColor: colors.accent, backgroundColor: colors.lightBlue }, chipText: { color: colors.text, fontSize: 11, fontWeight: "700" }, helper: { color: colors.muted, fontSize: 12, lineHeight: 18 }, text: { color: colors.text }, warning: { marginHorizontal: 12, marginTop: 10, color: "#9a6514", fontSize: 12 }, adjustGrid: { flexDirection: "row", flexWrap: "wrap", gap: 7 }, roomLine: { flexDirection: "row", alignItems: "center", gap: 8, borderTopWidth: 1, borderColor: colors.border, paddingVertical: 8 }, selectedLine: { borderColor: colors.accent }, roomSelect: { flex: 1 }, roomName: { color: colors.text, fontWeight: "800", marginBottom: 3 } });
