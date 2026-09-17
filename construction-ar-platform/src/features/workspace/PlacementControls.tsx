import { useEffect, useRef, useState } from "react";
import { AppState, PanResponder, Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../../theme/colors";

export function PlacementControls({ enabled, targetKey, precision, onPrecision, onMove, onRotate, onPlace }: { enabled: boolean; targetKey: string; precision: boolean; onPrecision: () => void; onMove: (x: number, z: number) => void; onRotate: (direction: number) => void; onPlace: () => void }) {
  const [stick, setStick] = useState({ x: 0, y: 0 });
  const vector = useRef({ x: 0, y: 0 });
  const latest = useRef({ enabled, onMove }); latest.current = { enabled, onMove };
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  function stop() { clearInterval(timer.current); timer.current = undefined; vector.current = { x: 0, y: 0 }; setStick(vector.current); }
  useEffect(() => { stop(); return stop; }, [enabled, targetKey]);
  useEffect(() => { const subscription = AppState.addEventListener("change", stop); return () => subscription.remove(); }, []);
  const responder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => latest.current.enabled,
    onPanResponderGrant: () => { stop(); timer.current = setInterval(() => { const v = vector.current; if (latest.current.enabled && Math.hypot(v.x, v.y) > 6) latest.current.onMove(v.x / 36, v.y / 36); }, 100); },
    onPanResponderMove: (_, gesture) => { const length = Math.max(36, Math.hypot(gesture.dx, gesture.dy)); vector.current = { x: gesture.dx * 36 / length, y: gesture.dy * 36 / length }; setStick(vector.current); },
    onPanResponderRelease: stop, onPanResponderTerminate: stop,
    onPanResponderTerminationRequest: () => true,
  })).current;
  return <View pointerEvents="box-none" style={styles.overlay}>
    <View accessibilityLabel="Placement joystick, horizontal X and Z movement" style={[styles.joystick, !enabled && styles.disabled]} {...responder.panHandlers}><Text style={styles.axes}>X / Z</Text><View style={[styles.knob, { transform: [{ translateX: stick.x }, { translateY: stick.y }] }]} /></View>
    <View style={styles.actions}>
      <Action label={precision ? "Precision ✓" : "Precision"} onPress={onPrecision} />
      <View style={styles.row}><Action label="↶" hint="Rotate left" disabled={!enabled} onPress={() => onRotate(-1)} /><Action label="↷" hint="Rotate right" disabled={!enabled} onPress={() => onRotate(1)} /></View>
      <Action label="Place ✓" disabled={!enabled} onPress={() => { stop(); onPlace(); }} />
    </View>
  </View>;
}
function Action({ label, hint, disabled = false, onPress }: { label: string; hint?: string; disabled?: boolean; onPress: () => void }) { return <Pressable accessibilityRole="button" accessibilityLabel={hint ?? label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[styles.action, disabled && styles.disabled]}><Text style={styles.text}>{label}</Text></Pressable>; }
const styles = StyleSheet.create({ overlay: { position: "absolute", bottom: 12, left: 16, right: 16, flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" }, joystick: { width: 116, height: 116, borderRadius: 58, borderWidth: 1, borderColor: colors.lightBlue, backgroundColor: "rgba(11,35,65,.85)", alignItems: "center", justifyContent: "center" }, knob: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.lightBlue }, axes: { position: "absolute", top: 8, color: colors.surface, fontSize: 10 }, actions: { gap: 6 }, row: { flexDirection: "row", gap: 6 }, action: { minHeight: 44, minWidth: 44, paddingHorizontal: 10, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: colors.navy, borderWidth: 1, borderColor: colors.lightBlue }, text: { color: colors.surface, fontWeight: "700", fontSize: 13 }, disabled: { opacity: 0.35 } });
