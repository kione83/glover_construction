Room/object spatial hierarchy — 2026-09-14

1. Files changed in this task

   New:
   - `src/domain/spatialTransforms.ts`
   - `src/domain/roomObjectHierarchy.ts`
   - `src/domain/savedRoomModel.ts`
   - `src/domain/roomObjectHierarchy.test.ts`
   - `src/features/measurement/RoomPlacementAlignment.tsx`
   - `ROOM_OBJECT_HIERARCHY_VALIDATION.md`

   Updated:
   - `src/domain/projects.ts`
   - `src/domain/scannedObjects.ts`
   - `src/domain/roomAssembly.ts`
   - `src/storage/projectDocument.ts`
   - `src/storage/projectRepository.ts`
   - `src/features/home/HomeScreen.tsx`
   - `src/features/measurement/MeasurementScreen.tsx`
   - `src/features/measurement/NativeMeasurementARView.tsx`
   - `src/features/roomViewer/SavedRoomViewerScreen.tsx`
   - `ios/ConstructionARPlatform/MeasurementARView.swift`
   - `ios/ConstructionARPlatform/SavedRoom3DView.swift`
   - `src/domain/projects.test.ts`
   - `src/domain/scannedObjects.test.ts`
   - `src/domain/roomAssembly.test.ts`
   - `src/storage/projectDocument.test.ts`
   - `src/storage/projectRepository.test.ts`
   - `tools/test-room-transforms.py`

   Existing uncommitted work, including Schema 7 measurements/grouping and room assembly, was preserved. Before editing, source snapshots were saved under `/private/tmp/construction-room-hierarchy-baseline` to distinguish this task's changes from earlier work.

2. Schema/data model

   Project schema advances from 7 to 8 with additive fields. Scanned object elements gain `roomLocalTransform`; their Schema 7 room/type references, dimensions, derived type measurements, instance IDs and raw captured transforms remain intact. Placed objects gain `roomLocalTransform`, `transformSpace`, `spatialStatus`, `arSessionId`, and `arWorldFromRoom` where applicable. Their `objectTypeId` references the existing catalog definition; catalog placements remain separate from observed RoomPlan `objectTypes`. Measurement metadata is retained, or initialized from known catalog dimensions.

3. Room-local object transforms

   `roomLocalTransform` maps object-local geometry into its parent captured-room frame. It contains position, Euler rotation, scale, and an authoritative row-major 4×4 matrix. The original `transform` is retained as source evidence. Canonicalization fills absent components safely and does not repeatedly bake room transforms into children. Scanned objects retain their own original sizes even when metadata is grouped.

4. Room assembly transforms

   The existing `project.spatialModel.roomTransforms[roomId]` stores room-to-project transforms, with `assemblyRoomIds` distinguishing initialized identity placements from unplaced legacy rooms. Existing staging is retained for unplaced rooms. `lockedRoomId` remains the persisted reference-room marker. Auto-save, explicit save and Close save room matrices; alignment and assembly saves share a serialized queue and merge against the latest project record. Placement saves also serialize and read the latest document to avoid dropping rapid independent edits.

5. Coordinate conversion

   `spatialTransforms.ts` centralizes complete TRS defaults, matrix multiplication/inversion, matrix-authoritative conversion, relative transforms and feature alignment. Units are meters; matrices are row-major with column vectors; ARKit/SceneKit use right-handed, gravity-aligned Y-up coordinates. The original RoomPlan capture-session frame is the saved room's local frame. Older matrix-less RoomPlan yaw is converted once using the existing sign compatibility rule, without modifying its source record.

   Live AR world is a separate frame for each session. A session UUID prevents replaying one session's coordinates in another. The existing AR placement panel now supports two physical reference-center correspondences to establish `ARWorldFromRoom`. New placement persistence computes `objectLocal = inverse(ARWorldFromRoom) * objectARWorld`. Returning to live AR requires fresh registration; this is not automatic world-map relocalization. Manual rooms can explicitly adopt the current session origin for an approximate layout.

