import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";

import {
  identityTransform,
  type Project,
  type RoomCapture,
  type RoomScanElement,
  type RoomScanTransform,
  type Transform3D,
} from "../../domain";
import { initialAssemblyTransforms, moveAssemblyRoom, rotateAssemblyRoom, roomAssemblyBounds, roomDimensionLabel, saveAssemblyToProject, updateAssemblyTransform } from "../../domain/roomAssembly";
import { updateProjectSummary } from "../../storage/projectDocument";
import { loadProjectDocuments, saveProjectDocuments } from "../../storage/projectRepository";
import { colors } from "../../theme/colors";
import { savedRoomModel } from "../../domain/savedRoomModel";
import { alignRoomFeatures, canonicalTransform, capturedTransform, relativeTransform } from "../../domain/spatialTransforms";
import { formatObjectMeasurementDetails } from "../../domain/scannedObjects";
import { ObjectMeasurementsPanel } from "../roomScan/ObjectMeasurementsPanel";
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
  return canonicalTransform(project.spatialModel?.roomTransforms?.[roomId]);
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

export function SavedRoomViewerScreen({ projectId, roomId, mode, onClose }: SavedRoomViewerScreenProps) {
  const [project, setProject] = useState<Project>();
  const [selectedRoomId, setSelectedRoomId] = useState(roomId);
  const [selectedFeatureIds, setSelectedFeatureIds] = useState<string[]>([]);
  const [draftTransforms, setDraftTransforms] = useState<Record<string, Transform3D>>({});
  const [roomAId, setRoomAId] = useState("");
  const [roomBId, setRoomBId] = useState("");
  const [featureAId, setFeatureAId] = useState("");
  const [featureBId, setFeatureBId] = useState("");
  const [showMeasurements, setShowMeasurements] = useState(false);
  const [resetRequestId, setResetRequestId] = useState(0);
  const [focusRequestId, setFocusRequestId] = useState(0);
  const [lockedRoomId, setLockedRoomId] = useState<string>();
  const [moveMode, setMoveMode] = useState(false);
  const [toolsExpanded, setToolsExpanded] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState("Loading scans…");
  const [loadError, setLoadError] = useState<string>();
  const [step, setStep] = useState(0.1);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const saveRevision = useRef(0);
  const latestLayout = useRef({ transforms: draftTransforms, lockedRoomId });
  latestLayout.current = { transforms: draftTransforms, lockedRoomId };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Load the index first, then only the archives required by this viewer.
      const metadataDocuments = await loadProjectDocuments({ includeScans: false });
      const metadataProject = metadataDocuments.find((document) => document.project.id === projectId)?.project;
      if (!metadataProject || cancelled) return;
      const transforms = initialAssemblyTransforms(metadataProject);
      const scanRooms = metadataProject.roomCaptures.filter((room) => room.roomScan);
      const defaultRoomA = scanRooms.find((room) => room.id !== roomId)?.id ?? scanRooms[0]?.id ?? metadataProject.roomCaptures[0]?.id ?? "";
      const defaultRoomB = mode === "alignment" && roomId ? roomId : scanRooms.find((room) => room.id !== defaultRoomA)?.id ?? scanRooms[1]?.id ?? metadataProject.roomCaptures[1]?.id ?? "";
      const roomsToLoad = mode === "project"
        ? scanRooms.map((room) => room.id)
        : mode === "room"
          ? [roomId ?? defaultRoomA].filter(Boolean)
          : [defaultRoomA, defaultRoomB].filter(Boolean);
      setLockedRoomId(metadataProject.spatialModel?.lockedRoomId);
      setProject(metadataProject);
      setDraftTransforms(transforms);
      setRoomAId(defaultRoomA);
      setRoomBId(defaultRoomB);
      setSelectedRoomId(roomId ?? scanRooms[0]?.id ?? metadataProject.roomCaptures[0]?.id);

      const fullDocuments = await loadProjectDocuments({ includeScans: true, projectId, roomIds: roomsToLoad });
      const fullProject = fullDocuments.find((document) => document.project.id === projectId)?.project;
      if (!cancelled && fullProject) {
        setProject(fullProject);
        if (mode !== "room") setDraftTransforms(initialAssemblyTransforms(fullProject));
        setLoaded(true);
      }
    })().catch(error => { if (!cancelled) setLoadError(String(error)); });
    return () => { cancelled = true; };
  }, [projectId, roomId, mode]);

  const roomA = project?.roomCaptures.find((room) => room.id === roomAId);
  const roomB = project?.roomCaptures.find((room) => room.id === roomBId);
  const title = mode === "room" ? "Saved 3D scan" : mode === "alignment" ? "Manual room alignment" : "Project 3D model";
  // Geometry crosses the bridge once per loaded model. Placement updates use a
  // separate small prop; dragging never rebuilds walls/meshes/annotations.
  const modelJSON = useMemo(() => project && loaded ? JSON.stringify(savedRoomModel(project, mode, roomId)) : JSON.stringify({ rooms: [] }), [project, loaded, mode, roomId]);
  const transformsJSON = useMemo(() => JSON.stringify(mode === "room" ? {} : draftTransforms), [mode, draftTransforms]);

  async function saveLayout() {
    if (mode === "room" || !loaded) return;
    const snapshot = latestLayout.current;
    const revision = ++saveRevision.current;
    setSaveStatus("Saving…");
    const task = saveQueue.current.catch(() => undefined).then(async () => {
      // Read latest metadata, preserving archives, notes and scan measurements.
      const documents = await loadProjectDocuments({ includeScans: false });
      if (!documents.some(d => d.project.id === projectId)) throw new Error("Project no longer exists");
      await saveProjectDocuments(documents.map(d => d.project.id === projectId ? {
        ...d, project: updateProjectSummary(saveAssemblyToProject(d.project, snapshot.transforms, snapshot.lockedRoomId)),
      } : d));
    });
    saveQueue.current = task;
    try { await task; if (revision === saveRevision.current) setSaveStatus("Layout saved"); }
    catch (error) { if (revision === saveRevision.current) setSaveStatus("Save failed · tap Save layout to retry"); throw error; }
  }

  useEffect(() => {
    if (mode === "room" || !loaded) return;
    ++saveRevision.current;
    setSaveStatus("Unsaved changes");
    const timer = setTimeout(() => { void saveLayout().catch(() => undefined); }, 500);
    return () => clearTimeout(timer);
  }, [draftTransforms, lockedRoomId, loaded, mode]);

  async function closeViewer() {
    try { await saveLayout(); onClose(); }
    catch { Alert.alert("Layout not saved", "Please retry Save layout before closing. Your scans are safe."); }
  }

  function resetAssembly() {
    if (!project) return;
    Alert.alert("Reset assembly?", "Return rooms to separate starting positions and unlock the reference. Room scans and measurements are kept.", [
      { text: "Cancel", style: "cancel" },
      { text: "Reset assembly", onPress: () => { setDraftTransforms(initialAssemblyTransforms(project, true)); setLockedRoomId(undefined); setMoveMode(false); setResetRequestId(v => v + 1); } },
    ]);
  }
  const selectedFeatureIdsForNative = [featureAId, featureBId].filter(Boolean);

  function handleSelection(event: { nativeEvent: SceneSelectionEvent }) {
    const selection = event.nativeEvent;
    if (selection.roomId) {
      if (selection.roomId !== selectedRoomId) setMoveMode(false);
      setSelectedRoomId(selection.roomId);
    }
    if (mode !== "alignment") setSelectedFeatureIds(selection.featureId ? [selection.featureId] : []);
    if (mode !== "alignment" || !selection.featureId || !selection.roomId) return;
    if (selection.roomId === roomAId) setFeatureAId(selection.featureId);
    if (selection.roomId === roomBId) setFeatureBId(selection.featureId);
  }

  function updateDraftTransform(roomIdValue: string, transform: Transform3D) {
    setDraftTransforms((current) => updateAssemblyTransform(current, roomIdValue, transform, lockedRoomId));
  }

  function adjust(axis: "x" | "y" | "z" | "yaw", amount: number) {
    const id = mode === "project" ? selectedRoomId : roomBId;
    if (!id || id === lockedRoomId) return;
    const room = project?.roomCaptures.find(r => r.id === id);
    if (!room) return;
    setDraftTransforms(current => {
      const transform = current[id] ?? identityTransform();
      const next = axis === "yaw" ? rotateAssemblyRoom(transform, amount, roomAssemblyBounds(room).center) : moveAssemblyRoom(transform, axis, amount);
      return updateAssemblyTransform(current, id, next, lockedRoomId);
    });
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
    if (roomA.id === roomB.id || roomB.id === lockedRoomId) return;
    const aligned = alignRoomFeatures(transformA, featureA.roomLocalTransform ?? capturedTransform(featureA.transform), featureB.roomLocalTransform ?? capturedTransform(featureB.transform));
    if (aligned) updateDraftTransform(roomB.id, aligned);
    else Alert.alert("Alignment unavailable", "The selected feature transform cannot be inverted.");
  }

  async function saveAlignment() {
    if (!project || !roomAId || !roomBId || roomAId === roomBId || roomBId === lockedRoomId) return;
    const parent = draftTransforms[roomAId] ?? roomTransform(project, roomAId);
    const child = draftTransforms[roomBId] ?? roomTransform(project, roomBId);
    const relative = relativeTransform(parent, child);
    if (!relative) { Alert.alert("Alignment unavailable", "The reference room transform cannot be inverted."); return; }
    const parentFeature = roomA?.roomScan?.elements.find(element => element.id === featureAId);
    try {
      const snapshot = latestLayout.current;
      const task = saveQueue.current.catch(() => undefined).then(async () => {
      const documents = await loadProjectDocuments();
      await saveProjectDocuments(documents.map(document => {
        if (document.project.id !== projectId) return document;
        const latest = saveAssemblyToProject(document.project, snapshot.transforms, snapshot.lockedRoomId);
        return { ...document, project: updateProjectSummary({ ...latest, spatialModel: { ...latest.spatialModel!,
          connections: [...(latest.spatialModel?.connections ?? []).filter(connection => connection.childRoomId !== roomBId),
            { id: `connection-${Date.now()}`, parentRoomId: roomAId, childRoomId: roomBId, connectionType: connectionTypeFor(parentFeature), parentFeatureId: featureAId || undefined, childFeatureId: featureBId || undefined, transform: relative, alignmentMethod: "user-assisted", elevationChangeMeters: relative.position.y, createdAt: new Date().toISOString() }],
        } }) };
      }));
      });
      saveQueue.current = task;
      await task;
      Alert.alert("Alignment saved", "Room transforms and child relationships are saved.");
    } catch { Alert.alert("Alignment not saved", "Please retry saving the alignment."); }
  }

  const selectedRoom = project?.roomCaptures.find((room) => room.id === selectedRoomId);
  const selectedPlacements = project?.placedObjects.filter(object => object.status === "active" && object.roomCaptureId === selectedRoomId) ?? [];
  const selectedRoomName = selectedRoom ? selectedRoom.name || `Room ${(project?.roomCaptures.filter(r => r.roomScan).indexOf(selectedRoom) ?? 0) + 1}` : "Select a room";
  if (!project || !loaded) return <SafeAreaView style={styles.center}><Text style={styles.text}>{loadError ?? "Loading saved model…"}</Text><Button label="Close" onPress={onClose} /></SafeAreaView>;

  return <SafeAreaView style={styles.screen}>
    <View style={styles.header}><View><Text style={styles.eyebrow}>{mode === "project" ? "ROOM ASSEMBLY" : "SAVED ROOM"}</Text><Text style={styles.title}>{title}</Text></View><Pressable onPress={() => void closeViewer()} style={styles.close}><Text style={styles.closeText}>Close</Text></Pressable></View>
    {!savedRoom3DViewAvailable && <Text style={styles.warning}>The interactive 3D viewer requires the iOS development build. The saved scan data remains intact.</Text>}
    <NativeSavedRoom3DView style={styles.viewer} modelJSON={modelJSON} roomTransformsJSON={transformsJSON} lockedRoomId={lockedRoomId} assemblyMode={mode === "project"} selectedRoomId={selectedRoomId} selectedFeatureIdsJSON={JSON.stringify(mode === "alignment" ? selectedFeatureIdsForNative : selectedFeatureIds)} editingRoomId={mode === "alignment" ? roomBId : mode === "project" ? selectedRoomId : undefined} allowDirectManipulation={(mode === "alignment" && moveMode) || (mode === "project" && moveMode && !!lockedRoomId && selectedRoomId !== lockedRoomId)} showMeasurements={showMeasurements} resetRequestId={resetRequestId} focusRequestId={focusRequestId} onSceneSelection={handleSelection} onRoomTransformChange={(event) => updateDraftTransform(event.nativeEvent.roomId, event.nativeEvent.transform)} />
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.toolbar}><Text style={styles.helper}>{mode === "project" ? (moveMode ? "Drag to move the active room. Twist two fingers to rotate. Select rooms by name when they overlap." : "Orbit and pinch to inspect. Tap the frontmost room or choose its name below. Tap a surface to focus its measurements.") : "Orbit, pan, and pinch to inspect. Tap a room or feature to select it."}</Text><View style={styles.buttonRow}><Button label="Focus room" disabled={!selectedRoomId} onPress={() => setFocusRequestId(value => value + 1)} /><Button label="Reset view" onPress={() => setResetRequestId((value) => value + 1)} /><Button label={showMeasurements ? "Hide measurements" : "Show measurements"} onPress={() => setShowMeasurements((value) => !value)} /></View></View>
      {mode === "alignment" && <>
        <View style={styles.panel}><Text style={styles.section}>1. Select rooms</Text><RoomChips rooms={project.roomCaptures.filter((room) => room.roomScan)} value={roomAId} onChange={setRoomAId} label="Room A" /><RoomChips rooms={project.roomCaptures.filter((room) => room.roomScan)} value={roomBId} onChange={setRoomBId} label="Room B" /></View>
        <View style={styles.panel}><Text style={styles.section}>2. Select architectural features</Text><FeatureChips label="Room A feature" features={featureList(roomA)} value={featureAId} onChange={setFeatureAId} /><FeatureChips label="Room B feature" features={featureList(roomB)} value={featureBId} onChange={setFeatureBId} /><Button label="Align selected features" onPress={alignSelectedFeatures} /><Text style={styles.helper}>Doors, openings, walls, corners, floors, landings, and stair geometry are eligible. Furniture is never used as an anchor.</Text></View>
        <View style={styles.panel}><Text style={styles.section}>3. Fine adjustment · Room B</Text><Button label={moveMode ? "Camera controls" : "Move Room B"} disabled={roomBId === lockedRoomId} onPress={() => setMoveMode(v => !v)} /><Text style={styles.helper}>Directly drag the highlighted Room B where supported, or use 1 cm / 1° increments.</Text><View style={styles.adjustGrid}>{[["X −", "x", -0.01], ["X +", "x", 0.01], ["Y −", "y", -0.01], ["Y +", "y", 0.01], ["Z −", "z", -0.01], ["Z +", "z", 0.01], ["Yaw −", "yaw", -Math.PI / 180], ["Yaw +", "yaw", Math.PI / 180]].map(([label, axis, amount]) => <Button key={String(label)} label={String(label)} onPress={() => adjust(axis as "x" | "y" | "z" | "yaw", Number(amount))} />)}</View><Button label="Save room-to-project alignment" onPress={() => void saveAlignment()} /></View>
      </>}
      {mode === "project" && <View style={styles.panel}>
        <RoomChips rooms={project.roomCaptures.filter(r => r.roomScan)} value={selectedRoomId ?? ""} onChange={id => { setSelectedRoomId(id); setSelectedFeatureIds([]); setMoveMode(false); }} label="Active room" lockedRoomId={lockedRoomId} />
        <Text style={styles.section}>{selectedRoomName}{selectedRoomId === lockedRoomId ? " · Locked reference" : ""}</Text>
        <View style={styles.buttonRow}>
          <Button label={selectedRoomId === lockedRoomId ? "Unlock room" : "Lock room in place"} disabled={!selectedRoomId || (!!lockedRoomId && selectedRoomId !== lockedRoomId)} onPress={() => { setLockedRoomId(selectedRoomId === lockedRoomId ? undefined : selectedRoomId); setMoveMode(false); }} />
          <Button label={moveMode ? "Camera controls" : "Move / rotate"} disabled={!lockedRoomId || !selectedRoomId || selectedRoomId === lockedRoomId} onPress={() => setMoveMode(v => !v)} />
          <Button label={toolsExpanded ? "Hide precision tools" : "Precision tools"} onPress={() => setToolsExpanded(v => !v)} />
        </View>
        {!lockedRoomId && <Text style={styles.helper}>Lock a reference room to begin assembling the others.</Text>}
        {lockedRoomId && selectedRoomId !== lockedRoomId && <Text style={styles.helper}>Reference: {project.roomCaptures.find(r => r.id === lockedRoomId)?.name || lockedRoomId}. Unlock it before choosing a different reference.</Text>}
        {toolsExpanded && <>
          <Text style={styles.helper}>Assembly axes · X left/right · Z forward/back · Y elevation</Text>
          <View style={styles.buttonRow}>{[0.01, 0.1, 1].map(value => <Button key={value} label={`${step === value ? "✓ " : ""}${value} m`} onPress={() => setStep(value)} />)}</View>
          <View style={styles.adjustGrid}>{(["x", "z", "y"] as const).flatMap(axis => [-1, 1].map(sign => <Button key={`${axis}${sign}`} label={`${axis.toUpperCase()} ${sign > 0 ? "+" : "−"}`} disabled={!lockedRoomId || selectedRoomId === lockedRoomId} onPress={() => adjust(axis, sign * step)} />))}</View>
          <View style={styles.adjustGrid}>{[-90, -5, -1, 1, 5, 90].map(degrees => <Button key={degrees} label={`${degrees > 0 ? "+" : ""}${degrees}°`} disabled={!lockedRoomId || selectedRoomId === lockedRoomId} onPress={() => adjust("yaw", degrees * Math.PI / 180)} />)}</View>
        </>}
        <View style={styles.buttonRow}><Button label="Save layout" onPress={() => { void saveLayout().catch(() => Alert.alert("Save failed", "Please try again. Your scans are safe.")); }} /><Button label="Reset assembly" onPress={resetAssembly} /></View>
        <Text style={styles.helper}>{saveStatus} · Auto-saves placement changes</Text>
      </View>}
      {mode === "room" && <View style={styles.panel}><Text style={styles.section}>{selectedRoom?.name ?? "Room"}</Text><Text style={styles.helper}>This model is reconstructed from the saved RoomPlan-derived geometry and native CapturedRoom archive. No new scan is started.</Text>{selectedRoom?.roomScan?.arkitMesh && <Text style={styles.helper}>Bounded ARKit mesh retained: {selectedRoom.roomScan.arkitMesh.anchors.length} architectural mesh anchors.</Text>}</View>}
      {selectedPlacements.some(object => !object.roomLocalTransform) && <Text style={styles.warning}>Some legacy placements need room alignment. Their original coordinates are preserved; they are not overlaid at an invented room position.</Text>}
      {showMeasurements && selectedPlacements.length > 0 && <View style={styles.panel}><Text style={styles.section}>Placed objects</Text>{selectedPlacements.map(object => <View key={object.id} style={styles.field}>
        <Button label={object.displayName} disabled={!object.roomLocalTransform} onPress={() => setSelectedFeatureIds([`placed:${object.id}`])} />
        {object.objectMeasurements && <Text style={styles.helper}>{formatObjectMeasurementDetails(object.objectMeasurements)}</Text>}
        {!object.roomLocalTransform && <Text style={styles.helper}>Room alignment required</Text>}
      </View>)}</View>}
      {showMeasurements && mode !== "alignment" && <ObjectMeasurementsPanel room={selectedRoom} selectedInstanceId={selectedFeatureIds[0]} onSelectInstance={id => setSelectedFeatureIds([id])} />}
    </ScrollView>
  </SafeAreaView>;
}

