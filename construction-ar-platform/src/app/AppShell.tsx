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
import { MeasurementScreen } from "../features/measurement/MeasurementScreen";
import { RoomScanScreen } from "../features/roomScan/RoomScanScreen";
import { SavedRoomViewerScreen, type SavedRoomViewerMode } from "../features/roomViewer/SavedRoomViewerScreen";
import { colors } from "../theme/colors";

export function AppShell() {
  const [activeScreen, setActiveScreen] = useState<"workspace" | "camera" | "stream" | "measure" | "roomScan" | "roomViewer">("workspace");
  const [roomScanProjectId, setRoomScanProjectId] = useState<string>();
  const [viewerProjectId, setViewerProjectId] = useState<string>();
  const [viewerRoomId, setViewerRoomId] = useState<string>();
  const [viewerMode, setViewerMode] = useState<SavedRoomViewerMode>("project");
  const [initialPlacementCatalogObjectId, setInitialPlacementCatalogObjectId] = useState<string>();
  const [cameraPhotoHandler, setCameraPhotoHandler] = useState<(uri: string) => void>(() => () => undefined);
  const [clearPlacementsHandler, setClearPlacementsHandler] = useState<() => void>(() => () => undefined);
  const onPhotoCaptured = (uri: string) => {
    cameraPhotoHandler(uri);
    setActiveScreen("workspace");
  };

  if (activeScreen === "camera") {
    return <LiveCameraScreen onClose={() => setActiveScreen("workspace")} onPhotoCaptured={onPhotoCaptured} onClearPlacements={clearPlacementsHandler} />;
  }

  if (activeScreen === "stream") {
    return <LiveWebRtcPublisherScreen onClose={() => setActiveScreen("workspace")} onClearPlacements={clearPlacementsHandler} />;
  }

  if (activeScreen === "measure") {
    return (
      <MeasurementScreen
        initialCatalogObjectId={initialPlacementCatalogObjectId}
        onClose={() => setActiveScreen("workspace")}
      />
    );
  }

  if (activeScreen === "roomScan" && roomScanProjectId) {
    return <RoomScanScreen projectId={roomScanProjectId} onClose={() => setActiveScreen("workspace")} />;
  }

  if (activeScreen === "roomViewer" && viewerProjectId) {
    return <SavedRoomViewerScreen projectId={viewerProjectId} roomId={viewerRoomId} mode={viewerMode} onClose={() => setActiveScreen("workspace")} onOpenAlignment={(roomId) => { setViewerRoomId(roomId); setViewerMode("alignment"); }} />;
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
            <HomeScreen
              onOpenCamera={(photoHandler, onClearPlacements) => {
                setCameraPhotoHandler(() => photoHandler);
                setClearPlacementsHandler(() => onClearPlacements);
                setActiveScreen("camera");
              }}
              onOpenStream={(onClearPlacements) => {
                setClearPlacementsHandler(() => onClearPlacements);
                setActiveScreen("stream");
              }}
              onOpenMeasure={(catalogObjectId) => {
                setInitialPlacementCatalogObjectId(catalogObjectId);
                setActiveScreen("measure");
              }}
              onOpenRoomScan={(projectId) => {
                setRoomScanProjectId(projectId);
                setActiveScreen("roomScan");
              }}
              onOpenRoomViewer={(projectId, roomId, mode) => {
                setViewerProjectId(projectId);
                setViewerRoomId(roomId);
                setViewerMode(mode ?? "project");
                setActiveScreen("roomViewer");
              }}
            />
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
    padding: 24,
  },
  canvas: {
    flex: 1,
  },
});
