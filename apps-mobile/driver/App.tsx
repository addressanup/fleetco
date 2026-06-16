import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';

import { driverGreeting } from './src/greeting';

export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{driverGreeting()}</Text>
      <Text style={styles.subtitle}>D0 — toolchain spike (ADR-0033)</Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
  },
  subtitle: {
    marginTop: 8,
    color: '#666',
  },
});
