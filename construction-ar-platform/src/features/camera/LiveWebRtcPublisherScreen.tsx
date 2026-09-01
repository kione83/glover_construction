import { useEffect, useRef, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  MediaStream,
  RTCPeerConnection,
  RTCIceCandidate,
  RTCSessionDescription,
  RTCView,
  mediaDevices,
} from "react-native-webrtc";

import { colors } from "../../theme/colors";

interface LiveWebRtcPublisherScreenProps {
  onClose: () => void;
  onClearPlacements: () => void;
}

type SignalMessage =
  | { type: "viewer-ready" }
  | { type: "answer"; sdp: NonNullable<ConstructorParameters<typeof RTCSessionDescription>[0]> }
  | { type: "candidate"; candidate: ConstructorParameters<typeof RTCIceCandidate>[0] }
  | { type: "error"; message: string };

const DEFAULT_ROOM = "construction-demo";

/**
 * Local-development WebRTC publisher. The signaling server relays only SDP and
 * ICE messages; video travels directly between the iPhone and laptop browser.
 */
function normalizeSignalServerUrl(input: string): { url?: string; error?: string } {
  const value = input.trim();

  if (!value) {
    return { error: "Enter the signal server URL, for example ws://10.0.0.81:8080/signal." };
  }

  if (value.startsWith("http://") || value.startsWith("https://")) {
    return {
      error:
        "That is the browser viewer URL. In the phone app, use the WebSocket URL: ws://10.0.0.81:8080/signal.",
    };
  }

  const url = value.startsWith("ws://") || value.startsWith("wss://") ? value : `ws://${value}`;

  try {
    const parsed = new URL(url);

    if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
      return { error: "Signal URL must start with ws:// or wss://." };
    }

    if (parsed.pathname === "/" || parsed.pathname === "") {
      parsed.pathname = "/signal";
    }

    if (parsed.pathname !== "/signal") {
      return { error: "Signal URL must end with /signal." };
    }

    return { url: parsed.toString() };
  } catch {
    return { error: "Enter a valid signal URL, for example ws://10.0.0.81:8080/signal." };
  }
}

