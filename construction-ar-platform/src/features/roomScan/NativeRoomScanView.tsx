import type { NativeSyntheticEvent, StyleProp, ViewStyle } from "react-native";
import { Platform, UIManager, View, requireNativeComponent } from "react-native";

export interface NativeRoomScanUpdate {
  kind: "session-started" | "progress" | "scan-completed" | "scan-failed" | "session-unsupported";
  message: string;
  progress?: number;
  measurements?: NativeRoomScanMeasurement[];
  scan?: {
    source: "roomplan";
    capturedAt: string;
    nativeIdentifier: string;
    floorFootprint?: { width: number; height: number; depth: number; unit: "m" };
    ceilingHeight?: number;
    elements: Array<{
      id: string;
      wallId?: string;
      kind: "wall" | "floor" | "ceiling" | "door" | "window" | "opening" | "built-in" | "furniture" | "fixture";
      category: string;
      representation: string;
      dimensions: { width: number; height: number; depth: number; unit: "m" };
      transform: {
        position: { x: number; y: number; z: number };
        rotation: { pitch: number; yaw: number; roll: number };
        scale: { x: number; y: number; z: number };
      };
      confidence?: number;
      polygonCorners?: Array<{ x: number; y: number; z: number }>;
    }>;
      measurements?: NativeRoomScanMeasurement[];
      nativeCapturedRoomJSON?: string;
      arkitMesh?: {
        format: "arkit-mesh-v1";
        capturedAt: string;
        anchors: Array<{
          id: string;
          transform: { position: { x: number; y: number; z: number }; rotation: { pitch: number; yaw: number; roll: number }; scale: { x: number; y: number; z: number } };
          vertices: Array<{ x: number; y: number; z: number }>;
          indices: number[];
          classification?: string;
          bounds?: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } };
          floorElevation?: number;
          ceilingElevation?: number;
        }>;
        limitation?: string;
      };
    };
}

export interface NativeRoomScanMeasurement {
  id: string;
  elementId: string;
  wallId?: string;
  category: string;
  dimension: "width" | "height" | "depth";
  label: string;
  value: number;
  unit: "m";
  status: "estimated" | "estimating" | "stable" | "limited";
  initialEstimate: number;
  updatedAt: string;
  updateCount: number;
  observationCount: number;
  confidence?: number;
  confidenceSource?: "native" | "derived";
  source: "roomplan" | "derived";
  quality?: "estimating" | "stable" | "limited";
  rawValue?: number;
  valueSource?: "roomplan" | "floor-ceiling" | "arkit-mesh";
  history: Array<{ timestamp: string; value: number; rawValue?: number; confidence?: number; confidenceSource?: "native" | "derived"; quality?: "estimating" | "stable" | "limited"; valueSource?: "roomplan" | "floor-ceiling" | "arkit-mesh"; observationCount: number }>;
}

interface NativeRoomScanViewProps {
  style?: StyleProp<ViewStyle>;
  startRequestId: number;
  finishRequestId: number;
  showMeasurements: boolean;
  onRoomScanUpdate?: (event: NativeSyntheticEvent<NativeRoomScanUpdate>) => void;
}

const nativeViewName = "RoomScanView";
const nativeViewAvailable =
  Platform.OS === "ios" && UIManager.getViewManagerConfig(nativeViewName) != null;
const NativeRoomScan = nativeViewAvailable
  ? requireNativeComponent<NativeRoomScanViewProps>(nativeViewName)
  : null;

export const roomScanAvailable = nativeViewAvailable;

export function NativeRoomScanView(props: NativeRoomScanViewProps) {
  if (!NativeRoomScan) {
    return <View style={props.style} />;
  }

  return <NativeRoomScan {...props} />;
}
