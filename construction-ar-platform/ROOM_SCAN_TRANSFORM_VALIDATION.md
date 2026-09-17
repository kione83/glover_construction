Room scan coordinate correction — 2026-09-09

Findings

- Capture serializes each RoomPlan/ARKit matrix as a row-major JSON array. Storage writes/reads JSON without geometry rounding or recentering. The existing working-tree starburst fix reconstructs SIMD columns explicitly and keeps mesh vertices/indices in their owning anchor.
- SavedRoom3DView's floor/ceiling branch ignored the matrix, used position only, and added a vertical offset. Walls used the complete matrix. This is a concrete source of relative floor yaw error.
- Captured polygonCorners were persisted but ignored: walls became dimension-derived rectangles and floors became boxes. The renderer now uses valid captured local boundaries, including concave boundaries. This prevents losing boundary shape; it does not prove that this caused every gap in the reported real scan. No failing scan archive was available for comparison.
- Existing matrix-bearing walls and doors already use the same room parent. No independent centering, PCA, quantization, or axis conversion was found in this render path. Old matrix-less scans have a pre-existing yaw-sign compatibility conversion; discarded pitch/roll cannot be recovered from those fields alone.
- Warm colors originated in d22e98c5, the initial saved-viewer implementation. Whole-room selection applied yellow emission to every feature, in addition to brown floors, orange doors/tables and yellow chairs. These are semantic/selection materials, not confidence values. No earlier cool saved-viewer implementation exists in this file's history.

Correction

ARKit world (right-handed, Y-up, meters) remains the canonical captured-room frame. SceneKit world points are roomContainer * capturedLocalToWorld * localVertex. Floors now use precisely the same matrix application as walls/doors/windows/objects, once. No surface origin is moved. Camera fitting leaves geometry untouched. The existing project room parent handles whole-room placement.

Captured wall/floor polygon vertices stay in their original local coordinates. Ear clipping generates only local Int32 triangle indices, supports concavity and either winding, and rejects non-finite/degenerate/untriangulable inputs. Legacy surfaces without usable polygons retain their dimension-based fallback. Wall fallback indices are explicitly Int32 (four bytes), avoiding architecture-dependent Swift Int indices. ARMeshAnchor decoding, index-width validation, index ownership, matrix reconstruction, and normal semantic rendering remain intact.

The normal palette uses navy structure, blue-grey floors/objects, light blue-grey door frames and charcoal openings. Selection emission is blue. Debug anchor colors remain available independently. Confidence and measurements are unchanged.

Diagnostics (disabled by default; unavailable in Release)

Set CONSTRUCTION_AR_TRANSFORM_DIAGNOSTICS=1 in the Xcode Debug scheme. Capture logs include component IDs/types, dimensions, source matrix, positions/quaternions and identity capture container. Viewer logs include local/world position and quaternion, dimensions, source matrix, local/world matrix and parent world matrix. Wall bottom endpoints and available captured polygon world corners permit comparison across IDs. The room container is also logged. Turn the flag off after inspection.

For a visible synthetic fixture set CONSTRUCTION_AR_RENDER_FIXTURE=rectangular-room. It contains four walls, a floor and a door, translated and rotated 37 degrees in the shared captured frame. Existing single-wall/two-wall fixtures remain available.

Validation

- python3 tools/test-room-transforms.py: PASS. Extracts the production Swift geometry/transform/material methods and runs them with macOS SceneKit (AppKit color adapter; UI/annotation logging stubbed). A 4 x 5 m room with a door, window and opening is captured at 37 degrees and translated, then parented under a separate -23-degree container. Checks four closed corners, floor perimeter, door/wall coincidence, identical floor/back-wall axis, matrix order, whole-room rigid movement, JSON reopening, explicit 32-bit wall topology, concave polygon area for both windings, malformed polygon rejection and cool material channels. Coordinate tolerance: 0.00001 m. This is numerical SceneKit validation, not a rendered screenshot or physical scan.
- npm test -- --reporter=dot: PASS, 50 tests across 12 files, including existing mesh and archive persistence regressions.
- npx tsc --noEmit: PASS.
- Both complete changed Swift files typechecked against the iOS 16+ simulator SDK in Debug and Release modes: PASS. Only the React event-block typedef was substituted; UIKit, SceneKit, ARKit and RoomPlan use the real iOS SDK.
- Full simulator app build: blocked before app compilation by the ExpoModulesJSI dependency's generated framework failing CodeSign with “resource fork, Finder information, or similar detritus not allowed.” Build log: /tmp/construction-room-transform-build.log. This is not a successful app build.

On-device acceptance still required

Capture a rectangular room containing a door with diagnostics enabled. Compare capture and viewer matrices and the logged adjacent wall endpoints/boundaries; inspect floor alignment and door embedding. Save/reopen and repeat, with selection enabled to verify the blue palette. Verify no spikes in the completed model. Repeat without diagnostics. Real-world capture accuracy, gaps already present in RoomPlan data, and visual appearance on the target device cannot be established from the synthetic fixture. No snapping or inferred wall-to-door attachment is introduced. Door geometry remains the existing semantic frame; this change does not add boolean wall cutouts.

Phone deployment follow-up — 2026-09-09

Release device build succeeded using /tmp/construction-phone-build with ENABLE_USER_SCRIPT_SANDBOXING=NO for the CocoaPods resource-copy phase. Updated tools/apply-expo-xcode-compatibility.mjs to disable intermediate ExpoModulesJSI signing for its newer nested xcodebuild command; the final app is still signed normally. Device build log: /tmp/construction-phone-build-retry.log.

Installed the resulting app in place on Steve's iPhone 15 Pro Max using devicectl and launched com.kione83.construction-ar-platform successfully. The Release app includes main.jsbundle and does not require Metro. Installation/launch does not replace the outstanding real-room scan acceptance checks above.
