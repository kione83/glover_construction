import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  clearAllMeasurementLogEntries,
  clearRoomMeasurementLogEntries,
  createMeasurement,
  createMeasurementObservation,
  createMultiCaptureMeasurementLogEntry,
  createSingleMeasurementLogEntry,
  deleteMeasurementLogEntry,
  formatDecimalInches,
  type Measurement,
  type MeasurementLogEntry,
  type MeasurementMode,
  type MeasurementTrackingSnapshot,
  type Project,
  type ResolvedMeasurementEndpoint,
} from "../../domain";
import type { ProjectDocument } from "../../storage/projectDocument";
import {
  loadProjectDocuments,
  replaceProjectDocument,
  saveProjectDocuments,
} from "../../storage/projectRepository";
import {
  NativeMeasurementARView,
  measurementARViewAvailable,
  type NativeMeasurementAction,
  type NativeMeasurementResolution,
  type NativeMeasurementReticleSnapshot,
  type NativeMeasurementSnapshot,
  type NativeMeasurementTrackingSnapshot,
  type NativeMeasurementUpdatePayload,
} from "./NativeMeasurementARView";

interface MeasurementScreenProps {
  onClose: () => void;
}

type ScreenView = "measure" | "log" | "detail";

const DEFAULT_TRACKING: MeasurementTrackingSnapshot = {
  quality: "not-available",
  localizedState: "not-available",
};

const DEFAULT_RETICLE: NativeMeasurementReticleSnapshot = {
  state: "red",
  message: "Aim at a tracked real-world surface to capture a point.",
  tracking: {
    quality: "not-available",
    localizedState: "not-available",
  },
};

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function mapTrackingSnapshot(
  tracking: NativeMeasurementTrackingSnapshot | undefined,
): MeasurementTrackingSnapshot {
  if (!tracking) {
    return DEFAULT_TRACKING;
  }

  return {
    quality: tracking.quality,
    reason: tracking.reason,
    localizedState: tracking.localizedState,
  };
}

function normalizeReticleSnapshot(
  reticle: NativeMeasurementReticleSnapshot | undefined,
  fallback: NativeMeasurementReticleSnapshot = DEFAULT_RETICLE,
): NativeMeasurementReticleSnapshot {
  if (!reticle || typeof reticle.state !== "string" || typeof reticle.message !== "string") {
    return fallback;
  }

  return {
    state: reticle.state,
    message: reticle.message,
    tracking: reticle.tracking ?? fallback.tracking,
    point: reticle.point,
    source: reticle.source,
    planeAlignment: reticle.planeAlignment,
    usedFallback: reticle.usedFallback,
  };
}

function mapResolvedEndpoint(
  point: { x: number; y: number; z: number },
  resolution: NativeMeasurementResolution,
): ResolvedMeasurementEndpoint {
  return {
    point,
    source: resolution.source,
    planeAlignment: resolution.planeAlignment,
    usedFallback: resolution.usedFallback,
    tracking: mapTrackingSnapshot(resolution.tracking),
    capturedAt: resolution.capturedAt,
    resolutionDiagnostics: resolution.resolutionDiagnostics,
  };
}

function measurementStatusCopy(
  action: NativeMeasurementAction,
  currentMeasurement: Measurement | null,
  multiPassCount: number,
  measurementMode: MeasurementMode,
): string {
  if (action.kind === "capture-failed" || action.kind === "session-unsupported") {
    return action.message;
  }

  if (action.kind === "point-set" && action.pointRole === "start") {
    return "Point A captured. Aim at Point B and capture again.";
  }

  if (action.kind === "point-set" && action.pointRole === "end") {
    return measurementMode === "multi-capture"
      ? `Pass ${multiPassCount + 1} captured. Add another pass or finish Multi-Capture.`
      : "Measurement captured. Review confidence before using it for layout decisions.";
  }

  if (currentMeasurement) {
    return "Measurement captured. Review confidence before using it for layout decisions.";
  }

  if (measurementMode === "multi-capture" && multiPassCount > 0) {
    return `Multi-Capture in progress. ${multiPassCount} pass${multiPassCount === 1 ? "" : "es"} recorded.`;
  }

  return action.message;
}

