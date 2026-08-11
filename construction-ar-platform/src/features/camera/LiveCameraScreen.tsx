import { CameraView, useCameraPermissions } from "expo-camera";
import { StyleSheet, Text, Pressable, View } from "react-native";

import { colors } from "../../theme/colors";

interface LiveCameraScreenProps {
  onClose: () => void;
}

/**
 * Deliberately preview-only: this milestone proves that the device camera can
 * be opened and rendered in the running application. It captures no media and
 * performs no AR, measurement, or streaming work.
 */
export function LiveCameraScreen({ onClose }: LiveCameraScreenProps) {
  const [permission, requestPermission] = useCameraPermissions();

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
      <CameraView style={StyleSheet.absoluteFill} facing="back" />
      <View style={styles.overlay}>
        <View>
          <Text style={styles.overlayTitle}>Live device view</Text>
          <Text style={styles.overlayCopy}>Rear iPhone camera · preview only</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Close live camera view" style={styles.closeButton} onPress={onClose}>
          <Text style={styles.closeButtonText}>Close</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#000" },
  centered: { flex: 1, justifyContent: "center", alignItems: "center", gap: 16, padding: 28, backgroundColor: colors.background },
  title: { color: colors.text, fontSize: 24, fontWeight: "800", textAlign: "center" },
  message: { color: colors.muted, fontSize: 16, lineHeight: 24, textAlign: "center" },
  overlay: { marginTop: 54, marginHorizontal: 20, padding: 16, borderRadius: 16, backgroundColor: "rgba(0, 0, 0, 0.55)", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16 },
  overlayTitle: { color: "#fff", fontSize: 18, fontWeight: "800" },
  overlayCopy: { color: "#e4e4e4", fontSize: 13, marginTop: 3 },
  primaryButton: { backgroundColor: colors.accent, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12 },
  primaryButtonText: { color: "#fff", fontWeight: "800" },
  secondaryButton: { paddingHorizontal: 16, paddingVertical: 12 },
  secondaryButtonText: { color: colors.accent, fontWeight: "800" },
  closeButton: { borderColor: "#fff", borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  closeButtonText: { color: "#fff", fontWeight: "800" },
});
