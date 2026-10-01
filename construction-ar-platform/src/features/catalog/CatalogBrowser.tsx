import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { starterCatalog } from "../../domain/catalog";
import { catalogCategoryLabels, searchCatalog } from "../../domain/catalogSearch";
import type { ObjectCategory } from "../../domain/projects";
import { colors } from "../../theme/colors";

/** One catalog-selection flow shared by the dashboard and AR workspace. */
export function CatalogBrowser({ selectedId, onSelect, compact = false }: { selectedId?: string; onSelect: (id: string) => void; compact?: boolean }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<ObjectCategory>();
  const categories = useMemo(() => [...new Set(starterCatalog.map(item => item.category))], []);
  const matches = useMemo(() => searchCatalog(starterCatalog, query, category), [query, category]);
  const selected = starterCatalog.find(item => item.id === selectedId);
  return <View style={styles.browser}>
    <TextInput accessibilityLabel="Search catalog" placeholder="Search products, trade or SKU" placeholderTextColor={colors.muted} value={query} onChangeText={setQuery} style={styles.search} autoCorrect={false} returnKeyType="search" />
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} keyboardShouldPersistTaps="handled">
      <Pressable accessibilityRole="button" accessibilityState={{ selected: !category }} onPress={() => setCategory(undefined)} style={[styles.chip, !category && styles.selected]}><Text style={styles.copy}>All trades</Text></Pressable>
      {categories.map(value => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: category === value }} onPress={() => setCategory(value)} style={[styles.chip, category === value && styles.selected]}><Text style={styles.copy}>{catalogCategoryLabels[value]}</Text></Pressable>)}
    </ScrollView>
    <Text style={styles.muted} accessibilityLiveRegion="polite">{matches.length} {matches.length === 1 ? "product" : "products"}{category ? ` · ${catalogCategoryLabels[category]}` : ""}</Text>
    {matches.length === 0 ? <View style={styles.browser}>
      <Text style={styles.copy}>No products match. Try another term or trade.</Text>
      <Pressable accessibilityRole="button" onPress={() => { setQuery(""); setCategory(undefined); }} style={styles.chip}><Text style={styles.copy}>Clear catalog filters</Text></Pressable>
    </View> : <ScrollView horizontal={compact} nestedScrollEnabled style={!compact ? styles.results : undefined} contentContainerStyle={compact ? styles.row : styles.browser} keyboardShouldPersistTaps="handled">
      {matches.map(item => <Pressable accessibilityRole="button" accessibilityLabel={`Select ${item.name}`} accessibilityState={{ selected: item.id === selectedId }} key={item.id} onPress={() => onSelect(item.id)} style={[styles.item, compact && styles.compactItem, item.id === selectedId && styles.selected]}>
        <Text style={styles.name}>{item.name}</Text><Text style={styles.muted}>{catalogCategoryLabels[item.category]} · {item.sku}</Text>
      </Pressable>)}
    </ScrollView>}
    {selected && <View style={styles.detail}>
      <Text style={styles.name}>Selected: {selected.name}</Text>
      <Text style={styles.copy}>Width {selected.defaultDimensions.width} × height {selected.defaultDimensions.height} × depth {selected.defaultDimensions.depth} {selected.defaultDimensions.unit}</Text>
      <Text style={styles.muted}>{selected.placementMode === "free-place" ? "Free placement" : `Mounting: ${selected.allowedSurfaceKinds.join(" or ")}`}</Text>
      {!!selected.description && <Text style={styles.muted}>{selected.description}</Text>}
      <Text style={styles.muted}>Generic planning representation. Confirm the actual product's dimensions before installation.</Text>
    </View>}
  </View>;
}
const styles = StyleSheet.create({
  browser: { gap: 10 }, row: { gap: 8 }, results: { maxHeight: 280 },
  search: { borderColor: colors.border, borderWidth: 1, backgroundColor: colors.surface, color: colors.text, padding: 12, fontSize: 14 },
  chip: { borderColor: colors.border, borderWidth: 1, backgroundColor: colors.surface, padding: 10 },
  item: { borderColor: colors.border, borderWidth: 1, backgroundColor: colors.surface, padding: 12, gap: 4 },
  compactItem: { width: 185 }, selected: { borderColor: colors.accent, borderWidth: 2 },
  detail: { borderLeftColor: colors.accent, borderLeftWidth: 3, paddingLeft: 12, gap: 6 },
  name: { color: colors.text, fontSize: 14, fontWeight: "700" }, copy: { color: colors.text, fontSize: 13 }, muted: { color: colors.muted, fontSize: 12 },
});
