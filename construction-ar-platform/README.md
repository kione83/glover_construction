# Construction AR Platform

An Expo/React Native construction-planning prototype with local project data,
manual layout validation, and a local-development WebRTC live-view proof of
concept.

## Core project workflow

1. Select or create a project. **Open AR tools** retains that project, including
   when returning to the dashboard or switching projects within AR tools.
2. Choose **Scan Room** on a supported LiDAR iPhone. Finish the capture to save
   it. If storage fails, keep the screen open and use **Retry saving scan**;
   the completed capture keeps one room identity across retries.
3. Align AR placement to a saved room, then place catalog objects. Failed AR
   edits remain queued on the workspace with **Retry saving changes**. Closing
   waits for pending writes; force-quitting before a retry can lose unsaved work.
4. Open **View 3D Model** or a room's **View 3D Scan**. Tap a scanned object or
   proposed catalog object and use the joystick and rotation controls. Proposed
   objects also expose Raise/Lower controls in **Model controls**. Place/save
   persists the layout without changing captured dimensions or original AR poses.
5. In **Model controls**, use **Share layout image** to save the current layout
   and share a PNG of the current camera view, visible measurement labels, project
   name, date, and planning caveat. This exports the saved model, not live camera AR.

Validation compares oriented object envelopes in canonical room coordinates.
Unknown alignment is reported as unchecked, and missing mounting-surface evidence
is reported as unverified. Moving a proposed object in the saved viewer requires
its mounting surface to be verified again. Checks are planning aids, not code
compliance, scanned-obstacle clearance, or survey-grade approval.

## WebRTC live view (iPhone to laptop)

The iPhone is the WebRTC publisher and uses its rear camera. The laptop runs a
small WebSocket signaling server and opens the included browser viewer. Video
is sent peer-to-peer between the iPhone and laptop; the server only relays the
offer, answer, and ICE candidates.

This feature **does not run in Expo Go**. `react-native-webrtc` is a native
module, so install a custom Expo development build on the iPhone first.

### Run a local demonstration

1. Put the iPhone and laptop on the same Wi-Fi network.
2. On the laptop, run `npm run signal`.
3. Find the laptop's LAN address (for example, `192.168.1.25`).
4. On the laptop, open `http://<laptop-lan-ip>:8080/?room=construction-demo`.
5. Build and install the custom iOS development client:
   - With a cable, Xcode, signing, and a connected iPhone: `npm run ios:device`
   - Or with EAS configured for the Apple developer account: `npx eas-cli build --profile development --platform ios`
6. Start Metro for the installed development build with `npm start` and open
   this project in that build (not Expo Go).
7. In a selected project, choose **Stream to laptop**. Enter
   `ws://<laptop-lan-ip>:8080/signal`, keep the same room code as the browser,
   then choose **Connect phone**.

The development configuration temporarily permits clear-text local signaling
over `ws://` on iOS. This is for LAN testing only. Production deployment must
use HTTPS/WSS plus authenticated signaling and TURN infrastructure.

## Project documentation

From a selected project, choose **Capture photo** to save a site photo to the
project. Use the **Field notes** form to record dated observations. Both are
stored in the local project document and restored when the project is reopened.

Use **Import floor plan / blueprint** to attach an image or PDF reference to the
selected project. Tap **Open** on an imported plan to use the native offline
PDF/image viewer,
including PDF page navigation and zoom/pan. Close the preview to return to the
same project. Preview requires the updated native iOS build.
**Share layout summary** creates a concise
handoff containing rooms, placed objects, plan references, validation issues,
photos, and notes. The summary states that MVP measurements are for planning
visualization and are not survey-grade.

## Room Scan

On a supported LiDAR iPhone running iOS 16.4 or later, choose **Scan Room** in a
project workspace. The native RoomPlan workflow captures individual wall,
floor, door, window, opening, built-in, furniture, and fixture elements with
metric dimensions, transforms, semantic categories, confidence, and capture
time. The resulting `roomScan` is stored on the existing `RoomCapture` inside
the local project document (schema version 8), so the room can be reconstructed
without scanning again. Irregular rooms remain a collection of transformed
surfaces rather than being reduced to a rectangle.

The local WebRTC data channel includes the structured scan as `roomScan`, the
current live estimated measurements, planned placements, and the project's
room transforms/connections. The native iOS viewer uses SceneKit to reopen a
saved scan as independently selectable 3D room/feature nodes. **View 3D
Model** assembles all saved rooms in project-local coordinates at render time;
it does not merge or destroy their local geometry.

