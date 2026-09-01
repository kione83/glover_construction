import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { starterCatalog } from "../../domain/catalog";
import {
  addRoomToSpatialModel,
  clearSavedRoomScansFromProject,
  clearRoomPlacementsFromProject,
  connectRoomsInProject,
  removeRoomFromProject,
  type CatalogObject,
  type Project,
  type RoomCapture,
  type RoomConnectionType,
} from "../../domain/projects";
import { defaultValidationRules } from "../../domain/validation";
import { validateProject } from "../../domain/validationService";
import { createEmptyProjectDocument, updateProjectSummary } from "../../storage/projectDocument";
import {
  loadProjectDocuments,
  saveProjectDocuments,
} from "../../storage/projectRepository";
import { colors } from "../../theme/colors";
import type { SavedRoomViewerMode } from "../roomViewer/SavedRoomViewerScreen";

interface HomeScreenProps {
  onOpenCamera: (onPhotoCaptured: (uri: string) => void, onClearPlacements: () => void) => void;
  onOpenStream: (onClearPlacements: () => void) => void;
  onOpenMeasure: (catalogObjectId?: string) => void;
  onOpenRoomScan: (projectId: string) => void;
  onOpenRoomViewer: (projectId: string, roomId?: string, mode?: SavedRoomViewerMode) => void;
}

