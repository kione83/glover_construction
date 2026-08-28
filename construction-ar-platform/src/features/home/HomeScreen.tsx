import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { starterCatalog } from "../../domain/catalog";
import type { CatalogObject, Project, RoomCapture } from "../../domain/projects";
import { defaultValidationRules } from "../../domain/validation";
import { validateProject } from "../../domain/validationService";
import { createEmptyProjectDocument, updateProjectSummary } from "../../storage/projectDocument";
import {
  loadProjectDocuments,
  replaceProject,
  saveProjectDocuments,
} from "../../storage/projectRepository";
import { colors } from "../../theme/colors";

interface HomeScreenProps {
  onOpenCamera: () => void;
  onOpenStream: () => void;
  onOpenMeasure: (catalogObjectId?: string) => void;
}

export function HomeScreen({ onOpenCamera, onOpenStream, onOpenMeasure }: HomeScreenProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>();
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [clientName, setClientName] = useState("");
  const [siteName, setSiteName] = useState("");
  const [roomName, setRoomName] = useState("");
  const [selectedCatalogObjectId, setSelectedCatalogObjectId] = useState<string>();

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
        ...project,
        status: "scanned",
        roomCaptures: [...project.roomCaptures, room],
      }),
    );
    setRoomName("");
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

  if (isLoading) {
    return <ActivityIndicator color={colors.accent} size="large" />;
  }

  return (
    <View style={styles.screen}>
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>Construction AR Platform</Text>
        <Text style={styles.title}>Project workspace</Text>
        <Text style={styles.copy}>
          Start a project, add its rooms, then place catalog items for a
          reviewable preliminary layout.
        </Text>
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

      {selectedProject && <ProjectDashboard project={selectedProject} roomName={roomName} onRoomNameChange={setRoomName} onAddRoom={() => void addManualRoom()} selectedCatalogObjectId={selectedCatalogObjectId} onSelectCatalogObject={setSelectedCatalogObjectId} onPlaceObject={(item: any) => void placeCatalogObject(item)} onRunValidation={() => void runValidation()} onOpenCamera={onOpenCamera} onOpenStream={onOpenStream} onOpenMeasure={onOpenMeasure} />}
    </View>
  );
}

function ProjectDashboard({ project, roomName, onRoomNameChange, onAddRoom, selectedCatalogObjectId, onSelectCatalogObject, onPlaceObject, onRunValidation, onOpenCamera, onOpenStream, onOpenMeasure }: any) {
  const selectedCatalogObject = starterCatalog.find((item) => item.id === selectedCatalogObjectId);
  return <View style={styles.panel}>
    <Text style={styles.panelTitle}>{project.name}</Text>
    <View style={styles.metrics}><Metric label="Rooms" value={project.summary.roomCount} /><Metric label="Placed" value={project.summary.placedObjectCount} /><Metric label="Issues" value={project.summary.validationIssueCount} /></View>
    <View style={styles.liveViewCallout}><View style={styles.liveViewCopy}><Text style={styles.sectionLabel}>Live device view</Text><Text style={styles.moduleDescription}>Open the iPhone’s rear camera inside this project workspace.</Text></View><Button label="Open camera" onPress={onOpenCamera} /></View>
      <View style={styles.liveViewCallout}><View style={styles.liveViewCopy}><Text style={styles.sectionLabel}>Laptop live view</Text><Text style={styles.moduleDescription}>Publish the rear camera to the local WebRTC viewer.</Text></View><Button label="Stream to laptop" onPress={onOpenStream} /></View>
      <View style={styles.liveViewCallout}><View style={styles.liveViewCopy}><Text style={styles.sectionLabel}>AR measure + place</Text><Text style={styles.moduleDescription}>Measure, place scaled catalog items, and keep the laptop stream available in one field workflow.</Text></View><Button label="Open AR tools" onPress={onOpenMeasure} /></View>
    <View style={styles.form}><Text style={styles.sectionLabel}>Manual room</Text><Field label="Room name" value={roomName} onChangeText={onRoomNameChange} /><Button label="Add room" onPress={onAddRoom} /></View>
    <Text style={styles.sectionLabel}>Catalog</Text>
    <View style={styles.catalogList}>{starterCatalog.map((item: any) => <Pressable key={item.id} onPress={() => onSelectCatalogObject(item.id)} style={[styles.catalogItem, item.id === selectedCatalogObjectId && styles.selectedCard]}><Text style={styles.moduleName}>{item.name}</Text><Text style={styles.moduleDescription}>{item.category} · {item.placementMode}</Text></Pressable>)}</View>
    {selectedCatalogObject && <Button label={`Open AR placement for ${selectedCatalogObject.name}`} onPress={() => onOpenMeasure(selectedCatalogObject.id)} />}
    {project.placedObjects.length > 0 && <><Text style={styles.sectionLabel}>Current layout</Text>{project.placedObjects.filter((item: any) => item.status === "active").map((item: any) => <Text key={item.id} style={styles.layoutItem}>{item.displayName}</Text>)}</>}
    <View style={styles.validationHeader}><Text style={styles.sectionLabel}>Validation</Text><Button label="Run validation" onPress={onRunValidation} /></View>
    <ValidationResults project={project} />
  </View>;
}