function createMeasurementFromNativeSnapshot(
  snapshot: NativeMeasurementSnapshot,
  mode: MeasurementMode,
): Measurement | null {
  if (
    !snapshot.startPoint ||
    !snapshot.endPoint ||
    !snapshot.rawDistanceMeters ||
    !snapshot.startResolution ||
    !snapshot.endResolution
  ) {
    return null;
  }

  const createdAt = snapshot.endResolution.capturedAt ?? new Date().toISOString();
  const deviceMetadata = {
    platform: Platform.OS,
    platformVersion: String(Platform.Version),
    sensorSummary: "ARKit reticle raycast",
  };

  const observation = createMeasurementObservation({
    id: makeId("measurement-observation"),
    ...(mode === "multi-capture" ? { kind: "repeat-pass" as const } : {}),
    startPoint: mapResolvedEndpoint(snapshot.startPoint, snapshot.startResolution),
    endPoint: mapResolvedEndpoint(snapshot.endPoint, snapshot.endResolution),
    createdAt,
    deviceMetadata,
  });

  return createMeasurement({
    id: makeId("measurement"),
    mode,
    observations: [observation],
    createdAt,
    updatedAt: createdAt,
    deviceMetadata,
  });
}

function SelectionChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, selected && styles.chipSelected]}>
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

function MeasurementSummaryCard({
  title,
  measurement,
  extra,
}: {
  title: string;
  measurement: Measurement;
  extra?: ReactNode;
}) {
  return (
    <View style={styles.measurementCard}>
      <Text style={styles.sectionLabel}>{title}</Text>
      <Text style={styles.measurementValue}>{measurement.displayDistanceLabel}</Text>
      <Text style={styles.confidenceValue}>
        {measurement.confidence.level.toUpperCase()} CONFIDENCE
      </Text>
      <Text style={styles.cardCopy}>{measurement.estimatedUncertainty.note}</Text>
      {extra}
    </View>
  );
}