export function LiveWebRtcPublisherScreen({ onClose, onClearPlacements }: LiveWebRtcPublisherScreenProps) {
  const [serverUrl, setServerUrl] = useState(process.env.EXPO_PUBLIC_SIGNALING_URL ?? "");
  const [room, setRoom] = useState(DEFAULT_ROOM);
  const [status, setStatus] = useState("Enter your laptop's signaling URL.");
  const [streamUrl, setStreamUrl] = useState<string>();
  const socketRef = useRef<WebSocket | undefined>(undefined);
  const peerConnectionRef = useRef<RTCPeerConnection | undefined>(undefined);
  const streamRef = useRef<MediaStream | undefined>(undefined);
  const queuedCandidatesRef = useRef<ConstructorParameters<typeof RTCIceCandidate>[0][]>([]);

  useEffect(() => () => stopPublishing(), []);

  function send(message: object) {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(message));
    }
  }

  async function startCameraStream() {
    if (peerConnectionRef.current) return;

    const stream = await mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: "environment", frameRate: 24, width: 1280, height: 720 },
    });
    streamRef.current = stream;
    setStreamUrl(stream.toURL());

    const peerConnection = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    peerConnectionRef.current = peerConnection;
    stream.getTracks().forEach((track) => peerConnection.addTrack(track, stream));
    peerConnection.onicecandidate = (event: { candidate: RTCIceCandidate | null }) => {
      if (event.candidate) send({ type: "candidate", candidate: event.candidate.toJSON() });
    };
    peerConnection.onconnectionstatechange = () => {
      setStatus(`Peer connection: ${peerConnection.connectionState}.`);
    };

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    send({ type: "offer", sdp: offer });
    setStatus("Camera is publishing. Waiting for the laptop to connect…");
  }

  async function handleSignal(message: SignalMessage) {
    if (message.type === "viewer-ready") {
      try {
        await startCameraStream();
      } catch (error) {
        setStatus("Could not open the camera for WebRTC publishing.");
        Alert.alert("Camera unavailable", error instanceof Error ? error.message : "Check camera permissions and try again.");
      }
      return;
    }
    if (message.type === "answer" && peerConnectionRef.current) {
      await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(message.sdp));
      for (const candidate of queuedCandidatesRef.current) {
        await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate));
      }
      queuedCandidatesRef.current = [];
      return;
    }
    if (message.type === "candidate") {
      if (peerConnectionRef.current?.remoteDescription) {
        await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(message.candidate));
      } else {
        queuedCandidatesRef.current.push(message.candidate);
      }
      return;
    }
    if (message.type === "error") setStatus(message.message);
  }

  function connect() {
    stopPublishing();
    setStatus("Connecting to local signaling server…");
    const signalUrl = normalizeSignalServerUrl(serverUrl);

    if (signalUrl.error || !signalUrl.url) {
      setStatus(signalUrl.error ?? "Enter a valid signal URL.");
      return;
    }

    setServerUrl(signalUrl.url);

    const socket = new WebSocket(signalUrl.url);
    socketRef.current = socket;
    socket.onopen = () => {
      send({ type: "join", role: "publisher", room: room.trim() || DEFAULT_ROOM });
      setStatus("Connected. Open the viewer URL on the laptop to start the feed.");
    };
    socket.onmessage = (event) => {
      try {
        void handleSignal(JSON.parse(String(event.data)) as SignalMessage);
      } catch {
        setStatus("Received an invalid signaling message.");
      }
    };
    socket.onerror = () => setStatus("Cannot reach the signaling server. Check its LAN address and firewall.");
    socket.onclose = () => {
      if (socketRef.current === socket) setStatus("Signaling connection closed.");
    };
  }

  function stopPublishing() {
    socketRef.current?.close();
    socketRef.current = undefined;
    peerConnectionRef.current?.close();
    peerConnectionRef.current = undefined;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = undefined;
    queuedCandidatesRef.current = [];
    setStreamUrl(undefined);
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.screen}
    >
      {streamUrl ? <RTCView streamURL={streamUrl} style={StyleSheet.absoluteFill} objectFit="cover" /> : <View style={styles.previewPlaceholder}><Text style={styles.previewText}>Camera preview starts when a laptop viewer joins.</Text></View>}
      <ScrollView
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={styles.scrollContent}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.panel}>
          <Text style={styles.title}>Stream to laptop</Text>
          <Text style={styles.copy}>{status}</Text>
          <TextInput autoCapitalize="none" autoCorrect={false} value={serverUrl} onChangeText={setServerUrl} placeholder="ws://10.0.0.81:8080/signal" placeholderTextColor="#cfcfcf" style={styles.input} />
          <TextInput autoCapitalize="none" autoCorrect={false} value={room} onChangeText={setRoom} placeholder="Room code" placeholderTextColor="#cfcfcf" style={styles.input} />
          <View style={styles.actions}>
            <Pressable style={styles.primaryButton} onPress={connect}><Text style={styles.primaryButtonText}>Connect phone</Text></Pressable>
            <Pressable style={styles.secondaryButton} onPress={stopPublishing}><Text style={styles.secondaryButtonText}>Stop</Text></Pressable>
            <Pressable style={styles.secondaryButton} onPress={onClearPlacements}><Text style={styles.secondaryButtonText}>Reset room</Text></Pressable>
            <Pressable style={styles.secondaryButton} onPress={onClose}><Text style={styles.secondaryButtonText}>Close</Text></Pressable>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.navy, justifyContent: "flex-end" },
  previewPlaceholder: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", padding: 36 },
  previewText: { color: "#ddd", fontSize: 16, lineHeight: 24, textAlign: "center" },
  scrollContent: { flexGrow: 1, justifyContent: "flex-end", padding: 20 },
  panel: { padding: 18, gap: 12, borderRadius: 0, backgroundColor: "rgba(11, 35, 65, 0.94)" },
  title: { color: "#fff", fontSize: 22, fontWeight: "800" },
  copy: { color: "#eee", fontSize: 14, lineHeight: 20 },
  input: { color: "#fff", backgroundColor: "rgba(255,255,255,0.14)", borderColor: colors.lightBlue, borderWidth: 1, borderRadius: 0, paddingHorizontal: 12, paddingVertical: 11 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  primaryButton: { backgroundColor: colors.accent, borderRadius: 10, paddingHorizontal: 13, paddingVertical: 11 },
  primaryButtonText: { color: "#fff", fontWeight: "800" },
  secondaryButton: { borderColor: colors.lightBlue, borderWidth: 1, borderRadius: 0, paddingHorizontal: 13, paddingVertical: 11 },
  secondaryButtonText: { color: "#fff", fontWeight: "800" },
});
