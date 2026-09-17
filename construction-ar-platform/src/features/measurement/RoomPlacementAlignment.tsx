import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { RoomCapture } from "../../domain/projects";
import type { Transform3D, Vec3 } from "../../domain/spatial";
import { canonicalTransform, capturedTransform, roomToARFromPointPairs } from "../../domain/spatialTransforms";
import { colors } from "../../theme/colors";

/** Minimal registration within the existing AR placement panel; no world-map claims. */
export function RoomPlacementAlignment({ room, point, canCapture, aligned, onAligned }: {
  room: RoomCapture; point?: Vec3; canCapture: boolean; aligned: boolean; onAligned: (transform: Transform3D) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [first, setFirst] = useState<{ id: string; local: Vec3; world: Vec3 }>();
  const [selectedId, setSelectedId] = useState("");
  const [message, setMessage] = useState("");
  const features = (room.roomScan?.elements ?? []).filter(element => ["wall", "door", "window", "opening"].includes(element.kind) && element.transform);
  const buttonStyle = { padding: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface };
  const textStyle = { color: colors.text, fontSize: 12 };
  if (!room.roomScan) return <View style={{ gap: 8 }}>
    <Text style={textStyle}>This manual room has no scanned coordinate reference. You can explicitly use this session's origin and axes for its approximate layout.</Text>
    <Pressable accessibilityRole="button" disabled={!canCapture} style={buttonStyle} onPress={() => onAligned(canonicalTransform())}><Text style={textStyle}>{aligned ? "Manual room origin set" : "Use current AR origin for manual room"}</Text></Pressable>
  </View>;
  return <View style={{ gap: 8 }}>
    <Pressable accessibilityRole="button" onPress={() => setExpanded(value => !value)} style={buttonStyle}><Text style={textStyle}>{aligned ? "Room alignment set · adjust" : "Align AR placements to saved room"}</Text></Pressable>
    {expanded && <>
      <Text style={textStyle}>Choose two saved wall, door, or window centers at least 30 cm apart. Aim at the same physical center and capture each reference. Alignment applies only to this AR session.</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>{features.map(feature => <Pressable key={feature.id} onPress={() => setSelectedId(feature.id)} style={{ ...buttonStyle, borderColor: selectedId === feature.id ? colors.accent : colors.border }}><Text style={textStyle}>{feature.wallId ?? feature.category} · {feature.id.slice(0, 8)}</Text></Pressable>)}</View>
      <Pressable accessibilityRole="button" disabled={!canCapture || !point || !selectedId} style={buttonStyle} onPress={() => {
        const feature = features.find(item => item.id === selectedId);
        if (!feature || !point || !canCapture) return;
        const local = (feature.roomLocalTransform ?? capturedTransform(feature.transform)).position;
        if (!first) { setFirst({ id: feature.id, local, world: { ...point } }); setMessage("First center recorded. Choose a different center."); return; }
        if (first.id === feature.id) { setMessage("Choose a different saved feature for the second reference."); return; }
        const transform = roomToARFromPointPairs(first.local, local, first.world, point);
        if (!transform) { setMessage("References do not agree in spacing or elevation. Start again and aim at the same saved feature centers."); return; }
        onAligned(transform); setFirst(undefined); setExpanded(false); setMessage("");
      }}><Text style={textStyle}>{first ? "Capture second center" : "Capture first center"}</Text></Pressable>
      {first && <Pressable onPress={() => { setFirst(undefined); setMessage(""); }}><Text style={textStyle}>Start alignment again</Text></Pressable>}
      {!!message && <Text style={textStyle}>{message}</Text>}
      {features.length < 2 && <Text style={textStyle}>This scan needs two recognizable architectural features for AR registration.</Text>}
    </>}
  </View>;
}
