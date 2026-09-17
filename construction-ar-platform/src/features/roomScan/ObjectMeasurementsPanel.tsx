import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { RoomCapture } from "../../domain/projects";
import type { LengthUnit } from "../../domain/spatial";
import { formatObjectMeasurementDetails, measurementsForScannedObject } from "../../domain/scannedObjects";
import { colors } from "../../theme/colors";

export function ObjectMeasurementsPanel({ room, selectedInstanceId, onSelectInstance }: {
  room?: RoomCapture;
  selectedInstanceId?: string;
  onSelectInstance?: (id: string) => void;
}) {
  const [unit, setUnit] = useState<LengthUnit>("m");
  const scan = room?.roomScan;
  if (!room || !scan?.objectTypes?.length) return null;
  return <View style={styles.panel}>
    <Text style={styles.title}>Object measurements · {room.name}</Text>
    <View style={styles.buttons}>{(["m", "ft", "in"] as const).map(value => <Pressable
      key={value} accessibilityRole="button" accessibilityLabel={`Object measurements in ${value}`} accessibilityState={{ selected: unit === value }}
      onPress={() => setUnit(value)} style={[styles.button, unit === value && styles.selected]}>
      <Text style={styles.buttonText}>{value}</Text>
    </Pressable>)}</View>
    <Text style={styles.helper}>Local W × D × H. Areas and volume are bounding-box estimates per object. Unknown means missing geometry or insufficient confidence.</Text>
    {scan.objectTypes.map(type => {
      const instances = scan.elements.filter(element => element.objectTypeId === type.id);
      const selected = instances.find(element => element.id === selectedInstanceId);
      const measurements = selected ? measurementsForScannedObject(selected, scan) : type;
      return <View key={type.id} style={styles.object}>
        <Text style={styles.title}>{type.category.replace(/-/g, " ")} · Quantity: {type.quantity}</Text>
        {type.quantity > 1 && <Text style={styles.helper}>{selected ? `Selected instance ${instances.indexOf(selected) + 1}` : "Representative instance dimensions; individual captured sizes are retained."}</Text>}
        <Text style={styles.values}>{formatObjectMeasurementDetails(measurements, unit)}</Text>
        {onSelectInstance && <View style={styles.buttons}>{instances.map((instance, index) => <Pressable
          key={instance.id} accessibilityRole="button" accessibilityState={{ selected: selectedInstanceId === instance.id }}
          onPress={() => onSelectInstance(instance.id)} style={[styles.button, selectedInstanceId === instance.id && styles.selected]}>
          <Text style={styles.buttonText}>Instance {index + 1}</Text>
        </Pressable>)}</View>}
      </View>;
    })}
  </View>;
}

const styles = StyleSheet.create({
  panel: { gap: 10, padding: 13, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  title: { color: colors.text, fontSize: 14, fontWeight: "700" },
  helper: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  values: { color: colors.text, fontSize: 13, lineHeight: 21 },
  object: { borderTopWidth: 1, borderColor: colors.border, paddingTop: 10, gap: 6 },
  buttons: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  button: { borderWidth: 1, borderColor: colors.border, padding: 8, backgroundColor: colors.surface },
  selected: { borderColor: colors.accent, backgroundColor: colors.lightBlue },
  buttonText: { color: colors.text, fontSize: 12, fontWeight: "700" },
});