function ValidationResults({ project }: { project: Project }) {
  if (!project.summary.lastValidatedAt) return <Text style={styles.empty}>Run validation to review this layout.</Text>;
  if (project.validationIssues.length === 0) return <Text style={styles.success}>No validation issues found.</Text>;
  const errors = project.validationIssues.filter((item: any) => item.severity === "error");
  const warnings = project.validationIssues.filter((item: any) => item.severity === "warning");
  return <View style={styles.issueList}>{errors.length > 0 && <Text style={styles.errorLabel}>Errors ({errors.length})</Text>}{warnings.length > 0 && <Text style={styles.warningLabel}>Warnings ({warnings.length})</Text>}{project.validationIssues.map((item: any) => <View key={item.id} style={styles.issue}><Text style={item.severity === "error" ? styles.errorLabel : styles.warningLabel}>{item.severity.toUpperCase()} · {defaultValidationRules.find((rule) => rule.id === item.ruleId)?.name ?? item.ruleId}</Text><Text style={styles.moduleDescription}>{item.message}</Text></View>)}</View>;
}

function Field({ label, value, onChangeText }: { label: string; value: string; onChangeText: (value: string) => void }) { return <View style={styles.field}><Text style={styles.fieldLabel}>{label}</Text><TextInput value={value} onChangeText={onChangeText} placeholder={label} placeholderTextColor={colors.muted} style={styles.input} /></View>; }
function Button({ label, onPress }: { label: string; onPress: () => void }) { return <Pressable onPress={onPress} style={styles.button}><Text style={styles.buttonText}>{label}</Text></Pressable>; }
function Metric({ label, value }: { label: string; value: number }) { return <View style={styles.metric}><Text style={styles.metricValue}>{value}</Text><Text style={styles.moduleDescription}>{label}</Text></View>; }

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    gap: 24,
    justifyContent: "center",
  },
  hero: {
    gap: 12,
    padding: 24,
    borderRadius: 28,
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
  copy: {
    fontSize: 16,
    lineHeight: 24,
    color: colors.muted,
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
    borderRadius: 22,
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
  form: { gap: 10, padding: 16, borderRadius: 18, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  field: { gap: 5 },
  fieldLabel: { color: colors.text, fontSize: 13, fontWeight: "700" },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: colors.text, backgroundColor: colors.surface },
  button: { alignSelf: "flex-start", backgroundColor: colors.accent, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  buttonText: { color: colors.surface, fontWeight: "700" },
  sectionLabel: { color: colors.text, fontSize: 16, fontWeight: "700" },
  metrics: { flexDirection: "row", gap: 10 },
  metric: { flex: 1, backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 14, padding: 12 },
  metricValue: { color: colors.text, fontSize: 24, fontWeight: "800" },
  catalogList: { gap: 8 },
  catalogItem: { padding: 14, borderRadius: 16, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  layoutItem: { color: colors.muted, fontSize: 15 },
  validationHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  liveViewCallout: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, padding: 16, borderRadius: 18, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  liveViewCopy: { flex: 1, gap: 4 },
  issueList: { gap: 8 },
  issue: { gap: 4, padding: 12, borderRadius: 12, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  errorLabel: { color: "#a02a1e", fontSize: 13, fontWeight: "800" },
  warningLabel: { color: "#9a6514", fontSize: 13, fontWeight: "800" },
  success: { color: "#2b6d3b", fontSize: 15, fontWeight: "700" },
});
