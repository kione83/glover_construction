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

## Verification

Run `npx tsc --noEmit` for TypeScript and `npm test` for validation rules.

## Deliberately out of scope

- Object placement and measurement tools
- RoomPlan, LiDAR, AR anchors, or scan processing
- Headset support
- Recording, sharing, production signaling, or remote streaming
