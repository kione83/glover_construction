import { useEffect, useMemo, useState } from "react";
import * as FileSystem from "expo-file-system/legacy";
import {
  Alert,
  Pressable,
  Share,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { addRoomToSpatialModel, buildScanMeasurementCsv, createScanMeasurementLogEntries, updateProjectSummary, type Project, type RoomCapture, type RoomScanData } from "../../domain";
import { loadProjectDocuments, saveProjectDocuments } from "../../storage/projectRepository";
import { colors } from "../../theme/colors";
import { LiveStreamPanel } from "../camera/LiveStreamPanel";
import {
  NativeRoomScanView,
  roomScanAvailable,
  type NativeRoomScanMeasurement,
  type NativeRoomScanUpdate,
} from "./NativeRoomScanView";

interface RoomScanScreenProps {
  projectId: string;
  onClose: () => void;
}

function makeRoomId() {
  return `room-scan-${Date.now()}`;
}

function measurementOrder(category: string): NativeRoomScanMeasurement["dimension"][] {
  if (category === "wall") return ["width", "height"];
  if (category === "floor") return ["depth", "width"];
  return ["width", "height", "depth"];
}

function measurementFeatureName(category: string, index: number): string {
  if (category === "wall") return `Wall ${index + 1}`;
  if (category === "floor") return "Floor";
  return `${category.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())} ${index + 1}`;
}

function toRoomCapture(project: Project, name: string, scan: RoomScanData): RoomCapture {
  const roomId = makeRoomId();
  const surfaces = scan.elements
    .filter((element) => ["wall", "floor", "ceiling", "opening"].includes(element.kind))
    .map((element) => ({
      id: `${roomId}-${element.id}`,
      kind: element.kind === "opening" ? "opening" : element.kind,
      label: `${name} ${element.category}`,
      dimensions: element.dimensions,
      centerPoint: element.transform.position,
      confidence: element.confidence,
    }))
    .filter((surface) => ["wall", "floor", "ceiling", "opening"].includes(surface.kind));

  const footprint = scan.floorFootprint;
  return {
    id: roomId,
    name: name.trim() || `Room ${project.roomCaptures.length + 1}`,
    status: "completed",
    source: "roomplan",
    unit: "m",
    measuredDimensions: footprint
      ? { width: footprint.width, height: scan.ceilingHeight ?? 0, depth: footprint.depth, unit: "m" }
      : undefined,
    bounds: footprint
      ? { center: { x: 0, y: (scan.ceilingHeight ?? 0) / 2, z: 0 }, size: footprint }
      : undefined,
    surfaces: surfaces as RoomCapture["surfaces"],
    notes: "RoomPlan scan. Individual transformed elements preserve irregular room geometry.",
    capturedAt: scan.capturedAt,
    roomScan: scan,
  };
}

export function RoomScanScreen({ projectId, onClose }: RoomScanScreenProps) {
  const [project, setProject] = useState<Project>();
  const [roomName, setRoomName] = useState("Room Scan");
  const [status, setStatus] = useState("Preparing Room Scan…");
  const [progress, setProgress] = useState(0);
  const [startRequestId] = useState(1);
  const [finishRequestId, setFinishRequestId] = useState(0);
  const [isFinished, setIsFinished] = useState(false);
  const [scan, setScan] = useState<RoomScanData>();
  const [savedRoomId, setSavedRoomId] = useState<string>();
  const [showMeasurements, setShowMeasurements] = useState(false);
  const [showMeasurementList, setShowMeasurementList] = useState(false);
  const [liveMeasurements, setLiveMeasurements] = useState<NativeRoomScanMeasurement[]>([]);

  useEffect(() => {
    void loadProjectDocuments().then((documents) => {
      const selected = documents.find((document) => document.project.id === projectId)?.project;
      setProject(selected);
      if (selected) setRoomName(`Room ${selected.roomCaptures.length + 1}`);
      setStatus(selected ? "Move slowly around the room to capture walls and major contents." : "Project could not be loaded.");
    });
  }, [projectId]);

  const layoutItems = useMemo(
    () => (scan?.elements ?? [])
      .filter((element) => element.kind === "furniture" || element.kind === "built-in" || element.kind === "fixture")
      .map((element) => ({
        id: element.id,
        displayName: element.category,
        dimensions: element.dimensions,
        position: element.transform.position,
        rotationY: element.transform.rotation.yaw,
        representation: element.representation,
      })),
    [scan],
  );

  const measurementGroups = useMemo(() => {
    const grouped = new Map<string, NativeRoomScanMeasurement[]>();
    liveMeasurements.forEach((measurement) => {
      const current = grouped.get(measurement.elementId) ?? [];
      current.push(measurement);
      grouped.set(measurement.elementId, current);
    });
    const categoryCounts = new Map<string, number>();
    return Array.from(grouped.values()).map((values) => {
      const category = values[0]?.category ?? "feature";
      const index = categoryCounts.get(category) ?? 0;
      categoryCounts.set(category, index + 1);
      const byDimension = new Map(values.map((measurement) => [measurement.dimension, measurement]));
      const quality = values.some((measurement) => measurement.quality === "limited")
        ? "limited"
        : values.some((measurement) => measurement.quality === "estimating")
          ? "estimating"
          : "stable";
      return { category, label: values[0]?.wallId ?? measurementFeatureName(category, index), quality, byDimension };
    });
  }, [liveMeasurements]);

  async function persistScan(completedScan: RoomScanData) {
    if (!project) return;
    const documents = await loadProjectDocuments();
    const room = toRoomCapture(project, roomName, completedScan);
    const updatedProject = updateProjectSummary({
      ...addRoomToSpatialModel(project, room.id),
      status: "scanned",
      roomCaptures: [...project.roomCaptures, room],
    });
    const updatedDocuments = documents.map((document) =>
      document.project.id === project.id
        ? {
            ...document,
            project: updatedProject,
            scanMeasurementLogEntries: [
              ...(document.scanMeasurementLogEntries ?? []),
              ...createScanMeasurementLogEntries(project.id, room.id, completedScan),
            ],
          }
        : document,
    );
    await saveProjectDocuments(updatedDocuments);
    setProject(updatedProject);
    setSavedRoomId(room.id);
    setStatus("Room Scan saved to this project. The room can be reconstructed without scanning again.");
    setIsFinished(true);
  }

  function handleNativeUpdate(event: { nativeEvent: NativeRoomScanUpdate }) {
    const update = event.nativeEvent;
    setStatus(update.message);
    if (typeof update.progress === "number") setProgress(update.progress);
    if (update.measurements) setLiveMeasurements(update.measurements);
    if (update.kind === "scan-failed" || update.kind === "session-unsupported") {
      setIsFinished(true);
      return;
    }
    if (update.kind === "scan-completed" && update.scan) {
      const completedScan: RoomScanData = {
        version: 1,
        source: "roomplan",
        capturedAt: update.scan.capturedAt,
        nativeIdentifier: update.scan.nativeIdentifier,
        floorFootprint: update.scan.floorFootprint,
        ceilingHeight: update.scan.ceilingHeight,
        elements: update.scan.elements.map((element) => ({
          ...element,
          representation: element.representation as RoomScanData["elements"][number]["representation"],
        })),
        measurements: update.scan.measurements ?? update.measurements ?? [],
        nativeCapturedRoomJSON: update.scan.nativeCapturedRoomJSON,
        arkitMesh: update.scan.arkitMesh,
        portal: { format: "construction-ar-room-scan", version: 1 },
      };
      setScan(completedScan);
      void persistScan(completedScan);
    }
  }

  async function exportScanMeasurements() {
    if (!scan) return;
    const projectIdValue = project?.id ?? projectId;
    const roomId = savedRoomId ?? "room-scan";
    const entries = createScanMeasurementLogEntries(projectIdValue, roomId, scan);
    const csv = buildScanMeasurementCsv(entries);
    if (!csv) {
      Alert.alert("No scan measurements", "No estimated measurements were returned by the scan.");
      return;
    }
    const directory = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
    if (!directory) return;
    const uri = `${directory}room-scan-estimates-${Date.now()}.csv`;
    await FileSystem.writeAsStringAsync(uri, csv, { encoding: FileSystem.EncodingType.UTF8 });
    await Share.share({ url: uri, title: "Room Scan estimates", message: "Estimated Room Scan measurements" });
  }

  if (!roomScanAvailable) {
    return (
      <SafeAreaView style={styles.centered}>
        <Text style={styles.title}>Room Scan unavailable</Text>
        <Text style={styles.message}>This build is running without the native RoomPlan module. Use a LiDAR-capable iPhone build to capture a measurable room.</Text>
        <Pressable style={styles.button} onPress={onClose}><Text style={styles.buttonText}>Back to project</Text></Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>PROJECT WORKSPACE</Text>
          <Text style={styles.title}>Room Scan</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Close Room Scan" onPress={onClose} style={styles.closeButton}>
          <Text style={styles.closeButtonText}>Close</Text>
        </Pressable>
      </View>
      <View style={styles.viewport}>
        <NativeRoomScanView
          finishRequestId={finishRequestId}
          onRoomScanUpdate={handleNativeUpdate}
          startRequestId={startRequestId}
          showMeasurements={showMeasurements}
          style={StyleSheet.absoluteFill}
        />
          <View pointerEvents="none" style={styles.statusOverlay}>
          <Text style={styles.statusText}>{status}</Text>
          <View style={styles.progressTrack}><View style={[styles.progressBar, { width: `${Math.round(progress * 100)}%` }]} /></View>
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {!isFinished && (
          <View style={styles.controls}>
            <Text style={styles.label}>Saved room name</Text>
            <TextInput value={roomName} onChangeText={setRoomName} style={styles.input} />
            <Pressable accessibilityRole="switch" accessibilityState={{ checked: showMeasurements }} onPress={() => setShowMeasurements((value) => !value)} style={styles.toggleButton}>
              <Text style={styles.toggleText}>{showMeasurements ? "Hide Measurements" : "Show Measurements"}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: showMeasurementList }} onPress={() => setShowMeasurementList((value) => !value)} style={styles.measurementListButton}>
              <Text style={styles.measurementListButtonText}>{showMeasurementList ? "Hide measurement list" : `Measurements${measurementGroups.length ? ` (${measurementGroups.length})` : ""}`}</Text>
            </Pressable>
            {showMeasurementList && <View style={styles.measurementPanel}>
              <Text style={styles.measurementPanelTitle}>Detected measurements</Text>
              {measurementGroups.length === 0 ? <Text style={styles.measurementPanelEmpty}>Waiting for RoomPlan geometry…</Text> : <ScrollView style={styles.measurementList} nestedScrollEnabled>
                {measurementGroups.map((group) => <View key={`${group.category}-${group.label}`} style={styles.measurementRow}>
                  <View style={styles.measurementRowCopy}><Text style={styles.measurementFeature}>{group.label}</Text><Text style={styles.measurementValues}>{measurementOrder(group.category).map((dimension) => group.byDimension.get(dimension)).filter(Boolean).map((measurement) => `${measurement!.value.toFixed(2)} m`).join(" × ") || "Incomplete"}</Text></View>
                  <Text style={[styles.measurementQuality, group.quality === "stable" ? styles.qualityStable : styles.qualityLimited]}>{group.quality === "stable" ? "Stable" : group.quality === "estimating" ? "Estimating" : "Limited"}</Text>
                </View>)}
              </ScrollView>}
            </View>}
            <Pressable accessibilityRole="button" onPress={() => setFinishRequestId((value) => value + 1)} style={styles.finishButton}>
              <Text style={styles.finishButtonText}>Finish and save scan</Text>
            </Pressable>
            <View style={styles.streamSection}>
              <Text style={styles.streamTitle}>Customer stream</Text>
              <LiveStreamPanel
                compact
                layoutItems={layoutItems}
                liveMeasurements={liveMeasurements}
                projectRooms={project?.roomCaptures.map((room) => ({ id: room.id, name: room.name, roomScan: room.roomScan }))}
                spatialModel={project?.spatialModel}
              />
            </View>
          </View>
        )}
        {scan && (
          <View style={styles.summary}>
            <Text style={styles.summaryTitle}>Saved room model</Text>
            <Text style={styles.summaryText}>{scan.elements.filter((element) => element.kind === "wall").length} walls · {layoutItems.length} contents · {scan.ceilingHeight ? `${scan.ceilingHeight.toFixed(2)} m ceiling` : "ceiling height unavailable"}</Text>
            <Pressable style={styles.button} onPress={() => void exportScanMeasurements()}><Text style={styles.buttonText}>Export scan estimates</Text></Pressable>
            <LiveStreamPanel compact layoutItems={layoutItems} projectRooms={project?.roomCaptures.map((room) => ({ id: room.id, name: room.name, roomScan: room.roomScan }))} roomScan={scan} spatialModel={project?.spatialModel} />
          </View>
        )}
        {isFinished && <Pressable style={styles.button} onPress={onClose}><Text style={styles.buttonText}>Back to project</Text></Pressable>}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.navy },
  centered: { flex: 1, justifyContent: "center", alignItems: "center", gap: 16, padding: 28, backgroundColor: colors.background },
  header: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerCopy: { gap: 3 },
  eyebrow: { color: colors.lightBlue, fontSize: 11, letterSpacing: 1.6, fontWeight: "700" },
  title: { color: colors.surface, fontSize: 28, fontWeight: "800" },
  closeButton: { borderWidth: 1, borderColor: colors.lightBlue, paddingHorizontal: 12, paddingVertical: 8 },
  closeButtonText: { color: colors.surface, fontWeight: "700" },
  viewport: { flex: 1, minHeight: 300, backgroundColor: colors.navy, overflow: "hidden" },
  statusOverlay: { position: "absolute", left: 16, right: 16, bottom: 16, padding: 12, backgroundColor: "rgba(11,35,65,.9)" },
  statusText: { color: colors.surface, fontSize: 14, fontWeight: "700" },
  progressTrack: { height: 4, marginTop: 8, backgroundColor: colors.border },
  progressBar: { height: 4, backgroundColor: colors.accent },
  content: { padding: 16, gap: 12, backgroundColor: colors.background },
  controls: { gap: 8 },
  label: { color: colors.text, fontSize: 13, fontWeight: "700" },
  input: { borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: colors.surface, color: colors.text },
  finishButton: { backgroundColor: colors.accent, padding: 14, alignItems: "center" },
  finishButtonText: { color: colors.surface, fontWeight: "800" },
  toggleButton: { borderWidth: 1, borderColor: colors.accent, padding: 11, alignItems: "center" },
  toggleText: { color: colors.accent, fontWeight: "800" },
  measurementListButton: { borderWidth: 1, borderColor: colors.border, padding: 11, alignItems: "center", backgroundColor: colors.surface },
  measurementListButtonText: { color: colors.text, fontWeight: "800" },
  measurementPanel: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: 10, gap: 7 },
  measurementPanelTitle: { color: colors.text, fontSize: 13, fontWeight: "800" },
  measurementPanelEmpty: { color: colors.muted, fontSize: 12 },
  measurementList: { maxHeight: 180 },
  measurementRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderTopWidth: 1, borderColor: colors.border, paddingVertical: 8, gap: 8 },
  measurementRowCopy: { flex: 1 },
  measurementFeature: { color: colors.text, fontWeight: "800", fontSize: 12 },
  measurementValues: { color: colors.muted, fontSize: 12, marginTop: 2 },
  measurementQuality: { fontSize: 10, fontWeight: "800", textTransform: "uppercase" },
  qualityStable: { color: "#2d7a52" },
  qualityLimited: { color: "#a9681a" },
  streamSection: { gap: 6, marginTop: 4 },
  streamTitle: { color: colors.text, fontSize: 13, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1 },
  summary: { gap: 8 },
  summaryTitle: { color: colors.text, fontSize: 18, fontWeight: "800" },
  summaryText: { color: colors.muted, fontSize: 14 },
  button: { backgroundColor: colors.accent, paddingHorizontal: 16, paddingVertical: 12 },
  buttonText: { color: colors.surface, fontWeight: "800" },
  message: { color: colors.muted, textAlign: "center", lineHeight: 23 },
});
