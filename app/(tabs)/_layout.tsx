import { Tabs } from "expo-router";

export default function TabLayout() {
  return (
    <Tabs>
      <Tabs.Screen
        name="index"
        options={{ title: "Home" }}
      />
      <Tabs.Screen
        name="split"
        options={{ title: "Split" }}
      />
      <Tabs.Screen
        name="stats"
        options={{ title: "Stats" }}
      />
    </Tabs>
  );
}