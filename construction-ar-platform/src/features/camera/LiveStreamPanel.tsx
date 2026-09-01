import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import {
  mediaDevices,
  MediaStream,
  RTCPeerConnection,
  RTCIceCandidate,
  RTCSessionDescription,
} from "react-native-webrtc";
import type { ProjectSpatialModel, RoomScanData } from "../../domain/projects";
import { colors } from "../../theme/colors";

const DEFAULT_ROOM = "construction-demo";
const DEFAULT_SIGNAL_URL = "ws://10.0.0.81:8080/signal";

type SignalMessage = {
  type: string;
  room?: string;
  role?: string;
  sdp?: {
    sdp: string;
    type: string | null;
  };
  candidate?: RTCIceCandidateInit;
  message?: string;
};

function normalizeSignalServerUrl(input: string): { url?: string; error?: string } {
  const value = input.trim();

  if (!value) {
    return { error: `Enter the signal server URL, for example ${DEFAULT_SIGNAL_URL}.` };
  }

  if (value.startsWith("http://") || value.startsWith("https://")) {
    return { error: `Use the WebSocket signal URL in the app: ${DEFAULT_SIGNAL_URL}.` };
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
    return { error: `Enter a valid signal URL, for example ${DEFAULT_SIGNAL_URL}.` };
  }
}

interface LiveStreamPanelProps {
  compact?: boolean;
  disabledReason?: string;
  layoutItems?: Array<{
    id: string;
    displayName: string;
    dimensions: { width: number; height: number; depth: number };
    position: { x: number; y: number; z: number };
    rotationY: number;
    representation?: string;
  }>;
  roomScan?: RoomScanData;
  projectRooms?: Array<{ id: string; name: string; roomScan?: RoomScanData }>;
  spatialModel?: ProjectSpatialModel;
  liveMeasurements?: Array<{
    id: string;
    label: string;
    value: number;
    unit: string;
    status: "estimated" | "estimating" | "stable" | "limited";
  }>;
}

