import type { NativeSyntheticEvent, StyleProp, ViewStyle } from "react-native";

import { Platform, UIManager, View, requireNativeComponent } from "react-native";

export type NativeMeasurementPointSource =
  | "scene-depth"
  | "existing-plane-geometry"
  | "existing-plane-infinite"
  | "estimated-plane"
  | "feature-point"
  | "manual-debug"
  | "unresolved";

export type NativeMeasurementReticleState = "green" | "yellow" | "red";

export interface NativeMeasurementTrackingSnapshot {
  quality: "normal" | "limited" | "not-available";
  reason?: string;
  localizedState?: string;
}

export interface NativeMeasurementPoint {
  x: number;
  y: number;
  z: number;
}

export interface NativeMeasurementResolutionDiagnostics {
  sampleCountCollected?: number;
  acceptedSampleCount?: number;
  rejectedSampleCount?: number;
  maximumDeviationMeters?: number;
  medianDeviationMeters?: number;
  highConfidenceDepthSampleCount?: number;
  sampleWindowSeconds?: number;
  depthConfidence?: number;
  depthMeters?: number;
  sourceCounts?: Partial<Record<NativeMeasurementPointSource, number>>;
  reticleState?: NativeMeasurementReticleState;
}

export interface NativeMeasurementResolution {
  source: NativeMeasurementPointSource;
  planeAlignment?: "horizontal" | "vertical" | "slanted" | "unknown";
  usedFallback?: boolean;
  tracking: NativeMeasurementTrackingSnapshot;
  capturedAt: string;
  resolutionDiagnostics?: NativeMeasurementResolutionDiagnostics;
}

export interface NativeMeasurementSnapshot {
  startPoint?: NativeMeasurementPoint;
  endPoint?: NativeMeasurementPoint;
  rawDistanceMeters?: number;
  startResolution?: NativeMeasurementResolution;
  endResolution?: NativeMeasurementResolution;
}

export interface NativeMeasurementReticleSnapshot {
  state: NativeMeasurementReticleState;
  message: string;
  tracking: NativeMeasurementTrackingSnapshot;
  point?: NativeMeasurementPoint;
  source?: NativeMeasurementPointSource;
  planeAlignment?: "horizontal" | "vertical" | "slanted" | "unknown";
  usedFallback?: boolean;
}

export interface NativeMeasurementAction {
  kind:
    | "session-started"
    | "session-unsupported"
    | "tracking-updated"
    | "point-set"
    | "measurement-cleared"
    | "capture-failed"
    | "object-placed"
    | "object-updated"
    | "object-removed"
    | "placement-failed";
  pointRole?: "start" | "end";
  message: string;
}

export interface NativeMeasurementUpdatePayload {
  measurement?: NativeMeasurementSnapshot;
  reticle?: NativeMeasurementReticleSnapshot;
  tracking?: NativeMeasurementTrackingSnapshot;
  placement?: NativePlacementEvent;
  lastAction: NativeMeasurementAction;
}

export interface NativePlacementDimensions {
  width: number;
  height: number;
  depth: number;
}

export interface NativePlacementRequest {
  requestId: number;
  catalogObjectId: string;
  displayName: string;
  placementMode: string;
  dimensions: NativePlacementDimensions;
}

export interface NativePlacedObjectSnapshot {
  id: string;
  catalogObjectId: string;
  displayName: string;
  placementMode: string;
  dimensions: NativePlacementDimensions;
  position: NativeMeasurementPoint;
  rotationY: number;
}

export interface NativePlacementEditRequest {
  requestId: number;
  objectId: string;
  action: "rotate-left" | "rotate-right" | "remove";
}

export interface NativePlacementEvent {
  kind: "object-placed" | "object-updated" | "object-removed" | "placement-failed";
  message: string;
  object?: NativePlacedObjectSnapshot;
  objectId?: string;
}

interface NativeMeasurementARViewProps {
  style?: StyleProp<ViewStyle>;
  resetCounter: number;
  captureRequestId: number;
  capturePointRole: "start" | "end";
  placementRequest?: NativePlacementRequest | null;
  placedObjects?: NativePlacedObjectSnapshot[];
  selectedPlacedObjectId?: string;
  placementEditRequest?: NativePlacementEditRequest | null;
  onMeasurementUpdate?: (event: NativeSyntheticEvent<NativeMeasurementUpdatePayload>) => void;
}

const nativeViewName = "MeasurementARView";
const nativeViewAvailable =
  Platform.OS === "ios" && UIManager.getViewManagerConfig(nativeViewName) != null;
const NativeMeasurementView =
  nativeViewAvailable
    ? requireNativeComponent<NativeMeasurementARViewProps>(nativeViewName)
    : null;

export const measurementARViewAvailable = nativeViewAvailable;

export function NativeMeasurementARView(props: NativeMeasurementARViewProps) {
  if (!NativeMeasurementView) {
    return <View style={props.style} />;
  }

  return <NativeMeasurementView {...props} />;
}
