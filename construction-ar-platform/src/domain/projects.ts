import type {
  BoundingBox3D,
  Dimensions3D,
  LengthUnit,
  SurfaceKind,
  SurfaceReference,
  Transform3D,
  Vec3,
} from "./spatial";

export type ProjectStatus = "draft" | "scanned" | "layout-in-progress" | "validated" | "archived";

export type CaptureStatus = "not-started" | "in-progress" | "completed" | "failed";

export type ObjectCategory =
  | "electrical"
  | "hvac"
  | "low-voltage"
  | "life-safety"
  | "plumbing"
  | "architectural"
  | "general";

export type PlacementMode = "wall-mounted" | "floor-mounted" | "ceiling-mounted" | "free-place";

export type ValidationSeverity = "info" | "warning" | "error";

export type ValidationRuleType =
  | "attachment"
  | "collision"
  | "clearance"
  | "boundary"
  | "metadata";

export interface ProjectTimestamps {
  createdAt: string;
  updatedAt: string;
  lastOpenedAt?: string;
}

export interface Surface {
  id: string;
  kind: SurfaceKind;
  label: string;
  dimensions?: Dimensions3D;
  centerPoint?: Vec3;
  bounds?: BoundingBox3D;
  confidence?: number;
}

export interface RoomCapture {
  id: string;
  name: string;
  status: CaptureStatus;
  source: "roomplan" | "arkit" | "manual" | "unknown";
  unit: LengthUnit;
  bounds?: BoundingBox3D;
  measuredDimensions?: Dimensions3D;
  surfaces: Surface[];
  notes?: string;
  capturedAt?: string;
}

export interface CatalogObject {
  id: string;
  sku: string;
  name: string;
  category: ObjectCategory;
  placementMode: PlacementMode;
  defaultDimensions: Dimensions3D;
  defaultClearance?: Dimensions3D;
  allowedSurfaceKinds: SurfaceKind[];
  tags: string[];
  description?: string;
}

export interface PlacementAnchor {
  id: string;
  roomCaptureId: string;
  reference: SurfaceReference;
  transform: Transform3D;
}

export interface PlacedObject {
  id: string;
  catalogObjectId: string;
  roomCaptureId: string;
  anchorId: string;
  displayName: string;
  transform: Transform3D;
  dimensions: Dimensions3D;
  status: "active" | "deleted";
  placedAt: string;
  updatedAt: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface ValidationRule {
  id: string;
  type: ValidationRuleType;
  name: string;
  description: string;
  severity: ValidationSeverity;
  appliesToCategories: ObjectCategory[];
}

export interface ValidationIssue {
  id: string;
  ruleId: string;
  severity: ValidationSeverity;
  message: string;
  objectId?: string;
  surfaceId?: string;
  detectedAt: string;
}

export interface ProjectSummary {
  roomCount: number;
  placedObjectCount: number;
  validationIssueCount: number;
  lastValidatedAt?: string;
}

export interface Project {
  id: string;
  name: string;
  clientName?: string;
  siteName?: string;
  address?: string;
  status: ProjectStatus;
  targetDevice: "iphone" | "ipad" | "vision-pro" | "unknown";
  timestamps: ProjectTimestamps;
  roomCaptures: RoomCapture[];
  anchors: PlacementAnchor[];
  placedObjects: PlacedObject[];
  validationIssues: ValidationIssue[];
  summary: ProjectSummary;
}
