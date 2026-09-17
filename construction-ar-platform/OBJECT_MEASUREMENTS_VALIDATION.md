Object dimensions and grouping — 2026-09-14

1. Files changed for this implementation

   - `src/domain/projects.ts`: additive scan metadata interfaces and instance references.
   - `src/domain/scannedObjects.ts`: measurement derivation, grouping, normalization, formatting.
   - `src/domain/measurementUnits.ts`: metric length/area/volume conversion and formatting.
   - `src/domain/scannedObjects.test.ts`: focused domain, migration and formatting tests.
   - `src/storage/projectDocument.ts`: schema 7 and legacy normalization.
   - `src/storage/projectDocument.test.ts`: schema expectations.
   - `src/storage/projectRepository.ts`: normalize on save and full archive hydration.
   - `src/storage/projectRepository.test.ts`: archive/index persistence and legacy archive tests.
   - `src/features/roomScan/RoomScanScreen.tsx`: normalize completed scans; explicit live dimensions and derived values; unit selection; saved object details.
   - `src/features/roomScan/ObjectMeasurementsPanel.tsx`: grouped quantities and per-instance details in m/ft/in.
   - `src/features/roomViewer/SavedRoomViewerScreen.tsx`: object details and instance selection within existing measurement controls.
   - `ios/ConstructionARPlatform/RoomScanView.swift`: explicit W/D/H live labels.
   - `ios/ConstructionARPlatform/SavedRoom3DView.swift`: W/D/H labels from each object's captured geometry.
   - `tools/test-room-transforms.py`: native four-instance preservation and live/saved dimension-label assertions.
   - `tools/live-viewer.html`: label all object dimensions explicitly, including missing values.
   - `OBJECT_MEASUREMENTS_VALIDATION.md`: this report.

   Several files already had uncommitted changes before this task. Those changes were preserved; this list describes only this implementation's additions.

2. Data model

   Project schema is now 7. `RoomScanData` optionally contains `objectMetadataVersion: 1` and `objectTypes`. Each type stores its room ID, category, kind, representation, representative instance ID, quantity, nullable metric W/D/H, per-axis confidence status, footprint area, face area and bounding volume. The existing `elements` array remains the instance/geometry authority. Object elements gain `roomCaptureId` and `objectTypeId` references.

3. How W/D/H are determined

   Existing RoomPlan serialization maps object-local X to width, Z to depth, and Y to height. Metadata uses those captured dimensions, converted to meters when a legacy record specifies another supported unit. It never derives dimensions from camera orientation, project bounds, object rotation, or assembly position. Geometry is not replaced by smoothed measurement history. Missing/nonpositive/nonfinite extents or unknown units become null in the new metadata; raw geometry remains untouched.

4. Formulas and measurement quality

   `footprintArea = width * depth` (m²); `faceArea = width * height` (m²); `boundingVolume = width * depth * height` (m³). Each product requires all its axes to be available and sufficiently confident. The threshold is 0.6, matching the current native limited-quality boundary (RoomPlan low=.4, medium=.7, high=.95). Explicit limited evidence overrides a positive confidence. Missing confidence without usable supporting evidence leaves derived values null. Raw positive lengths remain visible with limited/unknown confidence labeling.

5. Grouping

   Group furniture, built-ins and fixtures within one room when category, kind and representation match and every local axis passes the dimensional comparison. Unknown categories, missing dimensions, and insufficient-confidence objects remain separate. Candidate IDs are sorted for deterministic results. Every candidate is checked against every member, preventing tolerance-chain merges. The first candidate supplies representative metadata; dimensions are not averaged. Quantity is recomputed from actual member instances, never trusted from stale saved counts.

6. Tolerance

   `OBJECT_GROUP_TOLERANCE` in `scannedObjects.ts` defines 0.02 meters and 3%. Both limits must hold on each axis: difference <= min(0.02 m, 0.03 * smaller dimension). A 1e-9 m arithmetic epsilon handles floating-point boundaries. This is a grouping heuristic, not an accuracy guarantee or manufacturer/product identity check.

7. Spatial instances

   No instance is removed, reordered, recentered, rotated, rescaled, or merged geometrically. Each keeps its native ID, original dimensions, position, rotation, scale and optional full matrix. Rendering still iterates every element. The room ID and type reference add metadata relationships within the existing captured-room frame. Room-to-project transforms remain separate. Keeping original per-instance geometry also preserves small size differences within a group; metadata sharing does not compress or rewrite the native CapturedRoom archive.

8. Backward compatibility

   Creation, hydration and save normalize scan metadata. Old documents and old full archives gain definitions safely on load; missing measurements remain unknown. Saves persist normalized metadata to the index and, when the complete scan payload is available, its archive. Metadata-only saves preserve existing heavy archives; an older archive is normalized again when read. Repeated normalization is idempotent, and all new fields are additive. No rescan is required.

9. Tests added

   28 additional Vitest cases cover metric W/D/H and all products, missing/invalid dimensions, low/missing confidence, partial-axis evidence, units, four-chair grouping and quantity, near matches, each axis outside tolerance, relative tolerance, chain prevention, category/room separation, immutable transforms/matrices/scales, removal counts, legacy documents and full archives, index/archive round trips, and explicit metric/imperial formatting. Native assertions cover four shared-type chairs rendering as four independent nodes plus live and saved W/D/H labels. Existing transform/geometry regressions remain enabled.

10. Verification

   - `npm test`: 84 tests passed across 14 files (56 existing + 28 added).
   - `tsc --noEmit`: passed.
   - `python3 tools/test-room-transforms.py`: passed, including production SceneKit geometry/transform helpers and production live-label formatter.
   - Live-viewer script executed with a minimal DOM stub: explicit W/D/H and missing-dimension rendering passed.
   - `git diff --check`: passed.
   - Full Debug iOS simulator workspace build: passed (`CODE_SIGNING_ALLOWED=NO`, arm64). Build log: `/private/tmp/construction-object-metadata-build.log`. The first sandboxed attempt could not access CoreSimulator; the approved build outside the sandbox succeeded.

11. Limitations

   RoomPlan provides estimated local bounding dimensions, not true surface area, occupied material volume, product identity, or survey-grade measurements. Occlusion, incomplete recognition, missing axes, low confidence and older records can prevent derived calculations/grouping. Stairs remain bounding geometry: tread/riser measurements are not inferred. Similar-category objects of matching size can still be different products, and conservative matching may leave actual identical items separate. Live values are provisional; grouping is established from the completed scan when its room ID is available. No physical LiDAR-device accuracy or end-to-end phone UI validation was performed for this change.
