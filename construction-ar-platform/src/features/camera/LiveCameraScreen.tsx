import { CameraView, useCameraPermissions } from "expo-camera";
import { useRef, useState } from "react";
import { StyleSheet, Text, Pressable, View } from "react-native";

import { colors } from "../../theme/colors";

interface LiveCameraScreenProps {
  onClose: () => void;
  onPhotoCaptured: (uri: string) => void;
  onClearPlacements: () => void;
}

/** The project camera captures still site photos; live streaming remains a separate flow. */
export function LiveCameraScreen({ onClose, onPhotoCaptured, onClearPlacements }: LiveCameraScreenProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [isCapturing, setIsCapturing] = useState(false);

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
      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" />
      <View style={styles.overlay}>
        <View>
          <Text style={styles.overlayTitle}>Live device view</Text>
        </View>
        <View style={styles.overlayActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Capture project photo"
            style={[styles.captureButton, isCapturing && styles.disabledButton]}
            disabled={isCapturing}
            onPress={async () => {
              if (!cameraRef.current) return;
              setIsCapturing(true);
              try {
                const photo = await cameraRef.current.takePictureAsync({ quality: 0.8, skipProcessing: true });
                if (photo?.uri) onPhotoCaptured(photo.uri);
              } finally {
                setIsCapturing(false);
              }
            }}
          >
            <Text style={styles.captureButtonText}>{isCapturing ? "Saving…" : "Capture"}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Clear room placements" style={styles.resetButton} onPress={onClearPlacements}>
            <Text style={styles.resetButtonText}>Reset room</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Close live camera view" style={styles.closeButton} onPress={onClose}>
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
