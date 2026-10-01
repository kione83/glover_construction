import { CameraView, useCameraPermissions } from "expo-camera";
import { useRef, useState } from "react";
import { Alert, Image, StyleSheet, Text, Pressable, View } from "react-native";

import { colors } from "../../theme/colors";

interface LiveCameraScreenProps {
  onClose: () => void;
  onPhotoCaptured: (uri: string) => Promise<void>;
  onClearPlacements: () => void;
}

/** The project camera captures still site photos; live streaming remains a separate flow. */
export function LiveCameraScreen({ onClose, onPhotoCaptured, onClearPlacements }: LiveCameraScreenProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [pendingPhotoUri, setPendingPhotoUri] = useState<string>();
  const [captureError, setCaptureError] = useState<string>();
  const busy = useRef(false);

  function closeCamera() {
    if (busy.current) return;
    if (pendingPhotoUri) {
      Alert.alert("Photo has not been saved", "Retry saving to keep this photo in the project, or discard this unsaved capture.", [
        { text: "Keep photo", style: "cancel" }, { text: "Discard capture", style: "destructive", onPress: onClose },
      ]);
    } else onClose();
  }

  async function captureOrRetry() {
    if (busy.current || (!pendingPhotoUri && !cameraRef.current)) return;
    busy.current = true; setIsCapturing(true); setCaptureError(undefined);
    try {
      const uri = pendingPhotoUri ?? (await cameraRef.current!.takePictureAsync({ quality: 0.8, skipProcessing: true }))?.uri;
      if (!uri) throw new Error("The camera did not return a photo. Please retry capture.");
      setPendingPhotoUri(uri);
      await onPhotoCaptured(uri);
      setPendingPhotoUri(undefined);
    } catch (error) {
      setCaptureError(error instanceof Error ? error.message : "The photo could not be saved. Retry saving before closing.");
    } finally { busy.current = false; setIsCapturing(false); }
  }

  if (!permission) {
    return <View style={styles.centered}><Text style={styles.message}>Preparing camera…</Text></View>;
  }

  if (!permission.granted) {
    return (
      <View style={styles.centered}>
        <Text style={styles.title}>Camera access is needed</Text>
        <Text style={styles.message}>Allow camera access to view the live feed from this iPhone.</Text>
        <Pressable style={styles.primaryButton} onPress={() => void requestPermission()}>
          <Text style={styles.primaryButtonText}>Allow camera</Text>
        </Pressable>
        <Pressable style={styles.secondaryButton} onPress={onClose}>
          <Text style={styles.secondaryButtonText}>Back to project</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {pendingPhotoUri ? <Image source={{ uri: pendingPhotoUri }} style={StyleSheet.absoluteFill} resizeMode="contain" accessibilityLabel="Unsaved captured photo" /> : <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" />}
      <View style={styles.overlay}>
        <View>
          <Text style={styles.overlayTitle}>{pendingPhotoUri ? "Captured site photo" : "Live device view"}</Text>
          {captureError && <Text style={styles.captureError} accessibilityLiveRegion="polite">{captureError}{pendingPhotoUri ? " Your captured photo stays here for retry." : ""}</Text>}
        </View>
        <View style={styles.overlayActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Capture project photo"
            style={[styles.captureButton, isCapturing && styles.disabledButton]}
            disabled={isCapturing}
            onPress={() => void captureOrRetry()}
          >
            <Text style={styles.captureButtonText}>{isCapturing ? "Saving…" : pendingPhotoUri ? "Retry saving photo" : "Capture"}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Clear room placements" style={styles.resetButton} disabled={isCapturing || !!pendingPhotoUri} onPress={onClearPlacements}>
            <Text style={styles.resetButtonText}>Reset room</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Close live camera view" style={styles.closeButton} disabled={isCapturing} onPress={closeCamera}>
            <Text style={styles.closeButtonText}>Close</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#000" },
  centered: { flex: 1, justifyContent: "center", alignItems: "center", gap: 16, padding: 28, backgroundColor: colors.background },
  title: { color: colors.text, fontSize: 24, fontWeight: "800", textAlign: "center" },
  message: { color: colors.muted, fontSize: 16, lineHeight: 24, textAlign: "center" },
  overlay: { marginTop: 54, marginHorizontal: 20, padding: 12, borderRadius: 0, backgroundColor: "rgba(11, 35, 65, 0.88)", gap: 10 },
  captureError: { color: "#fff", fontSize: 13, marginTop: 8 },
  overlayTitle: { color: "#fff", fontSize: 18, fontWeight: "800" },
  overlayActions: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", flexWrap: "wrap", gap: 8 },
  primaryButton: { backgroundColor: colors.accent, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12 },
  primaryButtonText: { color: "#fff", fontWeight: "800" },
  secondaryButton: { paddingHorizontal: 16, paddingVertical: 12 },
  secondaryButtonText: { color: colors.accent, fontWeight: "800" },
  closeButton: { borderColor: "#fff", borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  closeButtonText: { color: "#fff", fontWeight: "800" },
  captureButton: { backgroundColor: colors.accent, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  captureButtonText: { color: "#fff", fontWeight: "800" },
  resetButton: { borderColor: "#fff", borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  resetButtonText: { color: "#fff", fontWeight: "800", fontSize: 12 },
  disabledButton: { opacity: 0.6 },
});
