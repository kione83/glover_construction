export type LengthUnit = "in" | "ft" | "mm" | "cm" | "m";

export type SurfaceKind = "wall" | "floor" | "ceiling" | "opening" | "unknown";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface RotationEuler {
  pitch: number;
  yaw: number;
  roll: number;
}

export interface Dimensions3D {
  width: number;
  height: number;
  depth: number;
  unit: LengthUnit;
}

export interface BoundingBox3D {
  center: Vec3;
  size: Dimensions3D;
}

export interface Transform3D {
  position: Vec3;
  rotation: RotationEuler;
  scale: Vec3;
}

export interface SurfaceReference {
  surfaceId: string;
  kind: SurfaceKind;
  normal?: Vec3;
}
