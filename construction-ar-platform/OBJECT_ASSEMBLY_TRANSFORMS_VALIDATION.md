# Scanned-object transform ownership fix

## Root cause and evidence

RoomPlan's CapturedRoom.Object exposes parentIdentifier (iOS 17+). The app retains the encoded CapturedRoom as nativeCapturedRoomJSON, but its editable elements previously omitted ownership metadata. SavedRoom3DView built every scanned element as a direct child of the room. applyObjectTransforms then moved only the selected feature node. A related element with its own identifier was therefore left behind. The type/quantity groups in scannedObjects.ts are shared measurement metadata, not physical assembly relationships.

This is a confirmed hierarchy defect in the code and reproduces the reported split-object behavior with explicit parent-linked components. The particular stove/oven scan could not be inspected: the connected phone's app scan archive directory contained no files during this task. No stove/oven-specific inference has been added. If a scan represents two parts as unrelated objects without parent metadata, this change intentionally does not guess that they belong together.

## Representation and ownership

Persisted elements remain a flat list with original room-local/captured poses and original measurements. Optional parentObjectId is recovered from the existing native archive and retained during normalization. The archive, classification and RoomPlan capture code are unchanged. Parent links are accepted only between editable objects in the same scan; architectural parents, missing IDs, self-links and cycles do not create assemblies. UUID matching is case-insensitive. Shared category/type, dimensions and proximity never imply ownership.

The viewer resolves each explicit parent chain to one root. The transient render payload adds objectRootId and objectRootTransform. SceneKit creates:

    room root
      object root (one placement transform, root object's captured pivot)
        component geometry A (root-local offset)
          measurement anchor A
        component geometry B (root-local offset)
          measurement anchor B
        component geometry C (root-local offset)

Existing component nodes are reparented, not duplicated. Relative matrices preserve offsets, orientation, scale and nested geometry. Labels remain UIKit overlays projected from SceneKit anchors attached to the corresponding component. Hit testing and selection highlighting resolve descendants to the common object root. Measurement dimensions/categories remain per component. The measurement list can still inspect a component, while movement addresses its assembly owner.

Movement uses the existing joystick increments and root-center rotation helper unchanged. For captured root R and component C, the fixed component offset is inverse(R) × C. Placement E renders the component at E × inverse(R) × C. Native pose updates change E only. Room transforms remain the parent of the entire assembly and use the existing room movement/locking logic.

## Compatibility

No schema-version bump or destructive migration. Existing archives recover parent metadata when loaded; summaries can retain it without requiring the native JSON. Without ownership data, elements stay independently editable. Old component-only overrides are converted to a root pose using the original component offset. If conflicting legacy edits exist, the explicit root edit takes precedence; otherwise the first edited component in sorted ID order establishes the assembly pose. A subsequent edit stores only the root override for that assembly. The native bridge sends root poses only, preventing a second transform on descendants. Original captured poses and measurements remain intact.

## Files changed for this fix

- src/domain/projects.ts: optional parentObjectId.
- src/domain/scannedObjects.ts: preserve recovered ownership during normalization.
- src/domain/scannedObjectAssemblies.ts: explicit relationship recovery, root resolution and legacy placement recovery.
- src/domain/savedRoomModel.ts: assembly-aware render payload and rigid component poses.
- src/domain/viewerPlacement.ts: selection/movement ownership and root-only bridge poses.
- src/features/roomViewer/SavedRoomViewerScreen.tsx: assembly selection highlight and pose bridge.
- ios/ConstructionARPlatform/SavedRoom3DView.swift: common roots, reparenting, descendant selection and root transform application.
- src/domain/scannedObjectAssemblies.test.ts: ownership, movement, rotation, compatibility and reload regressions.
- tools/test-room-transforms.py: production SceneKit parenting, label-anchor, hit-identity and reload checks.
- This validation note.

## Manual iPhone acceptance

1. Open a saved room containing an appliance with multiple components. Tap each component in turn: each should select/highlight the same complete assembly.
2. Move it using the unchanged joystick. Every related part must travel together; unrelated adjacent items must remain still.
3. Rotate left/right, including an object that was already rotated in the scan. Check the components orbit the common object pivot without changing their relative spacing/orientation.
4. Enable measurements. Check each component's dimensions remain unchanged and its callout/leader follows it. Tap component geometry and inspect measurement-list selections.
5. Repeat for cabinet/storage and table/chair furniture. Independent nearby objects, including identical chairs, must remain independently movable unless explicitly parent-linked in the scan.
6. Place/save, close/reopen the model, then force-close/relaunch the app. Check complete placement and orientation, unchanged component count, and absence of duplicate/stranded parts at the original position.
7. Test an older layout where only a component was moved, and one where the root was moved. Both should open as one rigid assembly; the root override wins if both exist.
8. Move/rotate an unlocked room relative to a locked reference. All object assemblies and their labels must follow the room; the reference must remain fixed.
9. Orbit/pan/pinch with an object selected. Camera navigation and joystick response should behave as before.

Physical acceptance on the reported scan remains necessary. No category-specific handling, proximity merging, new joystick behavior, capture changes or measurement recalculation was introduced.

Validation results (September 17, 2026): TypeScript and 118 Vitest tests across 18 files passed. Production Swift/SceneKit checks passed, including assembly parenting, relative matrices, component labels, descendant identity, independent neighboring geometry and reload. Release iPhone build succeeded; log: /tmp/construction-object-hierarchy-build.log. Installed in place on the connected iPhone 15 Pro Max using the prior authorization to push these updates. No app-data reset or uninstall was performed.
The phone was locked when launch was attempted, so iOS denied automatic launch. Installation succeeded; unlock the phone and open the app for physical acceptance.
