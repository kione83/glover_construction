Manual room assembly — 2026-09-09

Architecture and causes

HomeScreen's View 3D Model opens SavedRoomViewerScreen in project mode. It loads the lightweight project index, then hydrates the selected project's complete scan archives through loadProjectDocuments. Each scan is already a SavedRoom3DView roomNode under contentNode. ProjectSpatialModel.roomTransforms existed, but new rooms received identity transforms and the project viewer enabled no placement gestures. Independent capture origins therefore appeared piled together.

The assembly implementation reuses roomTransforms and adds optional lockedRoomId and assemblyRoomIds. The latter distinguishes an explicitly saved identity placement from an unplaced legacy room. Existing non-identity placements/connections are respected. Unplaced rooms start in a separated row with 1.5 m clearance. Reset returns to that staging state, unlocks the reference, and preserves scans, dimensions, measurements, and existing connection metadata.

Workflow

Choose a room by tapping its closest visible geometry or by its named chip. The chip list selects a room reliably even when it is entirely hidden behind another. Active rooms receive cool-blue emission and a blue-bordered name callout. Lock room in place fixes one reference; Unlock permits changing it. The reference has a Locked badge. Lock checks exist in both TypeScript state updates and native gesture handling, including the existing pair-alignment screen.

Camera mode retains orbit/pan/pinch navigation. Move / rotate mode disables camera gestures: one finger drags the selected unlocked room on a shared horizontal plane; a two-finger twist rotates about its captured center around assembly Y. Precision tools offer X/Z/Y movement at 1 cm, 10 cm, or 1 m and rotation at ±1°, ±5°, ±90°. There is no room-scale gesture. Full matrices remain authoritative, including existing pitch/roll/scale. Focus room fits the selected room; Reset view fits the whole assembly.

Drag events update native room containers continuously and send their complete matrix once the gesture ends. The small roomTransformsJSON prop updates existing nodes, without serializing/rebuilding captured geometry on each move. Camera fitting and annotation updates do not modify scan vertices or component transforms. The prior polygon, matrix decoding, triangle-index, floor alignment and palette fixes remain intact. No snapping is added.

Placement and lock changes auto-save after a short debounce. Save layout is also explicit, and Close flushes the current layout before leaving. Writes are serialized and merge into the latest project metadata, retaining scan archives and other document data. Errors remain visible and Close stays on screen if saving fails. A force-quit during the debounce or an unfinished drag can lose that latest unfinished edit; completed saved placement is restored when reopening.

Measurements

Existing data lives in room.roomScan.measurements (elementId, dimension, value, unit, history), elements[].dimensions, roomScan.floorFootprint/ceilingHeight, and room.measuredDimensions. CSV/export and capture values are unchanged.

The old native renderer globally capped labels at 12, excluded furniture/fixtures, sized SCNText to roughly 30 cm or less, and omitted axis names for walls/floors. Labels were difficult to locate, could be occluded and could be assigned the wrong label when an axis was absent.

Annotations now use camera-projected, screen-sized UIKit labels with dark navy backing and leader lines. Their anchors remain children of the corresponding feature or room. A display link updates positions while the camera or a room moves. Room summary callouts display stored room-level H/W/L values; missing values are omitted rather than inferred. Width maps to W, height to H, depth to L, and units are retained. Each available feature measurement uses the same explicit H/W/L mapping, falling back only to already captured meaningful element dimensions when a measurement record is absent. Furniture/fixtures are included. Zero/non-finite/absent dimensions are not fabricated.

With measurements enabled, summaries appear for visible rooms and detailed callouts for the active room. Tap a surface to focus its dimensions; choosing the room chip clears that feature filter. Collision avoidance keeps callouts near their anchors and hides overflowing detail labels. Focus/zoom or surface selection exposes details in crowded views. Switching measurements off removes dimension text and detail callouts while retaining compact room names/lock indicators. The original room hierarchy is reused across toggles.

Validation

- Three serialized synthetic room fixtures: Office, Hall and Kitchen, each with four walls, floor, door, window and furniture. These are deterministic saved-format test data, not three real scans taken from the phone.
- 56 Vitest tests pass, including staging, lock guard, independent B/C movement, rigid center rotation, scale/tilt preservation, save/hydrate/reset, actual repository save/load, measurement preservation and existing scan/starburst regressions.
- npx tsc --noEmit passes.
- python3 tools/test-room-transforms.py passes. It extracts production Swift methods and checks three-room SceneKit root transforms, lock guard, matrix serialization, unchanged child transforms, dimension formatting, exact Euler-order agreement with SceneKit, plus the earlier rectangular-room/floor/door and polygon/index regression checks.
- Local Debug simulator workspace build succeeded with CODE_SIGNING_ALLOWED=NO, ENABLE_USER_SCRIPT_SANDBOXING=NO, ARCHS=arm64 and RCT_NO_LAUNCH_PACKAGER=1. Log: /tmp/construction-assembly-simulator-build.log.
- Standalone UIKit/SceneKit harness uses the complete production viewer with only React's event-block typedef substituted. It runs on a separate local simulator named Construction Assembly QA. It verifies three room roots, independent root movement/rotation, unchanged child transforms, Show Measurements off/on, visible H/W/L and door labels, and camera focus. See tools/RoomAssemblyUIHarness.swift. The harness is compile-time restricted to simulator targets.

No phone update

No devicectl/device install, phone launch, Expo deployment, Metro start, reload or refresh command was run for this task. Only a separate QA application was installed/launched on an isolated local simulator. Phone deployment remains for the user to initiate later.

Remaining acceptance

Real-phone gesture feel and dense real scans still need manual acceptance when the user chooses to update. Exact overlap is intentionally resolved by selecting the named room chip, not cycling through occluded geometry. Long rows of staged rooms should be inspected using Focus room. Detailed callouts are selectively hidden when they cannot fit near their anchors; select a surface or zoom for its dimensions. The standalone simulator harness exercises the native viewer, not the React Native control panel end-to-end. Missing room-level dimensions remain unavailable; no approximate bounds are substituted as measurements.

Final native visual check: PASS at the app's 390-point viewport height after a room translation and 90° rotation. Visible callouts included the locked Office reference, Hall H/W/L summary and Door H/W values. The Show Measurements off/on assertions and unchanged child-transform assertions passed. Screenshot: /tmp/assembly-ui-check/measurements-final.png. The final simulator workspace rebuild also passed after the camera/callout adjustments. The isolated QA simulator was shut down after testing.

Files changed for this task

- src/features/roomViewer/SavedRoomViewerScreen.tsx
- src/features/roomViewer/NativeSavedRoom3DView.tsx
- ios/ConstructionARPlatform/SavedRoom3DView.swift
- ios/ConstructionARPlatform/RoomScanViewManagerBridge.m
- src/domain/projects.ts
- src/domain/roomAssembly.ts
- src/domain/roomAssembly.test.ts
- src/domain/fixtures/threeRoomAssembly.json
- src/storage/projectRepository.test.ts
- tools/test-room-transforms.py
- tools/RoomAssemblyUIHarness.swift
- ROOM_ASSEMBLY_VALIDATION.md

Other working-tree changes predate this task and were preserved.

Subsequent authorized phone deployment — 2026-09-09

After the user explicitly requested the phone update in a later turn, the latest Release device build succeeded (/tmp/construction-assembly-phone-build.log). Installed in place on Steve's iPhone 15 Pro Max and launched com.kione83.construction-ar-platform successfully. The bundled JavaScript includes the assembly workspace and measurement changes. The earlier no-phone-deployment statement describes the implementation/validation turn; this later deployment was separately requested by the user.