function RoomChips({ rooms, value, onChange, label, lockedRoomId }: { rooms: RoomCapture[]; value: string; onChange: (value: string) => void; label: string; lockedRoomId?: string }) {
  return <View style={styles.field}><Text style={styles.label}>{label}</Text><View style={styles.chips}>{rooms.map((room, index) => <Pressable key={room.id} onPress={() => onChange(room.id)} style={[styles.chip, value === room.id && styles.chipSelected]}><Text style={styles.chipText}>{room.name || `Room ${index + 1}`}{room.id === lockedRoomId ? " · Locked" : ""}</Text></Pressable>)}</View></View>;
}

function FeatureChips({ features, value, onChange, label }: { features: RoomScanElement[]; value: string; onChange: (value: string) => void; label: string }) {
  return <View style={styles.field}><Text style={styles.label}>{label}</Text><View style={styles.chips}>{features.length === 0 && <Text style={styles.helper}>No saved architectural features.</Text>}{features.map((feature) => <Pressable key={feature.id} onPress={() => onChange(feature.id)} style={[styles.chip, value === feature.id && styles.chipSelected]}><Text style={styles.chipText}>{feature.category} · {feature.id.slice(0, 8)}</Text></Pressable>)}</View></View>;
}

function Button({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) { return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[styles.button, disabled && { opacity: 0.4 }]}><Text style={styles.buttonText}>{label}</Text></Pressable>; }

