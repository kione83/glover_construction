import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";

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
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.keyboardAvoidingView}
      >
        <ScrollView
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={styles.content}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.canvas}>
            <HomeScreen onOpenCamera={() => setActiveScreen("camera")} onOpenStream={() => setActiveScreen("stream")} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  keyboardAvoidingView: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    paddingBottom: 24,
  },
  canvas: {
    flex: 1,
    padding: 24,
  },
});
