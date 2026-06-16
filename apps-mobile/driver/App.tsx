import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { ActivityIndicator, Button, StyleSheet, Text, TextInput, View } from "react-native";

import { authClient } from "./src/auth";

// D1 (ADR-0034): driver login + identity. When unauthenticated, show a login
// form; once signed in, show the driver's email + role. The session is fetched
// from the server using the bearer token the Expo client stores in
// expo-secure-store — that round-trip IS the D1 proof (login → token → the
// server resolves the session → the RBAC role comes back). Trip/fuel/GPS arrive
// in D2+; this slice only proves a driver can authenticate against the API.
export default function App() {
  const { data: session, isPending } = authClient.useSession();

  let body;
  if (isPending) {
    body = <ActivityIndicator accessibilityLabel="Loading" />;
  } else if (session) {
    body = <SignedIn email={session.user.email} role={session.user.role} />;
  } else {
    body = <LoginForm />;
  }

  return (
    <View style={styles.container}>
      {body}
      <StatusBar style="auto" />
    </View>
  );
}

function SignedIn({ email, role }: { email: string; role?: string | null }) {
  return (
    <View style={styles.panel}>
      <Text style={styles.title}>Signed in</Text>
      <Text style={styles.email}>{email}</Text>
      <Text style={styles.role}>{role ?? "—"}</Text>
      <Button title="Sign out" onPress={() => void authClient.signOut()} />
    </View>
  );
}

function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    const result = await authClient.signIn.email({ email: email.trim(), password });
    if (result.error) {
      setError(result.error.message ?? "Sign-in failed.");
    }
    setBusy(false);
  }

  return (
    <View style={styles.panel}>
      <Text style={styles.title}>FleetCo Driver</Text>
      <TextInput
        style={styles.input}
        placeholder="Email"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button
        title={busy ? "Signing in…" : "Sign in"}
        onPress={() => void submit()}
        disabled={busy}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  panel: {
    width: "100%",
    maxWidth: 360,
    gap: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: "600",
    textAlign: "center",
  },
  email: {
    fontSize: 16,
    textAlign: "center",
  },
  role: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
  },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  error: {
    color: "#b00020",
    textAlign: "center",
  },
});