const styles = StyleSheet.create({ screen: { flex: 1, backgroundColor: colors.background }, center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }, header: { padding: 18, flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: colors.surface, borderBottomWidth: 1, borderColor: colors.border }, eyebrow: { color: colors.accent, fontSize: 11, fontWeight: "800", letterSpacing: 1 }, title: { color: colors.text, fontSize: 24, fontWeight: "800", marginTop: 5 }, close: { borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 9 }, closeText: { color: colors.text, fontWeight: "700" }, viewer: { height: 390, margin: 12, backgroundColor: "#111827", borderWidth: 1, borderColor: colors.border }, content: { padding: 12, gap: 12, paddingBottom: 32 }, toolbar: { gap: 10 }, buttonRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, button: { alignSelf: "flex-start", backgroundColor: colors.accent, paddingHorizontal: 12, paddingVertical: 9 }, buttonText: { color: colors.surface, fontWeight: "800", fontSize: 12 }, panel: { gap: 10, padding: 13, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }, section: { color: colors.text, fontSize: 15, fontWeight: "800" }, field: { gap: 6 }, label: { color: colors.text, fontSize: 12, fontWeight: "700" }, chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 }, chip: { borderWidth: 1, borderColor: colors.border, paddingHorizontal: 8, paddingVertical: 7, backgroundColor: colors.surface }, chipSelected: { borderColor: colors.accent, backgroundColor: colors.lightBlue }, chipText: { color: colors.text, fontSize: 11, fontWeight: "700" }, helper: { color: colors.muted, fontSize: 12, lineHeight: 18 }, text: { color: colors.text }, warning: { marginHorizontal: 12, marginTop: 10, color: "#9a6514", fontSize: 12 }, adjustGrid: { flexDirection: "row", flexWrap: "wrap", gap: 7 }, roomLine: { flexDirection: "row", alignItems: "center", gap: 8, borderTopWidth: 1, borderColor: colors.border, paddingVertical: 8 }, selectedLine: { borderColor: colors.accent }, roomSelect: { flex: 1 }, roomName: { color: colors.text, fontWeight: "800", marginBottom: 3 } });