export function MeasurementScreen({ onClose }: MeasurementScreenProps) {
  const [projectDocuments, setProjectDocuments] = useState<ProjectDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedProjectId, setSelectedProjectId] = useState<string>();
  const [selectedRoomId, setSelectedRoomId] = useState<string>();
  const [screenView, setScreenView] = useState<ScreenView>("measure");
  const [selectedLogEntryId, setSelectedLogEntryId] = useState<string>();
  const [measurementMode, setMeasurementMode] = useState<MeasurementMode>("single");
  const [nativeSnapshot, setNativeSnapshot] = useState<NativeMeasurementSnapshot>();
  const [tracking, setTracking] = useState<MeasurementTrackingSnapshot>(DEFAULT_TRACKING);
  const [reticle, setReticle] = useState<NativeMeasurementReticleSnapshot>(DEFAULT_RETICLE);
  const [status, setStatus] = useState("Aim at a tracked real-world surface to capture Point A.");
  const [resetCounter, setResetCounter] = useState(0);
  const [captureRequestId, setCaptureRequestId] = useState(0);
  const [capturePointRole, setCapturePointRole] = useState<"start" | "end">("start");
  const [latestSingleMeasurement, setLatestSingleMeasurement] = useState<Measurement | null>(null);
  const [multiCapturePasses, setMultiCapturePasses] = useState<Measurement[]>([]);

  useEffect(() => {
    let isMounted = true;

    async function loadDocuments() {
      const documents = await loadProjectDocuments();

      if (!isMounted) {
        return;
      }

      setProjectDocuments(documents);
      setSelectedProjectId((current) => current ?? documents[0]?.project.id);
      setIsLoading(false);
    }

    void loadDocuments();

    return () => {
      isMounted = false;
    };
  }, []);

  const selectedProjectDocument = useMemo(
    () => projectDocuments.find((document) => document.project.id === selectedProjectId),
    [projectDocuments, selectedProjectId],
  );

  const selectedProject = selectedProjectDocument?.project;

  useEffect(() => {
    if (!selectedProject) {
      setSelectedRoomId(undefined);
      return;
    }

    setSelectedRoomId((current) => {
      if (current && selectedProject.roomCaptures.some((room) => room.id === current)) {
        return current;
      }

      return selectedProject.roomCaptures[0]?.id;
    });
  }, [selectedProject]);

  const selectedRoom = useMemo(
    () => selectedProject?.roomCaptures.find((room) => room.id === selectedRoomId),
    [selectedProject, selectedRoomId],
  );

  const activeRoomMeasurementLogEntries = useMemo(() => {
    if (!selectedProjectDocument || !selectedRoomId) {
      return [];
    }

    return selectedProjectDocument.measurementLogEntries.filter(
      (entry) => entry.roomCaptureId === selectedRoomId,
    );
  }, [selectedProjectDocument, selectedRoomId]);

  const selectedLogEntry = useMemo(
    () =>
      selectedProjectDocument?.measurementLogEntries.find((entry) => entry.id === selectedLogEntryId),
    [selectedLogEntryId, selectedProjectDocument],
  );

  const multiCapturePreview = useMemo(() => {
    if (!selectedRoomId || multiCapturePasses.length === 0) {
      return null;
    }

    const createdAt = multiCapturePasses[0].createdAt;
    const deviceMetadata = multiCapturePasses[0].deviceMetadata;

    return createMultiCaptureMeasurementLogEntry({
      id: "multi-capture-preview",
      roomCaptureId: selectedRoomId,
      passes: multiCapturePasses,
      createdAt,
      resolveMeasurement: (observations) =>
        createMeasurement({
          id: "multi-capture-preview-measurement",
          mode: "multi-capture",
          observations,
          createdAt,
          updatedAt: new Date().toISOString(),
          deviceMetadata,
        }),
    });
  }, [multiCapturePasses, selectedRoomId]);

  const canCapture =
    measurementARViewAvailable &&
    reticle.state !== "red" &&
    !!selectedProject &&
    !!selectedRoom &&
    !(measurementMode === "multi-capture" && !!nativeSnapshot?.endPoint);

  const nextCaptureRole: "start" | "end" = nativeSnapshot?.startPoint ? "end" : "start";

  async function persistProjectDocuments(nextDocuments: ProjectDocument[]) {
    setProjectDocuments(nextDocuments);
    await saveProjectDocuments(nextDocuments);
  }

  async function updateSelectedProjectDocument(
    updater: (document: ProjectDocument) => ProjectDocument,
  ) {
    if (!selectedProjectDocument) {
      return;
    }

    const updatedDocument = updater(selectedProjectDocument);
    const nextDocuments = replaceProjectDocument(projectDocuments, updatedDocument);
    await persistProjectDocuments(nextDocuments);
  }

  function clearLiveMeasurementState(message: string) {
    setNativeSnapshot(undefined);
    setLatestSingleMeasurement(null);
    setCapturePointRole("start");
    setResetCounter((current) => current + 1);
    setStatus(message);
  }

  function clearMultiCaptureSession(message: string) {
    setMultiCapturePasses([]);
    clearLiveMeasurementState(message);
  }

  function handleChangeMeasurementMode(nextMode: MeasurementMode) {
    if (nextMode === measurementMode) {
      return;
    }

    const hasUnsavedMultiSession =
      measurementMode === "multi-capture" && multiCapturePasses.length > 0;

    const applyModeChange = () => {
      setMeasurementMode(nextMode);
      setScreenView("measure");
      setSelectedLogEntryId(undefined);
      if (nextMode === "single") {
        clearMultiCaptureSession("Single Measure ready. Aim at Point A and capture.");
      } else {
        clearLiveMeasurementState("Multi-Capture ready. Aim at Point A for Pass 1.");
      }
    };

    if (!hasUnsavedMultiSession) {
      applyModeChange();
      return;
    }

    Alert.alert(
      "Discard current Multi-Capture session?",
      `This will discard ${multiCapturePasses.length} unsaved pass${
        multiCapturePasses.length === 1 ? "" : "es"
      }.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Discard", style: "destructive", onPress: applyModeChange },
      ],
    );
  }

  function handleRequestCapture() {
    if (!selectedProject || !selectedRoom) {
      Alert.alert("Room required", "Select a project room before capturing a measurement.");
      return;
    }

    setCapturePointRole(nextCaptureRole);
    setCaptureRequestId((current) => current + 1);
  }

  function handlePrepareNextMultiPass() {
    setNativeSnapshot(undefined);
    setCapturePointRole("start");
    setResetCounter((current) => current + 1);
    setStatus(
      `Pass ${multiCapturePasses.length + 1} ready. Aim at Point A and capture the next pass.`,
    );
  }

  async function handleFinishMultiCapture() {
    if (!selectedRoomId || multiCapturePasses.length === 0) {
      return;
    }

    const createdAt = new Date().toISOString();
    const deviceMetadata = multiCapturePasses[0].deviceMetadata;
    const entry = createMultiCaptureMeasurementLogEntry({
      id: makeId("measurement-log"),
      roomCaptureId: selectedRoomId,
      passes: multiCapturePasses,
      createdAt,
      resolveMeasurement: (observations) =>
        createMeasurement({
          id: makeId("measurement-group"),
          mode: "multi-capture",
          observations,
          createdAt,
          updatedAt: createdAt,
          deviceMetadata,
        }),
    });

    await updateSelectedProjectDocument((document) => ({
      ...document,
      measurementLogEntries: [entry, ...document.measurementLogEntries],
    }));

    setSelectedLogEntryId(entry.id);
    setScreenView("detail");
    clearMultiCaptureSession("Multi-Capture saved. Review the result in the measurement log.");
  }

  function persistSingleMeasurement(measurement: Measurement) {
    if (!selectedRoomId) {
      return;
    }

    const entry = createSingleMeasurementLogEntry({
      id: makeId("measurement-log"),
      roomCaptureId: selectedRoomId,
      measurement,
      createdAt: measurement.createdAt,
    });

    void updateSelectedProjectDocument((document) => ({
      ...document,
      measurementLogEntries: [entry, ...document.measurementLogEntries],
    }));
  }

  function handleMeasurementUpdate(payload: NativeMeasurementUpdatePayload) {
    setTracking(mapTrackingSnapshot(payload.tracking));
    setReticle((current) => normalizeReticleSnapshot(payload.reticle, current));
    setNativeSnapshot(payload.measurement);

    if (
      payload.lastAction.kind === "point-set" &&
      payload.lastAction.pointRole === "end" &&
      payload.measurement?.startPoint &&
      payload.measurement.endPoint
    ) {
      const measurement = createMeasurementFromNativeSnapshot(payload.measurement, measurementMode);

      if (measurement) {
        if (measurementMode === "single") {
          setLatestSingleMeasurement(measurement);
          persistSingleMeasurement(measurement);
        } else {
          setMultiCapturePasses((current) => [...current, measurement]);
        }
      }
    }

    if (payload.lastAction.kind === "point-set" && payload.lastAction.pointRole === "start") {
      setCapturePointRole("end");
    }

    if (payload.lastAction.kind === "measurement-cleared") {
      setNativeSnapshot(undefined);
      setCapturePointRole("start");
    }

    setStatus(
      measurementStatusCopy(
        payload.lastAction,
        latestSingleMeasurement,
        multiCapturePasses.length,
        measurementMode,
      ),
    );
  }

  function confirmDeleteEntry(entry: MeasurementLogEntry) {
    const title =
      entry.type === "multi-capture"
        ? `Delete this Multi-Capture group and all ${entry.passes.length} passes?`
        : "Delete this measurement?";

    const deleteLabel = entry.type === "multi-capture" ? "Delete Group" : "Delete";

    Alert.alert(title, "This action permanently removes the measurement log entry.", [
      { text: "Cancel", style: "cancel" },
      {
        text: deleteLabel,
        style: "destructive",
        onPress: () => {
          void updateSelectedProjectDocument((document) => ({
            ...document,
            measurementLogEntries: deleteMeasurementLogEntry(document.measurementLogEntries, entry.id),
          }));
          setScreenView("log");
          setSelectedLogEntryId(undefined);
        },
      },
    ]);
  }

  function confirmClearRoom(project: Project, roomId: string, roomName: string) {
    const count = selectedProjectDocument?.measurementLogEntries.filter(
      (entry) => entry.roomCaptureId === roomId,
    ).length;

    Alert.alert(
      `Clear all measurements from ${roomName}?`,
      `This will permanently delete ${count ?? 0} measurement${
        count === 1 ? "" : "s"
      } from this room.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear Room",
          style: "destructive",
          onPress: () => {
            void updateSelectedProjectDocument((document) => ({
              ...document,
              measurementLogEntries: clearRoomMeasurementLogEntries(
                document.measurementLogEntries,
                roomId,
              ),
            }));
            if (project.roomCaptures.some((room) => room.id === roomId)) {
              setSelectedRoomId(roomId);
            }
            setScreenView("log");
            setSelectedLogEntryId(undefined);
          },
        },
      ],
    );
  }

  function confirmClearAllMeasurements() {
    const totalCount = projectDocuments.reduce(
      (count, document) => count + document.measurementLogEntries.length,
      0,
    );

    Alert.alert(
      "Clear ALL measurement logs?",
      `This will permanently delete ${totalCount} measurement${
        totalCount === 1 ? "" : "s"
      } from every room in the app.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear All",
          style: "destructive",
          onPress: () => {
            const nextDocuments = projectDocuments.map((document) => ({
              ...document,
              measurementLogEntries: clearAllMeasurementLogEntries(),
            }));

            void persistProjectDocuments(nextDocuments);
            setScreenView("log");
            setSelectedLogEntryId(undefined);
          },
        },
      ],
    );
  }

  async function handleShareDiagnostics(entry: MeasurementLogEntry) {
    const payload =
      entry.type === "single"
        ? {
            measurementId: entry.measurement.id,
            roomId: entry.roomCaptureId,
            mode: entry.measurement.mode,
            rawDistanceMeters: entry.measurement.rawDistanceMeters,
            rawDistanceInches: entry.measurement.rawDistanceInches,
            displayDistanceInches: entry.measurement.displayDistanceInches,
            pointA: entry.measurement.startPoint,
            pointB: entry.measurement.endPoint,
            confidence: entry.measurement.confidence,
            timestamp: entry.createdAt,
          }
        : {
            measurementGroupId: entry.id,
            roomId: entry.roomCaptureId,
            mode: entry.resolvedMeasurement.mode,
            resolvedDistanceMeters: entry.resolvedMeasurement.resolvedDistanceMeters,
            resolvedDistanceInches: entry.resolvedMeasurement.resolvedDistanceInches,
            displayDistanceInches: entry.resolvedMeasurement.displayDistanceInches,
            confidence: entry.resolvedMeasurement.confidence,
            passes: entry.passes.map((pass) => ({
              passNumber: pass.passNumber,
              measurementId: pass.measurement.id,
              rawDistanceMeters: pass.measurement.rawDistanceMeters,
              rawDistanceInches: pass.measurement.rawDistanceInches,
              displayDistanceInches: pass.measurement.displayDistanceInches,
              observationStatus: pass.observationStatus,
              deviationFromResolvedInches: pass.deviationFromResolvedInches,
            })),
            timestamp: entry.createdAt,
          };

    await Share.share({
      message: JSON.stringify(payload, null, 2),
      title: "Measurement diagnostics",
    });
  }

  const renderMeasureView = () => (
    <View style={styles.measureContainer}>
      <View style={styles.arContainer}>
        <NativeMeasurementARView
          capturePointRole={capturePointRole}
          captureRequestId={captureRequestId}
          onMeasurementUpdate={(event) => handleMeasurementUpdate(event.nativeEvent)}
          resetCounter={resetCounter}
          style={styles.arView}
        />

        <View pointerEvents="none" style={styles.reticleOverlay}>
          {(() => {
            const reticleStateStyle =
              reticle.state === "green"
                ? styles.reticleGreen
                : reticle.state === "yellow"
                  ? styles.reticleYellow
                  : styles.reticleRed;
            const reticleLineStyle =
              reticle.state === "green"
                ? styles.reticleLineGreen
                : reticle.state === "yellow"
                  ? styles.reticleLineYellow
                  : styles.reticleLineRed;

            return (
          <View
            style={[
              styles.reticle,
              reticleStateStyle,
            ]}
          >
            <View style={[styles.reticleHorizontal, reticleLineStyle]} />
            <View style={[styles.reticleVertical, reticleLineStyle]} />
          </View>
            );
          })()}
        </View>
      </View>

      <View style={styles.bottomPanel}>
        <Text style={styles.statusText}>{status}</Text>

        <View style={styles.selectionSection}>
          <Text style={styles.sectionLabel}>Project</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
          >
            {projectDocuments.map((document) => (
              <SelectionChip
                key={document.project.id}
                label={document.project.name}
                onPress={() => setSelectedProjectId(document.project.id)}
                selected={document.project.id === selectedProjectId}
              />
            ))}
          </ScrollView>
        </View>

        {selectedProject ? (
          <View style={styles.selectionSection}>
            <Text style={styles.sectionLabel}>Room</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipRow}
            >
              {selectedProject.roomCaptures.map((room) => (
                <SelectionChip
                  key={room.id}
                  label={room.name}
                  onPress={() => setSelectedRoomId(room.id)}
                  selected={room.id === selectedRoomId}
                />
              ))}
            </ScrollView>
          </View>
        ) : null}

        <View style={styles.selectionSection}>
          <Text style={styles.sectionLabel}>Mode</Text>
          <View style={styles.chipRow}>
            <SelectionChip
              label="Single"
              onPress={() => handleChangeMeasurementMode("single")}
              selected={measurementMode === "single"}
            />
            <SelectionChip
              label="Multi-Capture"
              onPress={() => handleChangeMeasurementMode("multi-capture")}
              selected={measurementMode === "multi-capture"}
            />
          </View>
        </View>

        <View style={styles.trackingRow}>
          <Text style={styles.sectionLabel}>Reticle</Text>
          <Text style={styles.sectionValue}>{reticle.state.toUpperCase()}</Text>
          <Text style={styles.sectionLabel}>Tracking</Text>
          <Text style={styles.sectionValue}>{tracking.quality.toUpperCase()}</Text>
        </View>

        {latestSingleMeasurement ? (
          <MeasurementSummaryCard
            measurement={latestSingleMeasurement}
            title="Single Measure"
            extra={
              <>
                <Text style={styles.cardCopy}>
                  Endpoint sources: {latestSingleMeasurement.startPoint.source} ·{" "}
                  {latestSingleMeasurement.endPoint.source}
                </Text>
                <Pressable
                  onPress={() =>
                    clearLiveMeasurementState(
                      "Measurement cleared. Aim at Point A to begin another measurement.",
                    )
                  }
                  style={styles.secondaryButton}
                >
                  <Text style={styles.secondaryButtonText}>Clear measurement</Text>
                </Pressable>
              </>
            }
          />
        ) : null}

        {measurementMode === "multi-capture" && multiCapturePreview ? (
          <MeasurementSummaryCard
            measurement={multiCapturePreview.resolvedMeasurement}
            title="Multi-Capture Result"
            extra={
              <>
                <Text style={styles.cardCopy}>
                  {multiCapturePreview.passes.length} passes ·{" "}
                  {multiCapturePreview.resolvedMeasurement.acceptedObservationCount} accepted ·{" "}
                  {multiCapturePreview.resolvedMeasurement.rejectedObservationCount} flagged
                </Text>
                {multiCapturePreview.resolvedMeasurement.rejectedObservationCount > 0 ? (
                  <Text style={styles.cardCopy}>
                    Measurements disagree significantly. Repeat measurement recommended.
                  </Text>
                ) : null}
              </>
            }
          />
        ) : null}

        {!measurementARViewAvailable ? (
          <View style={styles.measurementCard}>
            <Text style={styles.cardCopy}>
              AR measurement is currently unavailable on this device build.
            </Text>
          </View>
        ) : null}

        {!selectedProject ? (
          <View style={styles.measurementCard}>
            <Text style={styles.cardCopy}>
              Create or select a project in the workspace before measuring.
            </Text>
          </View>
        ) : null}

        {selectedProject && selectedProject.roomCaptures.length === 0 ? (
          <View style={styles.measurementCard}>
            <Text style={styles.cardCopy}>
              This project has no rooms yet. Create a room in the workspace before measuring.
            </Text>
          </View>
        ) : null}

        <View style={styles.actionRow}>
          <Pressable
            disabled={!canCapture}
            onPress={handleRequestCapture}
            style={[styles.primaryButton, !canCapture && styles.buttonDisabled]}
          >
            <Text style={styles.primaryButtonText}>
              {nextCaptureRole === "start" ? "Capture A" : "Capture B"}
            </Text>
          </Pressable>

          <Pressable
            onPress={() =>
              measurementMode === "multi-capture"
                ? clearMultiCaptureSession("Multi-Capture cleared. Aim at Point A for a new pass.")
                : clearLiveMeasurementState(
                    "Measurement cleared. Aim at Point A to begin another measurement.",
                  )
            }
            style={styles.secondaryButton}
          >
            <Text style={styles.secondaryButtonText}>
              {measurementMode === "multi-capture" ? "Cancel Session" : "Clear"}
            </Text>
          </Pressable>
        </View>

        {measurementMode === "multi-capture" && !!nativeSnapshot?.endPoint ? (
          <View style={styles.actionRow}>
            <Pressable onPress={handlePrepareNextMultiPass} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>Add Another Pass</Text>
            </Pressable>

            <Pressable
              disabled={multiCapturePasses.length === 0}
              onPress={() => void handleFinishMultiCapture()}
              style={[
                styles.secondaryButton,
                multiCapturePasses.length === 0 && styles.buttonDisabledSecondary,
              ]}
            >
              <Text style={styles.secondaryButtonText}>Finish Multi-Capture</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </View>
  );

  const renderLogView = () => (
    <ScrollView contentContainerStyle={styles.logContent}>
      <View style={styles.logActions}>
        <Pressable onPress={() => setScreenView("measure")} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>Back to AR</Text>
        </Pressable>

        <Pressable onPress={confirmClearAllMeasurements} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>Clear All</Text>
        </Pressable>
      </View>

      {selectedProject ? (
        selectedProject.roomCaptures.map((room) => {
          const entries =
            selectedProjectDocument?.measurementLogEntries.filter(
              (entry) => entry.roomCaptureId === room.id,
            ) ?? [];

          return (
            <View key={room.id} style={styles.logRoomCard}>
              <View style={styles.logRoomHeader}>
                <View>
                  <Text style={styles.sectionLabel}>{room.name}</Text>
                  <Text style={styles.cardCopy}>
                    {entries.length} measurement{entries.length === 1 ? "" : "s"}
                  </Text>
                </View>

                <Pressable
                  disabled={entries.length === 0}
                  onPress={() => confirmClearRoom(selectedProject, room.id, room.name)}
                  style={[
                    styles.secondaryButton,
                    entries.length === 0 && styles.buttonDisabledSecondary,
                  ]}
                >
                  <Text style={styles.secondaryButtonText}>Clear Room</Text>
                </Pressable>
              </View>

              {entries.length === 0 ? (
                <Text style={styles.cardCopy}>No measurements recorded for this room yet.</Text>
              ) : (
                entries.map((entry, index) => (
                  <Pressable
                    key={entry.id}
                    onPress={() => {
                      setSelectedLogEntryId(entry.id);
                      setScreenView("detail");
                    }}
                    style={styles.logEntry}
                  >
                    <Text style={styles.logEntryTitle}>
                      {entry.type === "single"
                        ? `Measurement ${String(index + 1).padStart(3, "0")}`
                        : `Multi-Capture ${String(index + 1).padStart(3, "0")}`}
                    </Text>
                    <Text style={styles.logEntryValue}>
                      {entry.type === "single"
                        ? entry.measurement.displayDistanceLabel
                        : entry.resolvedMeasurement.displayDistanceLabel}
                    </Text>
                    <Text style={styles.cardCopy}>
                      {entry.type === "single"
                        ? `Single · ${entry.measurement.confidence.level.toUpperCase()} confidence`
                        : `${entry.passes.length} passes · ${entry.resolvedMeasurement.confidence.level.toUpperCase()} confidence`}
                    </Text>
                  </Pressable>
                ))
              )}
            </View>
          );
        })
      ) : (
        <Text style={styles.cardCopy}>No project selected.</Text>
      )}
    </ScrollView>
  );

  const renderDetailView = () => {
    if (!selectedLogEntry) {
      return renderLogView();
    }

    return (
      <ScrollView contentContainerStyle={styles.logContent}>
        <View style={styles.logActions}>
          <Pressable onPress={() => setScreenView("log")} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Back to Log</Text>
          </Pressable>

          <Pressable
            onPress={() => void handleShareDiagnostics(selectedLogEntry)}
            style={styles.secondaryButton}
          >
            <Text style={styles.secondaryButtonText}>Share Diagnostics</Text>
          </Pressable>
        </View>

        <View style={styles.logRoomCard}>
          <Text style={styles.sectionLabel}>
            {selectedLogEntry.type === "single" ? "Single Measurement" : "Multi-Capture"}
          </Text>

          {selectedLogEntry.type === "single" ? (
            <>
              <Text style={styles.measurementValue}>
                {selectedLogEntry.measurement.displayDistanceLabel}
              </Text>
              <Text style={styles.cardCopy}>
                Raw: {formatDecimalInches(selectedLogEntry.measurement.rawDistanceInches)}
              </Text>
              <Text style={styles.cardCopy}>Mode: Single</Text>
              <Text style={styles.cardCopy}>
                Confidence: {selectedLogEntry.measurement.confidence.level.toUpperCase()}
              </Text>
              <Text style={styles.cardCopy}>
                Point A source: {selectedLogEntry.measurement.startPoint.source}
              </Text>
              <Text style={styles.cardCopy}>
                Point B source: {selectedLogEntry.measurement.endPoint.source}
              </Text>
              <Text style={styles.cardCopy}>
                Tracking: {selectedLogEntry.measurement.trackingMetadata.quality}
              </Text>
              <Text style={styles.cardCopy}>Created: {selectedLogEntry.createdAt}</Text>
            </>
          ) : (
            <>
              <Text style={styles.measurementValue}>
                {selectedLogEntry.resolvedMeasurement.displayDistanceLabel}
              </Text>
              <Text style={styles.cardCopy}>
                Accepted: {selectedLogEntry.resolvedMeasurement.acceptedObservationCount}
              </Text>
              <Text style={styles.cardCopy}>
                Rejected: {selectedLogEntry.resolvedMeasurement.rejectedObservationCount}
              </Text>
              <Text style={styles.cardCopy}>
                Confidence: {selectedLogEntry.resolvedMeasurement.confidence.level.toUpperCase()}
              </Text>

              <View style={styles.passList}>
                {selectedLogEntry.passes.map((pass) => (
                  <View key={pass.id} style={styles.passRow}>
                    <Text style={styles.logEntryTitle}>Pass {pass.passNumber}</Text>
                    <Text style={styles.logEntryValue}>{pass.measurement.displayDistanceLabel}</Text>
                    <Text style={styles.cardCopy}>
                      {pass.observationStatus === "accepted" ? "Accepted" : "Flagged / Rejected"}
                    </Text>
                    <Text style={styles.cardCopy}>
                      Deviation from resolved:{" "}
                      {formatDecimalInches(Math.abs(pass.deviationFromResolvedInches))}
                    </Text>
                  </View>
                ))}
              </View>
            </>
          )}

          <View style={styles.actionRow}>
            <Pressable
              onPress={() => confirmDeleteEntry(selectedLogEntry)}
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryButtonText}>Delete</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    );
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.loadingContainer}>
          <Text style={styles.cardCopy}>Loading measurement workspace…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.topBar}>
        <View>
          <Text style={styles.eyebrow}>Construction measurement</Text>
          <Text style={styles.title}>
            {screenView === "measure"
              ? measurementMode === "single"
                ? "Single Measure"
                : "Multi-Capture"
              : "Measurement Log"}
          </Text>
        </View>

        <View style={styles.topBarActions}>
          {screenView === "measure" ? (
            <Pressable onPress={() => setScreenView("log")} style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>Measurement Log</Text>
            </Pressable>
          ) : null}

          <Pressable onPress={onClose} style={styles.closeButton}>
            <Text style={styles.closeButtonText}>Close</Text>
          </Pressable>
        </View>
      </View>

      {screenView === "measure"
        ? renderMeasureView()
        : screenView === "log"
          ? renderLogView()
          : renderDetailView()}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#050505",
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  topBar: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    backgroundColor: "#050505",
  },
  topBarActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  eyebrow: {
    color: "#b0b0b0",
    fontSize: 12,
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  title: {
    color: "#f5f5f5",
    fontSize: 22,
    fontWeight: "700",
    marginTop: 4,
  },
  closeButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: "#f3f3f3",
  },
  closeButtonText: {
    color: "#101010",
    fontWeight: "600",
  },
  measureContainer: {
    flex: 1,
  },
  arContainer: {
    flex: 1,
    backgroundColor: "#101010",
  },
  arView: {
    flex: 1,
  },
  reticleOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
  },
  reticle: {
    width: 54,
    height: 54,
    borderRadius: 27,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  reticleHorizontal: {
    position: "absolute",
    width: 28,
    height: 2,
  },
  reticleVertical: {
    position: "absolute",
    width: 2,
    height: 28,
  },
  reticleGreen: {
    borderColor: "#3ed074",
  },
  reticleLineGreen: {
    backgroundColor: "#3ed074",
  },
  reticleYellow: {
    borderColor: "#f0b429",
  },
  reticleLineYellow: {
    backgroundColor: "#f0b429",
  },
  reticleRed: {
    borderColor: "#d64545",
  },
  reticleLineRed: {
    backgroundColor: "#d64545",
  },
  bottomPanel: {
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 24,
    backgroundColor: "#111111",
    gap: 12,
  },
  statusText: {
    color: "#f4f4f4",
    fontSize: 15,
    lineHeight: 20,
  },
  sectionLabel: {
    color: "#b0b0b0",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1.1,
  },
  selectionSection: {
    gap: 8,
  },
  chipRow: {
    flexDirection: "row",
    gap: 8,
  },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#444",
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "#171717",
  },
  chipSelected: {
    borderColor: "#f0b429",
    backgroundColor: "#2b2412",
  },
  chipText: {
    color: "#d7d7d7",
    fontWeight: "500",
  },
  chipTextSelected: {
    color: "#fff2cc",
  },
  trackingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  sectionValue: {
    color: "#f4f4f4",
    fontWeight: "700",
    marginRight: 12,
  },
  measurementCard: {
    backgroundColor: "#1b1b1b",
    borderRadius: 16,
    padding: 16,
    gap: 8,
  },
  measurementValue: {
    color: "#ffffff",
    fontSize: 34,
    fontWeight: "800",
  },
  confidenceValue: {
    color: "#d7d7d7",
    fontSize: 16,
    fontWeight: "700",
  },
  cardCopy: {
    color: "#c4c4c4",
    fontSize: 14,
    lineHeight: 18,
  },
  actionRow: {
    flexDirection: "row",
    gap: 12,
  },
  primaryButton: {
    flex: 1,
    backgroundColor: "#f0b429",
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center",
  },
  primaryButtonText: {
    color: "#111111",
    fontWeight: "700",
  },
  secondaryButton: {
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#4b4b4b",
    backgroundColor: "#171717",
  },
  secondaryButtonText: {
    color: "#f4f4f4",
    fontWeight: "600",
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  buttonDisabledSecondary: {
    opacity: 0.45,
  },
  logContent: {
    padding: 18,
    gap: 14,
  },
  logActions: {
    flexDirection: "row",
    gap: 10,
  },
  logRoomCard: {
    backgroundColor: "#161616",
    borderRadius: 16,
    padding: 16,
    gap: 12,
  },
  logRoomHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  logEntry: {
    borderRadius: 12,
    backgroundColor: "#1f1f1f",
    padding: 14,
    gap: 4,
  },
  logEntryTitle: {
    color: "#f4f4f4",
    fontWeight: "700",
  },
  logEntryValue: {
    color: "#ffffff",
    fontSize: 22,
    fontWeight: "800",
  },
  passList: {
    gap: 10,
  },
  passRow: {
    backgroundColor: "#1f1f1f",
    borderRadius: 12,
    padding: 12,
    gap: 4,
  },
});