export function LiveStreamPanel({ compact = false, disabledReason, layoutItems = [], roomScan, projectRooms = [], spatialModel, liveMeasurements = [] }: LiveStreamPanelProps) {
  const [serverUrl, setServerUrl] = useState(process.env.EXPO_PUBLIC_SIGNALING_URL ?? DEFAULT_SIGNAL_URL);
  const [room, setRoom] = useState(DEFAULT_ROOM);
  const [status, setStatus] = useState("Ready to stream this measurement session.");
  const [isPublishing, setIsPublishing] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const queuedCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const isPublishingRef = useRef(false);
  const layoutChannelRef = useRef<ReturnType<RTCPeerConnection["createDataChannel"]> | null>(null);

  function sendSignal(message: SignalMessage) {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(message));
    }
  }

  function sendLayout() {
    if (layoutChannelRef.current?.readyState === "open") {
      layoutChannelRef.current.send(JSON.stringify({
        type: "layout",
        items: layoutItems,
        roomScan,
        rooms: projectRooms,
        spatialModel,
        liveMeasurements,
      }));
    }
  }

  useEffect(() => {
    sendLayout();
  }, [layoutItems, roomScan, projectRooms, spatialModel, liveMeasurements]);

  async function startCameraStream(peerConnection: RTCPeerConnection) {
    const stream = await mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: "environment",
        frameRate: 24,
        width: 1280,
        height: 720,
      },
    });
    streamRef.current = stream;
    stream.getTracks().forEach((track) => peerConnection.addTrack(track, stream));
  }

  async function handleSignalMessage(message: SignalMessage) {
    if (message.type === "answer" && message.sdp && peerConnectionRef.current) {
      await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(message.sdp));
      for (const candidate of queuedCandidatesRef.current) {
        await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate));
      }
      queuedCandidatesRef.current = [];
      setStatus("Streaming live view while measuring.");
      return;
    }

    if (message.type === "candidate" && message.candidate && peerConnectionRef.current) {
      if (peerConnectionRef.current.remoteDescription) {
        await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(message.candidate));
      } else {
        queuedCandidatesRef.current.push(message.candidate);
      }
      return;
    }

    if (message.type === "error" && message.message) {
      setStatus(message.message);
    }
  }

  async function startPublishing() {
    if (disabledReason) {
      setStatus(disabledReason);
      return;
    }

    const signalUrl = normalizeSignalServerUrl(serverUrl);
    if (signalUrl.error || !signalUrl.url) {
      setStatus(signalUrl.error ?? "Enter a valid signal URL.");
      return;
    }

    stopPublishing();
    setServerUrl(signalUrl.url);
    setStatus("Connecting to the customer viewer...");

    const socket = new WebSocket(signalUrl.url);
    socketRef.current = socket;

    socket.onopen = async () => {
      try {
        const peerConnection = new RTCPeerConnection({
          iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
        });
        peerConnectionRef.current = peerConnection;
        const layoutChannel = peerConnection.createDataChannel("construction-layout");
        layoutChannelRef.current = layoutChannel;
        layoutChannel.onopen = sendLayout;
        peerConnection.onicecandidate = (event: { candidate: RTCIceCandidate | null }) => {
          if (event.candidate) {
            sendSignal({ type: "candidate", room, role: "publisher", candidate: event.candidate.toJSON() });
          }
        };
        await startCameraStream(peerConnection);
        const offer = await peerConnection.createOffer({});
        await peerConnection.setLocalDescription(offer);
        sendSignal({ type: "join", room, role: "publisher" });
        sendSignal({ type: "offer", room, role: "publisher", sdp: offer });
        isPublishingRef.current = true;
        setIsPublishing(true);
        setStatus("Waiting for the laptop viewer to join.");
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Could not start streaming.");
        stopPublishing();
      }
    };

    socket.onmessage = (event) => {
      void handleSignalMessage(JSON.parse(event.data));
    };
    socket.onerror = () => setStatus("Signal connection failed. Check Wi-Fi and the ws:// URL.");
    socket.onclose = () => {
      if (isPublishingRef.current) {
        setStatus("Signal connection closed.");
      }
    };
  }

  function stopPublishing() {
    if (socketRef.current) {
      socketRef.current.onopen = null;
      socketRef.current.onmessage = null;
      socketRef.current.onerror = null;
      socketRef.current.onclose = null;
      socketRef.current.close();
    }
    socketRef.current?.close();
    socketRef.current = null;
    peerConnectionRef.current?.close();
    peerConnectionRef.current = null;
    layoutChannelRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    queuedCandidatesRef.current = [];
    isPublishingRef.current = false;
    setIsPublishing(false);
  }

  useEffect(() => stopPublishing, []);

  return (
    <View style={[styles.panel, compact && styles.compactPanel]}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.title}>{compact ? "Customer stream" : "Customer live view"}</Text>
          <Text style={styles.status}>{status}</Text>
        </View>
        <View style={[styles.statusDot, isPublishing && styles.statusDotActive]} />
      </View>

      {!compact ? (
        <>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            onChangeText={setServerUrl}
            placeholder="ws://10.0.0.81:8080/signal"
            placeholderTextColor={colors.muted}
            style={styles.input}
            value={serverUrl}
          />
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setRoom}
            placeholder="construction-demo"
            placeholderTextColor={colors.muted}
            style={styles.input}
            value={room}
          />
        </>
      ) : null}

      <View style={compact ? styles.compactActions : styles.actions}>
        <Pressable
          disabled={Boolean(disabledReason)}
          style={[
            styles.button,
            styles.primaryButton,
            compact && styles.compactButton,
            disabledReason && styles.disabledButton,
          ]}
          onPress={() => void startPublishing()}
        >
          <Text style={styles.primaryButtonText}>{isPublishing ? "Restart" : "Stream"}</Text>
        </Pressable>
        <Pressable style={[styles.button, styles.secondaryButton, compact && styles.compactButton]} onPress={stopPublishing}>
          <Text style={styles.secondaryButtonText}>Stop</Text>
        </Pressable>
      </View>
    </View>
  );

}

const styles = StyleSheet.create({
  panel: {
    gap: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 14,
  },
  compactPanel: {
    padding: 10,
    gap: 8,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.92)",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  title: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  status: {
    color: colors.muted,
    fontSize: 13,
    marginTop: 4,
  },
  statusDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.muted,
    marginTop: 4,
  },
  statusDotActive: {
    backgroundColor: "#22c55e",
  },
  input: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: 15,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  actions: {
    flexDirection: "row",
    gap: 10,
  },
  compactActions: {
    flexDirection: "row",
    gap: 8,
  },
  button: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  compactButton: {
    minHeight: 38,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  primaryButton: {
    backgroundColor: colors.navy,
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: colors.navy,
    backgroundColor: "transparent",
  },
  disabledButton: {
    backgroundColor: colors.muted,
  },
  primaryButtonText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "800",
  },
  secondaryButtonText: {
    color: colors.navy,
    fontSize: 14,
    fontWeight: "800",
  },
});