6. Parent/child composition and saved rendering

   Saved rendering is `viewer/project root * roomToProject * objectLocal`. Every scanned instance stays in its existing room node. Proposed placements are additional children under that same node; they are not injected into heavy captured archives. The saved-model builder resolves catalog metadata and retains scan type metadata/instance references. Moving a room updates only its parent node. Four grouped chairs remain four independent nodes. Single-room inspection uses an identity room parent; the building viewer uses persisted assembly transforms. W/D/H labels and the existing object measurement panels remain available, with placed-object details added to the measurement section.

7. Locked reference room

   Existing selection/lock controls are retained. Native gestures, TypeScript adjustment helpers, manual connection helpers and the assembly save boundary guard the locked room. Other rooms remain editable. Unlock/reset is explicit. Feature alignment now uses complete matrix composition rather than simplified yaw/position arithmetic.

8. Individual object editing in saved view

   Selection and measurement inspection are supported. The saved viewer has room manipulation gestures, not an existing per-object translation/rotation editor; no new object editor was built. Explicit room-local transforms and index overrides support future per-object editing. Existing live-AR move/rotate/remove controls remain available after registration. The native AR bridge preserves full matrices and scale; selection no longer changes an object's scale.

9. Backward compatibility

   Old scanned objects derive local transforms from their retained RoomPlan capture coordinates. Missing room transforms receive safe defaults/staging. Explicitly room-local placements and legacy manual placements with genuine saved room-surface anchors migrate safely. Explicit project-space placements use the inverse room transform. AR placements convert only when a room-to-AR mapping is available.

   Legacy AR placements without sufficient frame information remain preserved and marked `needs-alignment`; the UI explains why they are not overlaid at invented room coordinates. Orphan instances retain useful local data. Metadata-only saves preserve heavy archive bytes. Full archive reads overlay current index-local transforms by instance ID, so older archived poses cannot erase later local overrides. Repeated loading retains canonical matrices without accumulated child drift.

10. Tests added

   17 additional unit cases cover scanned/placed local persistence, shared metadata, AR and project-space conversion, unknown legacy AR, manual-anchor migration, missing transforms, orphan records, parent translation/rotation, independent rooms, four grouped instances, single-room coordinates, locked-room mutation/save guards, matrix inversion and feature alignment, two-reference AR registration, 40 save/reopen cycles, and repository-level metadata-only/archive override preservation. Existing assertions were updated for schema 8 and matrix-based comparisons without removing coverage.

   The native harness now executes production `buildRoom` with four scanned instances plus a proposed instance, verifies parent-child composition under room translation/rotation, checks that the other room is unchanged, and verifies restored world poses. Existing scan geometry, label, lock and matrix regressions remain enabled.

11. Verification

   - `npm test`: 101 tests passed across 15 files (84 existing + 17 added).
   - `tsc --noEmit`: passed.
   - `git diff --check`: passed.
   - Native geometry/transform harness: passed, including production room construction and proposed placements.
   - Full Debug arm64 iOS simulator workspace build: passed. Log: `/private/tmp/construction-room-hierarchy-build.log`.
   - No physical-device deployment was performed.

12. Remaining limitations

   Unmapped old AR placements cannot be reconstructed accurately from coordinates alone; their original data is preserved for future guided recovery. Saved-view per-object manipulation is deferred. Automatic AR world-map relocalization is not implemented. Proposed objects currently use the saved viewer's existing bounding geometry renderer. Abrupt termination before a write completes, or during an unfinished native drag, can lose that unfinished edit; explicit Save and Close wait for persistence. Grouped dimensions/areas remain bounding-box estimates, not verified product geometry or survey measurements.

13. Physical validation still required

   No claim is made about physical iPhone/LiDAR behavior or accuracy. Run the requested two-room workflow on a LiDAR iPhone: retain scanned contents or register the current AR session before placing objects; save and close; reopen the saved building; lock Room A; translate/rotate Room B; save/close/reopen; verify every instance and room relationship. Also validate physical reference-center selection, registration tolerance, tracking interruption/recovery, gesture feel, dense-scene labels, and app lifecycle behavior. The simulator build and native harness do not substitute for this end-to-end physical test.
