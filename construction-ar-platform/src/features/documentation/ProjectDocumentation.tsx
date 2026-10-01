import { useRef, useState } from "react";
import { ActivityIndicator, Alert, Image, NativeModules, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { Project, ProjectPhoto } from "../../domain/projects";
import { fieldNoteLocation, type FieldNoteInput } from "../../domain/fieldNotes";
import { colors } from "../../theme/colors";

export function ProjectDocumentation({ project, onSaveNote }: { project: Project; onSaveNote: (input: FieldNoteInput) => Promise<boolean> }) {
  const [text, setText] = useState("");
  const [roomId, setRoomId] = useState<string>();
  const [objectId, setObjectId] = useState<string>();
  const [query, setQuery] = useState("");
  const [noteLimit, setNoteLimit] = useState(10);
  const [photoLimit, setPhotoLimit] = useState(12);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [notice, setNotice] = useState("");
  const [openingPhoto, setOpeningPhoto] = useState<string>();
  const notes = project.fieldNotes.filter(note => `${note.text} ${fieldNoteLocation(project, note)}`.toLowerCase().includes(query.trim().toLowerCase()));
  const objects = project.placedObjects.filter(object => object.roomCaptureId === roomId && object.status === "active");
  async function saveNote() {
    if (saving.current) return;
    saving.current = true; setBusy(true); setNotice("");
    try {
      if (await onSaveNote({ text, roomCaptureId: roomId, placedObjectId: objectId })) {
        setText(""); setNotice("Note saved."); setQuery(""); setNoteLimit(10);
      } else setNotice("Note not saved. Your draft is retained; retry when storage is available.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Note not saved. Retry saving your draft."); }
    finally { saving.current = false; setBusy(false); }
  }
  async function openPhoto(photo: ProjectPhoto) {
    if (openingPhoto) return;
    setOpeningPhoto(photo.id);
    try {
      if (Platform.OS !== "ios" || !NativeModules.ProjectDocumentPreview?.openDocument) throw new Error("Photo preview requires the updated iOS app.");
      await NativeModules.ProjectDocumentPreview.openDocument(photo.uri, photo.caption || `Site photo · ${new Date(photo.capturedAt).toLocaleString()}`);
    } catch (error) { Alert.alert("Photo could not be opened", error instanceof Error ? error.message : "Retry opening this saved photo."); }
    finally { setOpeningPhoto(undefined); }
  }
  return <View style={styles.section}>
    <Text style={styles.title}>Field notes ({project.fieldNotes.length})</Text>
    <TextInput accessibilityLabel="Field note" placeholder="Document a site condition or decision" placeholderTextColor={colors.muted} value={text} onChangeText={setText} editable={!busy} multiline maxLength={5000} style={styles.input} />
    <Text style={styles.muted}>Attach note to</Text>
    <ScrollView horizontal contentContainerStyle={styles.row} keyboardShouldPersistTaps="handled">
      <Choice label="Project" selected={!roomId} disabled={busy} onPress={() => { setRoomId(undefined); setObjectId(undefined); }} />
      {project.roomCaptures.map(room => <Choice key={room.id} label={room.name} selected={room.id === roomId} disabled={busy} onPress={() => { setRoomId(room.id); setObjectId(undefined); }} />)}
    </ScrollView>
    {roomId && <ScrollView horizontal contentContainerStyle={styles.row} keyboardShouldPersistTaps="handled">
      <Choice label="Whole room" selected={!objectId} disabled={busy} onPress={() => setObjectId(undefined)} />
      {objects.map(object => <Choice key={object.id} label={object.displayName} selected={object.id === objectId} disabled={busy} onPress={() => setObjectId(object.id)} />)}
    </ScrollView>}
    <Choice label={busy ? "Saving note…" : "Save note"} disabled={busy || !text.trim()} onPress={() => void saveNote()} />
    {!!notice && <Text style={styles.copy} accessibilityLiveRegion="polite">{notice}</Text>}
    <TextInput accessibilityLabel="Search field notes" placeholder="Search notes or locations" placeholderTextColor={colors.muted} value={query} onChangeText={value => { setQuery(value); setNoteLimit(10); }} style={styles.search} />
    <Text style={styles.muted}>Showing {Math.min(noteLimit, notes.length)} of {notes.length} notes</Text>
    {notes.length === 0 ? <Text style={styles.muted}>{project.fieldNotes.length ? "No notes match this search." : "No field notes yet."}</Text> : notes.slice(0, noteLimit).map(note => <View key={note.id} style={styles.note}>
      <Text style={styles.copy}>{note.text}</Text><Text style={styles.muted}>{fieldNoteLocation(project, note)} · {new Date(note.createdAt).toLocaleString()}</Text>
    </View>)}
    {notes.length > noteLimit && <Choice label="Show more notes" onPress={() => setNoteLimit(value => value + 10)} />}
    <Text style={styles.title}>Site photos ({project.photos.length})</Text>
    <Text style={styles.muted}>Open a photo to inspect it at full size and zoom.</Text>
    {project.photos.length === 0 ? <Text style={styles.muted}>No site photos yet. Use Capture photo to document this project.</Text> : <View style={styles.photoGrid}>{project.photos.slice(0, photoLimit).map(photo => <Pressable key={photo.id} accessibilityRole="button" accessibilityLabel={`Open site photo ${new Date(photo.capturedAt).toLocaleString()}`} disabled={!!openingPhoto} onPress={() => void openPhoto(photo)} style={styles.photoItem}>
      <Image source={{ uri: photo.uri }} style={styles.photo} accessibilityLabel={photo.caption || "Project site photo"} />
      <Text style={styles.muted}>{photo.caption || new Date(photo.capturedAt).toLocaleDateString()}</Text>
      {openingPhoto === photo.id && <ActivityIndicator color={colors.accent} />}
    </Pressable>)}</View>}
    {project.photos.length > photoLimit && <Choice label="Show more photos" onPress={() => setPhotoLimit(value => value + 12)} />}
  </View>;
}
function Choice({ label, selected, disabled, onPress }: { label: string; selected?: boolean; disabled?: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected, disabled }} disabled={disabled} onPress={onPress} style={[styles.button, selected && styles.selected, disabled && { opacity: 0.5 }]}><Text style={styles.copy}>{label}</Text></Pressable>;
}
const styles = StyleSheet.create({
  section: { gap: 12, padding: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  title: { color: colors.text, fontSize: 17, fontWeight: "700" }, copy: { color: colors.text, fontSize: 14 }, muted: { color: colors.muted, fontSize: 12 },
  input: { minHeight: 90, borderWidth: 1, borderColor: colors.border, padding: 12, color: colors.text, textAlignVertical: "top" },
  search: { borderWidth: 1, borderColor: colors.border, padding: 12, color: colors.text },
  row: { gap: 8 }, button: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, padding: 12 }, selected: { borderColor: colors.accent, borderWidth: 2 },
  note: { gap: 6, borderBottomWidth: 1, borderColor: colors.border, paddingBottom: 12 },
  photoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 }, photoItem: { width: 128, gap: 4 }, photo: { width: 128, height: 100, backgroundColor: colors.card },
});
