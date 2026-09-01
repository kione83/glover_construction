import type { NativeSyntheticEvent, StyleProp, ViewStyle } from "react-native";
import { Platform, UIManager, View, requireNativeComponent } from "react-native";

export interface SceneSelectionEvent {
  roomId?: string;
  featureId?: string;
  kind: "room" | "feature" | "background";
}

export interface RoomTransformChangeEvent {
  roomId: string;
  transform: {
    position: { x: number; y: number; z: number };
    rotation: { pitch: number; yaw: number; roll: number };
    scale: { x: number; y: number; z: number };
  };
}

interface NativeSavedRoom3DViewProps {
  style?: StyleProp<ViewStyle>;
  modelJSON: string;
  selectedRoomId?: string;
  selectedFeatureIdsJSON: string;
  editingRoomId?: string;
  allowDirectManipulation: boolean;
  showMeasurements: boolean;
  resetRequestId: number;
  onSceneSelection?: (event: NativeSyntheticEvent<SceneSelectionEvent>) => void;
  onRoomTransformChange?: (event: NativeSyntheticEvent<RoomTransformChangeEvent>) => void;
}

const nativeViewName = "SavedRoom3DView";
const nativeViewAvailable =
  Platform.OS === "ios" && UIManager.getViewManagerConfig(nativeViewName) != null;
const NativeView = nativeViewAvailable
  ? requireNativeComponent<NativeSavedRoom3DViewProps>(nativeViewName)
  : null;

export const savedRoom3DViewAvailable = nativeViewAvailable;

export function NativeSavedRoom3DView(props: NativeSavedRoom3DViewProps) {
  if (!NativeView) return <View style={props.style} />;
  return <NativeView {...props} />;
}
