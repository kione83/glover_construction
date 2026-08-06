import { SafeAreaView, ScrollView, StyleSheet, View } from "react-native";

import { HomeScreen } from "../features/home/HomeScreen";
import { colors } from "../theme/colors";

export function AppShell() {
  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.canvas}>
          <HomeScreen />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flexGrow: 1,
  },
  canvas: {
    flex: 1,
    padding: 24,
  },
});

