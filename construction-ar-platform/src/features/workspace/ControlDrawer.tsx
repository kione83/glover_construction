import type { ReactNode } from "react";
import { Keyboard, Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../../theme/colors";

/** Keep children mounted: collapsing must not stop an active customer stream. */
export function ControlDrawer({ expanded, onChange, label, children }: { expanded: boolean; onChange: (value: boolean) => void; label: string; children: ReactNode }) {
  return <View style={[styles.drawer, expanded && styles.expanded]}>
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ expanded }} onPress={() => { Keyboard.dismiss(); onChange(!expanded); }} style={styles.handle}>
      <View style={styles.grip} /><Text style={styles.label}>{expanded ? "⌄ Hide controls" : `⌃ ${label}`}</Text>
    </Pressable>
    <View accessibilityElementsHidden={!expanded} importantForAccessibility={expanded ? "auto" : "no-hide-descendants"} style={expanded ? styles.body : styles.hidden}>{children}</View>
  </View>;
}
const styles = StyleSheet.create({ drawer: { backgroundColor: colors.navy }, expanded: { height: "48%" }, handle: { minHeight: 48, alignItems: "center", justifyContent: "center", gap: 4 }, grip: { width: 34, height: 3, borderRadius: 2, backgroundColor: colors.lightBlue }, label: { color: colors.surface, fontSize: 12, fontWeight: "700" }, body: { flex: 1 }, hidden: { height: 0, overflow: "hidden" } });
