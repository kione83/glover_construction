import { useState } from "react";
import { SafeAreaView, ScrollView, StyleSheet, View } from "react-native";

import { LiveCameraScreen } from "../features/camera/LiveCameraScreen";
import { LiveWebRtcPublisherScreen } from "../features/camera/LiveWebRtcPublisherScreen";
import { HomeScreen } from "../features/home/HomeScreen";
import { colors } from "../theme/colors";

export function AppShell() {
  const [activeScreen, setActiveScreen] = useState<"workspace" | "camera" | "stream">("workspace");

  if (activeScreen === "camera") {
    return <LiveCameraScreen onClose={() => setActiveScreen("workspace")} />;
  }
  if (activeScreen === "stream") {
    return <LiveWebRtcPublisherScreen onClose={() => setActiveScreen("workspace")} />;
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.canvas}>
          <HomeScreen onOpenCamera={() => setActiveScreen("camera")} onOpenStream={() => setActiveScreen("stream")} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flexGrow: 1,
  },
  canvas: {
    flex: 1,
    padding: 24,
  },
});