export function HomeScreen({ onOpenCamera, onOpenStream, onOpenMeasure, onOpenRoomScan, onOpenRoomViewer }: HomeScreenProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>();
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [clientName, setClientName] = useState("");
  const [siteName, setSiteName] = useState("");
  const [roomName, setRoomName] = useState("");
  const [selectedCatalogObjectId, setSelectedCatalogObjectId] = useState<string>();
  const [fieldNoteText, setFieldNoteText] = useState("");

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId),
    [projects, selectedProjectId],
  );

  useEffect(() => {
    void (async () => {
      const documents = await loadProjectDocuments();
      const loadedProjects = documents.map((document) => document.project);
      setProjects(loadedProjects);
      setSelectedProjectId(loadedProjects[0]?.id);
      setIsLoading(false);
    })();
  }, []);

  async function persist(nextProjects: Project[]) {
    setProjects(nextProjects);
    const existingDocuments = await loadProjectDocuments();

    await saveProjectDocuments(
      nextProjects.map((project) => {
        const existingDocument = existingDocuments.find(
          (document) => document.project.id === project.id,
        );

        if (existingDocument) {
          return {
            ...existingDocument,
            project,
          };
        }

        return {
          ...createEmptyProjectDocument({
            id: project.id,
            name: project.name,
          }),
          project,
        };
      }),
    );
  }

  async function createProject() {
    const name = projectName.trim();
    if (!name) {
      Alert.alert("Project name required", "Enter a name to create a project.");
      return;
    }

    const document = createEmptyProjectDocument({
      id: `project-${Date.now()}`,
      name,
      clientName: clientName.trim() || undefined,
      siteName: siteName.trim() || undefined,
    });
    const nextProjects = [document.project, ...projects];
    await persist(nextProjects);
    setSelectedProjectId(document.project.id);
    setProjectName("");
    setClientName("");
    setSiteName("");
    setIsCreating(false);
  }

  async function updateSelectedProject(update: (project: Project) => Project) {
    if (!selectedProject) return;
    const updatedProject = update(selectedProject);
    await persist(
      projects.map((project) => (project.id === updatedProject.id ? updatedProject : project)),
    );
  }

  async function addManualRoom() {
    const name = roomName.trim();
    if (!name) return;

    const roomId = `room-${Date.now()}`;
    const room: RoomCapture = {
      id: roomId,
      name,
      status: "completed",
      source: "manual",
      unit: "m",
      capturedAt: new Date().toISOString(),
      surfaces: ["wall", "floor", "ceiling"].map((kind) => ({
        id: `${roomId}-${kind}`,
        kind: kind as "wall" | "floor" | "ceiling",
        label: `${name} ${kind}`,
      })),
    };
    await updateSelectedProject((project) =>
      updateProjectSummary({
        ...addRoomToSpatialModel(project, roomId),
        status: "scanned",
        roomCaptures: [...project.roomCaptures, room],
      }),
    );
    setRoomName("");
  }

  async function addFieldNote() {
    const text = fieldNoteText.trim();
    if (!text || !selectedProject) return;
    const note = { id: `note-${Date.now()}`, text, createdAt: new Date().toISOString() };
    await updateSelectedProject((project) => ({ ...project, fieldNotes: [note, ...project.fieldNotes] }));
    setFieldNoteText("");
  }

  async function addProjectPhoto(uri: string) {
    if (!selectedProject) return;
    const photo = { id: `photo-${Date.now()}`, uri, capturedAt: new Date().toISOString() };
    await updateSelectedProject((project) => ({ ...project, photos: [photo, ...project.photos] }));
  }

  function clearSelectedRoomPlacements() {
    if (!selectedProject) return;

    const room = selectedProject.roomCaptures[0];
    if (!room) {
      Alert.alert("No room selected", "Add a room before clearing placements.");
      return;
    }

    const count = selectedProject.placedObjects.filter(
      (object) => object.roomCaptureId === room.id,
    ).length;
    if (count === 0) {
      Alert.alert("No placements", `There are no virtual placements in ${room.name}.`);
      return;
    }

    Alert.alert(
      `Clear placements in ${room.name}?`,
      `This removes ${count} virtual placement${count === 1 ? "" : "s"}. Measurements, room data, photos, and notes will remain saved.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear Placements",
          style: "destructive",
          onPress: () => {
            const detectedAt = new Date().toISOString();
            void updateSelectedProject((project) => {
              const clearedProject = clearRoomPlacementsFromProject(project, room.id);
              return updateProjectSummary({
                ...clearedProject,
                validationIssues: validateProject(clearedProject, detectedAt),
              });
            });
          },
        },
      ],
    );
  }

  async function placeCatalogObject(catalogObject: CatalogObject) {
    if (!selectedProject?.roomCaptures[0]) {
      Alert.alert("Add a room first", "Manual placement needs a room to attach to.");
      return;
    }

    const room = selectedProject.roomCaptures[0];
    const surface = room.surfaces.find((candidate) =>
      catalogObject.allowedSurfaceKinds.includes(candidate.kind),
    );
    if (!surface) {
      Alert.alert("No compatible surface", "Add a room with a compatible surface first.");
      return;
    }

    const now = new Date().toISOString();
    const objectId = `placed-${Date.now()}`;
    const anchorId = `anchor-${Date.now()}`;
    const transform = {
      position: { x: 0, y: 0, z: 0 },
      rotation: { pitch: 0, yaw: 0, roll: 0 },
      scale: { x: 1, y: 1, z: 1 },
    };

    await updateSelectedProject((project) =>
      updateProjectSummary({
        ...project,
        status: "layout-in-progress",
        anchors: [
          ...project.anchors,
          {
            id: anchorId,
            roomCaptureId: room.id,
            reference: { surfaceId: surface.id, kind: surface.kind },
            transform,
          },
        ],
        placedObjects: [
          ...project.placedObjects,
          {
            id: objectId,
            catalogObjectId: catalogObject.id,
            roomCaptureId: room.id,
            anchorId,
            displayName: catalogObject.name,
            transform,
            dimensions: catalogObject.defaultDimensions,
            representation: catalogObject.representation,
            status: "active",
            placedAt: now,
            updatedAt: now,
          },
        ],
      }),
    );
  }

  async function runValidation() {
    if (!selectedProject) return;
    const validatedAt = new Date().toISOString();
    const validationIssues = validateProject(selectedProject, validatedAt);
    await updateSelectedProject((project) =>
      updateProjectSummary({
        ...project,
        validationIssues,
        summary: { ...project.summary, lastValidatedAt: validatedAt },
      }),
    );
  }

  function deleteRoom(room: RoomCapture) {
    Alert.alert(`Delete ${room.name}?`, "This removes the saved room scan, its placed objects, anchors, scan measurements, and room connections. Notes, photos, and other rooms remain.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete Room", style: "destructive", onPress: () => void deleteRoomConfirmed(room.id) },
    ]);
  }

  async function deleteRoomConfirmed(roomId: string) {
    const documents = await loadProjectDocuments();
    const updatedDocuments = documents.map((document) => {
      if (document.project.id !== selectedProjectId) return document;
      const nextProject = updateProjectSummary(removeRoomFromProject(document.project, roomId));
      return {
        ...document,
        project: nextProject,
        measurementLogEntries: document.measurementLogEntries.filter((entry) => entry.roomCaptureId !== roomId),
        scanMeasurementLogEntries: (document.scanMeasurementLogEntries ?? []).filter((entry) => entry.roomCaptureId !== roomId),
      };
    });
    await saveProjectDocuments(updatedDocuments);
    setProjects(updatedDocuments.map((document) => document.project));
  }

  function deleteAllScans() {
    if (!selectedProject?.roomCaptures.some((room) => room.source === "roomplan" || room.roomScan)) {
      Alert.alert("No saved scans", "This project has no RoomPlan scans to delete.");
      return;
    }
    Alert.alert("Delete all saved scans?", "All RoomPlan rooms, scan measurements, placed objects, anchors, and their connections will be removed. Notes, photos, manual rooms, and project metadata remain.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete All Scans", style: "destructive", onPress: () => void deleteAllScansConfirmed() },
    ]);
  }

  async function deleteAllScansConfirmed() {
    const documents = await loadProjectDocuments();
    const updatedDocuments = documents.map((document) => {
      if (document.project.id !== selectedProjectId) return document;
      const scanRoomIds = new Set(document.project.roomCaptures.filter((room) => room.source === "roomplan" || room.roomScan).map((room) => room.id));
      return {
        ...document,
        project: updateProjectSummary(clearSavedRoomScansFromProject(document.project)),
        measurementLogEntries: document.measurementLogEntries.filter((entry) => !scanRoomIds.has(entry.roomCaptureId)),
        scanMeasurementLogEntries: (document.scanMeasurementLogEntries ?? []).filter((entry) => !scanRoomIds.has(entry.roomCaptureId)),
      };
    });
    await saveProjectDocuments(updatedDocuments);
    setProjects(updatedDocuments.map((document) => document.project));
  }

  function deleteAllScansEverywhere() {
    const scanCount = projects.reduce(
      (count, project) => count + project.roomCaptures.filter((room) => room.source === "roomplan" || room.roomScan).length,
      0,
    );
    if (scanCount === 0) {
      Alert.alert("No saved scans", "There are no saved RoomPlan scans in the app.");
      return;
    }

    Alert.alert(
      "Delete all scans in the app?",
      `This removes ${scanCount} saved RoomPlan room${scanCount === 1 ? "" : "s"} from every project, including their placements, anchors, measurements, and connections. Notes, photos, manual rooms, and project metadata remain.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete All Scans", style: "destructive", onPress: () => void deleteAllScansEverywhereConfirmed() },
      ],
    );
  }

  async function deleteAllScansEverywhereConfirmed() {
    const documents = await loadProjectDocuments();
    const updatedDocuments = documents.map((document) => {
      const scanRoomIds = new Set(
        document.project.roomCaptures
          .filter((room) => room.source === "roomplan" || room.roomScan)
          .map((room) => room.id),
      );
      return {
        ...document,
        project: updateProjectSummary(clearSavedRoomScansFromProject(document.project)),
        measurementLogEntries: document.measurementLogEntries.filter((entry) => !scanRoomIds.has(entry.roomCaptureId)),
        scanMeasurementLogEntries: (document.scanMeasurementLogEntries ?? []).filter((entry) => !scanRoomIds.has(entry.roomCaptureId)),
      };
    });
    await saveProjectDocuments(updatedDocuments);
    setProjects(updatedDocuments.map((document) => document.project));
  }

  async function saveRoomConnection(input: {
    parentRoomId: string;
    childRoomId: string;
    connectionType: RoomConnectionType;
    parentFeatureId: string;
    childFeatureId: string;
    x: string;
    y: string;
    z: string;
    yaw: string;
  }) {
    if (!selectedProject || input.parentRoomId === input.childRoomId) {
      Alert.alert("Choose two rooms", "Select different parent and child rooms before connecting them.");
      return;
    }
    await updateSelectedProject((project) => updateProjectSummary(connectRoomsInProject(project, {
      id: `connection-${Date.now()}`,
      parentRoomId: input.parentRoomId,
      childRoomId: input.childRoomId,
      connectionType: input.connectionType,
      parentFeatureId: input.parentFeatureId.trim() || undefined,
      childFeatureId: input.childFeatureId.trim() || undefined,
      transform: { position: { x: Number(input.x) || 0, y: Number(input.y) || 0, z: Number(input.z) || 0 }, rotation: { pitch: 0, yaw: Number(input.yaw) || 0, roll: 0 }, scale: { x: 1, y: 1, z: 1 } },
      alignmentMethod: "user-assisted",
      elevationChangeMeters: Number(input.y) || 0,
    })));
  }

  if (isLoading) {
    return <ActivityIndicator color={colors.accent} size="large" />;
  }

  return (
    <View style={styles.screen}>
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>Construction AR Platform</Text>
        <Text style={styles.title}>Project workspace</Text>
      </View>

      <View style={styles.panel}>
        <View style={styles.sectionHeader}>
          <Text style={styles.panelTitle}>Projects</Text>
          <Button label="New project" onPress={() => setIsCreating(true)} />
        </View>
        {isCreating && (
          <View style={styles.form}>
            <Field label="Project name *" value={projectName} onChangeText={setProjectName} />
            <Field label="Client" value={clientName} onChangeText={setClientName} />
            <Field label="Site" value={siteName} onChangeText={setSiteName} />
            <Button label="Create project" onPress={() => void createProject()} />
          </View>
        )}
        <View style={styles.moduleList}>
          {projects.length === 0 && <Text style={styles.empty}>No projects yet.</Text>}
          {projects.map((project) => (
            <Pressable key={project.id} onPress={() => setSelectedProjectId(project.id)} style={[styles.moduleCard, project.id === selectedProjectId && styles.selectedCard]}>
              <Text style={styles.moduleName}>{project.name}</Text>
              <Text style={styles.moduleDescription}>{project.clientName ?? "No client"} · {project.siteName ?? "No site"}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {selectedProject && <ProjectDashboard project={selectedProject} roomName={roomName} onRoomNameChange={setRoomName} onAddRoom={() => void addManualRoom()} onDeleteRoom={deleteRoom} onDeleteAllScans={deleteAllScans} onDeleteAllScansEverywhere={deleteAllScansEverywhere} onSaveRoomConnection={saveRoomConnection} onOpenRoomViewer={onOpenRoomViewer} selectedCatalogObjectId={selectedCatalogObjectId} onSelectCatalogObject={setSelectedCatalogObjectId} onPlaceObject={(item: any) => void placeCatalogObject(item)} onRunValidation={() => void runValidation()} onOpenCamera={() => onOpenCamera((uri) => void addProjectPhoto(uri), clearSelectedRoomPlacements)} onOpenStream={() => onOpenStream(clearSelectedRoomPlacements)} onClearPlacements={clearSelectedRoomPlacements} onOpenMeasure={onOpenMeasure} onOpenRoomScan={() => onOpenRoomScan(selectedProject.id)} fieldNoteText={fieldNoteText} onFieldNoteTextChange={setFieldNoteText} onAddFieldNote={() => void addFieldNote()} />}
    </View>
  );
}

function ProjectDashboard({ project, roomName, onRoomNameChange, onAddRoom, onDeleteRoom, onDeleteAllScans, onDeleteAllScansEverywhere, onSaveRoomConnection, onOpenRoomViewer, selectedCatalogObjectId, onSelectCatalogObject, onPlaceObject, onRunValidation, onOpenCamera, onOpenStream, onClearPlacements, onOpenMeasure, onOpenRoomScan, fieldNoteText, onFieldNoteTextChange, onAddFieldNote }: any) {
  const selectedCatalogObject = starterCatalog.find((item) => item.id === selectedCatalogObjectId);
  return <View style={styles.panel}>
    <Text style={styles.panelTitle}>{project.name}</Text>
    <View style={styles.metrics}><Metric label="Rooms" value={project.summary.roomCount} /><Metric label="Placed" value={project.summary.placedObjectCount} /><Metric label="Issues" value={project.summary.validationIssueCount} /></View>
    <View style={styles.actionList}>
      <Button label="Reset room placements" onPress={onClearPlacements} />
      <Button label="Capture photo" onPress={onOpenCamera} />
      <Button label="Stream to laptop" onPress={onOpenStream} />
      <Button label="Open AR tools" onPress={onOpenMeasure} />
      <Button label="Scan Room" onPress={onOpenRoomScan} />
      <Button label="View 3D Model" onPress={() => onOpenRoomViewer(project.id, undefined, "project")} />
      {project.roomCaptures.filter((room: RoomCapture) => room.roomScan).length >= 2 && <Button label="Connect Rooms / Manual Alignment" onPress={() => onOpenRoomViewer(project.id, undefined, "alignment")} />}
    </View>
    <View style={styles.form}><Text style={styles.sectionLabel}>Manual room</Text><Field label="Room name" value={roomName} onChangeText={onRoomNameChange} /><Button label="Add room" onPress={onAddRoom} /></View>
    <View style={styles.form}><Text style={styles.sectionLabel}>Saved rooms and scans</Text>{project.roomCaptures.length === 0 ? <Text style={styles.empty}>No rooms saved.</Text> : project.roomCaptures.map((room: RoomCapture) => <View key={room.id} style={styles.roomRow}><View style={styles.roomRowCopy}><Text style={styles.moduleName}>{room.name}</Text><Text style={styles.moduleDescription}>{room.source === "roomplan" || room.roomScan ? "RoomPlan scan" : "Manual room"}</Text></View>{room.roomScan && <Pressable onPress={() => onOpenRoomViewer(project.id, room.id, "room")} style={styles.viewButton}><Text style={styles.viewButtonText}>View 3D Scan</Text></Pressable>}<Pressable onPress={() => onDeleteRoom(room)} style={styles.deleteButton}><Text style={styles.deleteButtonText}>{room.roomScan ? "Delete scan" : "Delete room"}</Text></Pressable></View>)}<Button label="Delete scans in this project" onPress={onDeleteAllScans} /><Button label="Delete all scans (all projects)" onPress={onDeleteAllScansEverywhere} /></View>
    <RoomConnectionPanel project={project} onSave={onSaveRoomConnection} />
    <Text style={styles.sectionLabel}>Catalog</Text>
    <View style={styles.catalogList}>{starterCatalog.map((item: any) => <Pressable key={item.id} onPress={() => onSelectCatalogObject(item.id)} style={[styles.catalogItem, item.id === selectedCatalogObjectId && styles.selectedCard]}><Text style={styles.moduleName}>{item.name}</Text><Text style={styles.moduleDescription}>{item.category} · {item.placementMode}</Text></Pressable>)}</View>
    {selectedCatalogObject && <Button label={`Open AR placement for ${selectedCatalogObject.name}`} onPress={() => onOpenMeasure(selectedCatalogObject.id)} />}
    {project.placedObjects.length > 0 && <><Text style={styles.sectionLabel}>Current layout</Text>{project.placedObjects.filter((item: any) => item.status === "active").map((item: any, index: number) => <Text key={`${item.id}-${index}`} style={styles.layoutItem}>{item.displayName}</Text>)}</>}
    <View style={styles.form}><Text style={styles.sectionLabel}>Field notes</Text><Field label="Add a note" value={fieldNoteText} onChangeText={onFieldNoteTextChange} /><Button label="Save note" onPress={onAddFieldNote} />{project.fieldNotes.length === 0 ? <Text style={styles.empty}>No field notes yet.</Text> : project.fieldNotes.slice(0, 5).map((note: any) => <View key={note.id} style={styles.note}><Text style={styles.moduleDescription}>{note.text}</Text><Text style={styles.noteDate}>{new Date(note.createdAt).toLocaleString()}</Text></View>)}</View>
    <View style={styles.form}><Text style={styles.sectionLabel}>Site photos ({project.photos.length})</Text>{project.photos.length === 0 ? <Text style={styles.empty}>No site photos yet.</Text> : <View style={styles.photoGrid}>{project.photos.slice(0, 6).map((photo: any) => <Image key={photo.id} source={{ uri: photo.uri }} style={styles.photo} accessibilityLabel="Project site photo" />)}</View>}</View>
    <View style={styles.validationHeader}><Text style={styles.sectionLabel}>Validation</Text><Button label="Run validation" onPress={onRunValidation} /></View>
    <ValidationResults project={project} />
  </View>;
}

function RoomConnectionPanel({ project, onSave }: { project: Project; onSave: (input: any) => void }) {
  const [parentRoomId, setParentRoomId] = useState(project.roomCaptures[0]?.id ?? "");
  const [childRoomId, setChildRoomId] = useState(project.roomCaptures[1]?.id ?? "");
  const [connectionType, setConnectionType] = useState<RoomConnectionType>("doorway");
  const [parentFeatureId, setParentFeatureId] = useState("");
  const [childFeatureId, setChildFeatureId] = useState("");
  const [x, setX] = useState("0");
  const [y, setY] = useState("0");
  const [z, setZ] = useState("0");
  const [yaw, setYaw] = useState("0");
  const connectionTypes: RoomConnectionType[] = ["door", "doorway", "shared-wall", "corner", "opening", "hallway", "stairs"];
  return <View style={styles.form}>
    <Text style={styles.sectionLabel}>Connect rooms</Text>
    <Text style={styles.helper}>Select a stable architectural feature in each saved scan, then enter Room B’s transform relative to Room A. Distances are meters and yaw is radians.</Text>
    <Text style={styles.fieldLabel}>Parent room</Text><View style={styles.chipRow}>{project.roomCaptures.map((room) => <Pressable key={`parent-${room.id}`} onPress={() => setParentRoomId(room.id)} style={[styles.chip, parentRoomId === room.id && styles.chipSelected]}><Text style={styles.chipText}>{room.name}</Text></Pressable>)}</View>
    <Text style={styles.fieldLabel}>Child room</Text><View style={styles.chipRow}>{project.roomCaptures.map((room) => <Pressable key={`child-${room.id}`} onPress={() => setChildRoomId(room.id)} style={[styles.chip, childRoomId === room.id && styles.chipSelected]}><Text style={styles.chipText}>{room.name}</Text></Pressable>)}</View>
    <Text style={styles.fieldLabel}>Shared feature type</Text><View style={styles.chipRow}>{connectionTypes.map((type) => <Pressable key={type} onPress={() => setConnectionType(type)} style={[styles.chip, connectionType === type && styles.chipSelected]}><Text style={styles.chipText}>{type}</Text></Pressable>)}</View>
    <Field label="Parent feature ID (optional)" value={parentFeatureId} onChangeText={setParentFeatureId} /><Field label="Child feature ID (optional)" value={childFeatureId} onChangeText={setChildFeatureId} />
    <View style={styles.connectionFields}><Field label="Offset X (m)" value={x} onChangeText={setX} /><Field label="Elevation Y (m)" value={y} onChangeText={setY} /><Field label="Offset Z (m)" value={z} onChangeText={setZ} /><Field label="Yaw (radians)" value={yaw} onChangeText={setYaw} /></View>
    <Button label="Save room connection" onPress={() => onSave({ parentRoomId, childRoomId, connectionType, parentFeatureId, childFeatureId, x, y, z, yaw })} />
    {(project.spatialModel?.connections ?? []).map((connection) => <Text key={connection.id} style={styles.moduleDescription}>{connection.connectionType}: {connection.parentRoomId} → {connection.childRoomId} · elevation {connection.elevationChangeMeters.toFixed(2)}m</Text>)}
  </View>;
}

function ValidationResults({ project }: { project: Project }) {
  if (!project.summary.lastValidatedAt) return <Text style={styles.empty}>Run validation to review this layout.</Text>;
  if (project.validationIssues.length === 0) return <Text style={styles.success}>No validation issues found.</Text>;
  const errors = project.validationIssues.filter((item: any) => item.severity === "error");
  const warnings = project.validationIssues.filter((item: any) => item.severity === "warning");
  return <View style={styles.issueList}>{errors.length > 0 && <Text style={styles.errorLabel}>Errors ({errors.length})</Text>}{warnings.length > 0 && <Text style={styles.warningLabel}>Warnings ({warnings.length})</Text>}{project.validationIssues.map((item: any, index: number) => <View key={`${item.id}-${index}`} style={styles.issue}><Text style={item.severity === "error" ? styles.errorLabel : styles.warningLabel}>{item.severity.toUpperCase()} · {defaultValidationRules.find((rule) => rule.id === item.ruleId)?.name ?? item.ruleId}</Text><Text style={styles.moduleDescription}>{item.message}</Text></View>)}</View>;
}

function Field({ label, value, onChangeText }: { label: string; value: string; onChangeText: (value: string) => void }) { return <View style={styles.field}><Text style={styles.fieldLabel}>{label}</Text><TextInput value={value} onChangeText={onChangeText} placeholder={label} placeholderTextColor={colors.muted} style={styles.input} /></View>; }
function Button({ label, onPress }: { label: string; onPress: () => void }) { return <Pressable onPress={onPress} style={styles.button}><Text style={styles.buttonText}>{label}</Text></Pressable>; }
function Metric({ label, value }: { label: string; value: number }) { return <View style={styles.metric}><Text style={styles.metricValue}>{value}</Text><Text style={styles.moduleDescription}>{label}</Text></View>; }

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    gap: 16,
    justifyContent: "center",
  },
  hero: {
    gap: 12,
    padding: 18,
    borderRadius: 0,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: colors.accent,
  },
  title: {
    fontSize: 34,
    lineHeight: 40,
    fontWeight: "800",
    color: colors.text,
  },
  panel: {
    gap: 16,
  },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  panelTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.text,
  },
  moduleList: {
    gap: 12,
  },
  moduleCard: {
    padding: 18,
    borderRadius: 0,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  selectedCard: { borderColor: colors.accent, borderWidth: 2 },
  moduleName: {
    fontSize: 17,
    fontWeight: "700",
    color: colors.text,
    marginBottom: 6,
  },
  moduleDescription: {
    fontSize: 14,
    lineHeight: 21,
    color: colors.muted,
  },
  empty: { color: colors.muted, fontSize: 15 },
  form: { gap: 10, padding: 14, borderRadius: 0, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  field: { gap: 5 },
  fieldLabel: { color: colors.text, fontSize: 13, fontWeight: "700" },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 0, paddingHorizontal: 12, paddingVertical: 10, color: colors.text, backgroundColor: colors.surface },
  button: { alignSelf: "flex-start", backgroundColor: colors.accent, borderRadius: 0, paddingHorizontal: 14, paddingVertical: 10 },
  buttonText: { color: colors.surface, fontWeight: "700" },
  sectionLabel: { color: colors.text, fontSize: 16, fontWeight: "700" },
  metrics: { flexDirection: "row", gap: 10 },
  metric: { flex: 1, backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 0, padding: 12 },
  metricValue: { color: colors.text, fontSize: 24, fontWeight: "800" },
  catalogList: { gap: 8 },
  catalogItem: { padding: 14, borderRadius: 0, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  layoutItem: { color: colors.muted, fontSize: 15 },
  validationHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  actionList: { gap: 8 },
  roomRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  roomRowCopy: { flex: 1 },
  deleteButton: { borderWidth: 1, borderColor: "#b42318", paddingHorizontal: 8, paddingVertical: 7 },
  deleteButtonText: { color: "#b42318", fontSize: 12, fontWeight: "800" },
  viewButton: { borderWidth: 1, borderColor: colors.accent, paddingHorizontal: 8, paddingVertical: 7 },
  viewButtonText: { color: colors.accent, fontSize: 12, fontWeight: "800" },
  helper: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { borderWidth: 1, borderColor: colors.border, paddingHorizontal: 8, paddingVertical: 6, backgroundColor: colors.surface },
  chipSelected: { borderColor: colors.accent, backgroundColor: colors.lightBlue },
  chipText: { color: colors.text, fontSize: 12, fontWeight: "700" },
  connectionFields: { gap: 8 },
  issueList: { gap: 8 },
  issue: { gap: 4, padding: 12, borderRadius: 12, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  errorLabel: { color: "#a02a1e", fontSize: 13, fontWeight: "800" },
  warningLabel: { color: "#9a6514", fontSize: 13, fontWeight: "800" },
  success: { color: "#2b6d3b", fontSize: 15, fontWeight: "700" },
  note: { padding: 10, borderRadius: 10, backgroundColor: colors.surface, gap: 4 },
  noteDate: { color: colors.muted, fontSize: 12 },
  photoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  photo: { width: 92, height: 92, borderRadius: 10, backgroundColor: colors.border },
});
