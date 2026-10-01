# Viewport workspace update

Implementation: RoomScanScreen and SavedRoomViewerScreen now use a shared, initially collapsed ControlDrawer. The drawer retains mounted content (including the active streaming component), hides collapsed content from accessibility, and scrolls when expanded. Existing SafeAreaView containers bound the viewport, drawer and overlays. Scan capture keeps a compact Finish & save button available. Capture behavior and measurement data are unchanged.

Saved-room and project viewers use PlacementControls: drag the left stick away from its center to repeatedly translate the selected item. Release, responder cancellation, changing selection, app backgrounding, and Place stop input. Movement uses the existing selected numeric step (default 0.1 m, precision 0.01 m) scaled by stick deflection every 100 ms. Right buttons rotate 5 degrees normally or 1 degree in precision mode. Place disables manipulation and saves; existing debounced autosave remains. Tapping an item again reactivates placement.

Furniture, fixtures and built-ins are selected by their saved SceneKit element IDs, highlighted in blue and labeled with their room/category. Their translation is room-local X/Z, preserving captured Y, and rotation is about their own center. Room selection uses an architectural surface or the existing room-name chips. Rooms move in project X/Z and rotate about the existing captured room center. A reference must be locked before moving another room; the locked room cannot move. Room Y and ±90-degree controls remain in precision tools; selecting scanned furniture routes X/Z and rotation precision buttons to that object and disables Y. Furniture edits do not move their parent room. Moving a room carries all its children, including edited furniture.

Camera orbit/pan/pinch stay enabled in project and single-room viewers. Placement responders are confined to the joystick and action buttons; direct room drag is disabled in these viewers. The existing explicitly enabled direct-drag workflow remains available in manual alignment mode.

Persistence: optional `spatialModel.objectTransforms[roomId][elementId]` holds canonical room-local Transform3D overrides. Schema version remains 8; no migration or rewrite of scan archives is required. Missing overrides render the original roomLocalTransform/captured pose. Metadata saves retain scan archives, measurements, room transforms and connections. Removing a room removes its overrides. Reset assembly retains furniture edits and measurements, resetting only room assembly as before.

Limitations: placement changes layout only; it does not change measured dimensions or improve physical scan accuracy. No collision detection, floor snapping, or gravity is introduced; furniture keeps its original elevation. Objects may be positioned outside room bounds. The joystick edits RoomPlan scanned elements, not catalog placements or architectural surfaces. No new landscape support is introduced (the app is portrait-configured). Physical gesture feel, dense-model selection, keyboard handling and safe-area appearance require the iPhone checks below.

Files: src/features/roomScan/RoomScanScreen.tsx; src/features/roomViewer/{SavedRoomViewerScreen,NativeSavedRoom3DView}.tsx; src/features/workspace/{ControlDrawer,PlacementControls,workspaceControls.test}.tsx; src/domain/{projects,savedRoomModel,viewerPlacement,viewerPlacement.test}.ts; src/storage/projectRepository.test.ts; ios/ConstructionARPlatform/{SavedRoom3DView.swift,RoomScanViewManagerBridge.m}; tools/test-room-transforms.py.

Automated verification: TypeScript, Vitest domain/storage/component-input tests. Component-input tests mock native primitives/hooks; they do not substitute for device rendering or end-to-end gesture tests. Existing room assembly tests verify locked/unlocked movement, center rotation and persistence. New tests verify both drawer labels toggle, mounted controls survive collapse, joystick centering/stopping, rotation and Place dispatch, selection eligibility, isolated X/Z object movement, elevation preservation, capture rejection, old documents and object override round trips.

## iPhone acceptance steps

1. Open an existing project with two or more saved rooms. Verify its names, measurements and scans are intact.
2. Start Room Scan. Confirm the camera dominates the screen, Scan controls is collapsed, Finish & save is reachable, and no joystick is present.
3. Open Scan controls. Edit Saved room name, toggle measurement overlays, open Measurements, and switch units. Collapse/reopen and verify state remains.
4. Start a Customer Stream using your existing viewer/room code. Collapse/reopen the drawer and verify streaming continues. Verify Stop works.
5. Use the floating Finish & save. Confirm the saved summary appears and export estimates/back-to-project remain available.
6. Open Project 3D model. Open/close Model controls; verify room selection, focus/reset view, measurements, lock, precision, Save layout and Reset assembly are reachable by scrolling.
7. Tap furniture. Verify only its geometry is highlighted and the compact label identifies its room/category. Move the joystick in each direction: only that object moves; elevation stays fixed. Release: the stick centers and movement stops.
8. While selected, orbit, pan and pinch in the central viewport. Verify only the camera changes. Tap background: manipulation becomes disabled.
9. Reselect the object. Test rotate left/right and Precision. Confirm slower movement and smaller rotation. Tap Place; controls disable. Select a different object and repeat.
10. Choose a room by name and lock it. Try the joystick and room precision buttons on the locked reference: it must remain fixed.
11. Select another room by its surface or name. Move/rotate it; all its contents travel together while the reference remains fixed. Test Y elevation and ±90° in precision tools. Place it.
12. Save layout, close, reopen and verify both furniture and room poses. Force-close/relaunch and verify again. Inspect object and room measurements and exports for unchanged dimensions.
13. Test Focus room, Reset view, unlocking/changing the reference and Reset assembly. Reset assembly should reset room placements/lock while preserving scan data and furniture edits. Check manual feature alignment still works.
14. Check controls at the top and bottom of the iPhone: no Dynamic Island/home-indicator collisions, all buttons reachable, drawer scrolls, room-name keyboard can be dismissed, and backgrounding while holding the stick stops movement. Repeat selection in a dense scan and use measurement-instance buttons when objects overlap.

Validation results: TypeScript passes; 111 Vitest tests pass across 17 files; production Swift/SceneKit regression checks pass, including object override isolation and reopen. Release iPhone build succeeds with ENABLE_USER_SCRIPT_SANDBOXING=NO (the documented build-only workaround). Build log: /tmp/construction-viewport-phone-build.log.

Deployment: installed the Release app in place on the paired iPhone 15 Pro Max (Steve) and successfully launched com.kione83.construction-ar-platform on September 16, 2026. The app contains bundled JavaScript and does not require Metro. No app uninstall or project-data reset was performed. Physical scan/gesture/safe-area acceptance remains manual.
