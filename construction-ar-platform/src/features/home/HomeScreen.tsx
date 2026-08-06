import { StyleSheet, Text, View } from "react-native";

import { mvpModules } from "./moduleRegistry";
import { colors } from "../../theme/colors";

export function HomeScreen() {
  return (
    <View style={styles.screen}>
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>Construction AR Platform</Text>
        <Text style={styles.title}>MVP application shell</Text>
        <Text style={styles.copy}>
          This scaffold is intentionally feature-free. It opens the app and
          establishes the module boundaries we will build into next.
        </Text>
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Planned MVP modules</Text>
        <View style={styles.moduleList}>
          {mvpModules.map((module) => (
            <View key={module.name} style={styles.moduleCard}>
              <Text style={styles.moduleName}>{module.name}</Text>
              <Text style={styles.moduleDescription}>
                {module.description}
              </Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    gap: 24,
    justifyContent: "center",
  },
  hero: {
    gap: 12,
    padding: 24,
    borderRadius: 28,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: colors.accent,
  },
  title: {
    fontSize: 34,
    lineHeight: 40,
    fontWeight: "800",
    color: colors.text,
  },
  copy: {
    fontSize: 16,
    lineHeight: 24,
    color: colors.muted,
  },
  panel: {
    gap: 16,
  },
  panelTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.text,
  },
  moduleList: {
    gap: 12,
  },
  moduleCard: {
    padding: 18,
    borderRadius: 22,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  moduleName: {
    fontSize: 17,
    fontWeight: "700",
    color: colors.text,
    marginBottom: 6,
  },
  moduleDescription: {
    fontSize: 14,
    lineHeight: 21,
    color: colors.muted,
  },
});