RoomPlan estimates are retained in the existing project document and can be
exported as CSV with their source, native confidence (when supplied), update
count, observation count, and bounded measurement history. During a live scan,
the **Show Measurements** toggle displays up to ten concise labels projected
from the current AR frame onto the captured element transforms. Labels are
offset from walls/floors/objects, camera-readable, and shifted to reduce
overlap; hiding them does not stop measurement calculation or logging.

The saved scan keeps the JSON-encoded `CapturedRoom` archive, semantic
elements, and (on supported iOS 17+ LiDAR devices) a bounded ARKit scene
reconstruction mesh for irregular architectural geometry. RoomPlan remains the
semantic authority; the retained mesh is supplemental and is especially useful
for investigating stairs. Saved scans can be deleted individually, per
project, or across all projects with confirmation; dependent placements,
anchors, scan logs, and room connections are cleaned up while notes, photos,
and manual rooms remain.

Rooms can be connected from the workspace using **Connect Rooms / Manual
Alignment**. The user selects Room A and Room B, selects architectural features
(doors, openings, walls, floors, windows, or stair representations), optionally
uses **Align selected features** for an initial snap, then fine-tunes Room B
with direct drag or 1 cm / 1 degree controls. Furniture is never used as an
anchor. The saved connection records the feature IDs, alignment method,
relative transform, and elevation change. Connections can be edited or
disconnected later without rescanning. The transform retains X/Y/Z translation
and Euler rotation, so stairs and split-level elevation changes are
representable.

RoomPlan reports stairs as a classified object with bounding dimensions;
individual step rise/run is not exposed by the current API and is not
fabricated. When supported, the bounded ARKit mesh is retained beside the
semantic model so stair shape is not discarded simply because RoomPlan cannot
classify every tread and riser. iOS 16 builds retain the semantic RoomPlan
representation but do not enable the iOS 17 scene-reconstruction mesh path.

Devices without RoomPlan support show a limitation message and do not save a
scan. Existing AR measurement and placement workflows remain available as the
fallback for those devices.

## Design alternatives, catalog and documentation

Use **Duplicate as design alternative** on a selected project, give the copy a
name, and choose **Create alternative**. The new project opens automatically.
Each copy owns its scan archives, photos and plans; rooms, placements, assembly
relationships and measurement history are retained. Edit either design without
changing the other. A missing scan archive or failed copy is reported before a
new project is committed. Alternatives are snapshots, not a version-history or
side-by-side comparison system.

The dashboard and AR workspace share a searchable catalog. Search by product
name, SKU, tag or trade, combine that search with a trade filter, and inspect the
selected object's dimensions and mounting requirements before opening placement.
Current products are generic planning representations, not manufacturer assets.

Field notes can be attached to the project, a room or a proposed object. Search
all notes by content or location, and use **Show more notes/photos** to reach the
complete history. Open a site photo for native full-size inspection and zoom.
Notes keep their location label if the referenced room/object is later removed.
Failed note writes retain the editor draft; failed photo writes retain the
captured image for retry. The camera returns to the dashboard only after saving.
Unsaved retry data remains in memory and is not guaranteed across force-quit.

## Surface-aware placement and fit review

After aligning AR to the saved room, aim at an AR-recognized compatible floor,
wall or ceiling. Mounted products use the observed support orientation and are
offset so their mounting face, rather than their center, touches the surface.
Rotations stay around the support normal. Weak tracking, unclassified planes and
unsupported surfaces produce retry guidance. Free-placement products still use
a stable tracked target. Rebuilding the native iOS app is required.

Observed surface evidence is stored in room coordinates and reprojected after
fresh-session alignment. Moving an object in the saved-model viewer invalidates
its physical attachment claim until it is placed against an observed surface
again. Recognition and alignment stability require supported-device acceptance.

Fit review includes proposed-object envelopes and their planning clearances
against captured furniture, fixtures and built-ins, including saved assembly
edits. These are approximate bounding-envelope checks; walls, openings, meshes,
uncaptured obstacles and comprehensive construction-code clearances are not
checked. Verify the actual space before installation.

## Verification

Run `npx tsc --noEmit` for TypeScript and `npm test` for domain, storage, and React
workflow tests. Run `python3 tools/test-room-transforms.py` for native SceneKit
regressions, `python3 tools/test-mounting-transforms.py` for production mounting
math and the iOS AR-view typecheck, and build the iOS workspace for full native integration.

`python3 tools/build-review-ui-harness.py /tmp/construction-review-qa` compiles
an isolated simulator-only QA app from the production saved viewer and document
preview code. Install/launch its generated `.app` on a simulator; its Documents
folder receives `review-result.json` and `layout.png` after successful checks.
It tests fixture data only. Physical LiDAR capture, alignment stability and touch
interaction still require device acceptance.

## Deliberately out of scope

- Headset support
- Production authentication and durable backend synchronization
