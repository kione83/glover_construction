# Construction AR Platform

An Expo/React Native construction-planning prototype with local project data,
manual layout validation, and a local-development WebRTC live-view proof of
concept.

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
selected project. Image plans are previewed in the workspace; PDF plans remain
available as document references. **Share layout summary** creates a concise
handoff containing rooms, placed objects, plan references, validation issues,
photos, and notes. The summary states that MVP measurements are for planning
visualization and are not survey-grade.

## Room Scan

On a supported LiDAR iPhone running iOS 16 or later, choose **Scan Room** in a
project workspace. The native RoomPlan workflow captures individual wall,
floor, door, window, opening, built-in, furniture, and fixture elements with
metric dimensions, transforms, semantic categories, confidence, and capture
time. The resulting `roomScan` is stored on the existing `RoomCapture` inside
the local project document (schema version 5), so the room can be reconstructed
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

## Verification

Run `npx tsc --noEmit` for TypeScript, `npm test -- --run` for unit tests, and
the iOS workspace build for the native RoomPlan/ARKit modules.

## Deliberately out of scope

- Headset support
- Production authentication and durable backend synchronization
