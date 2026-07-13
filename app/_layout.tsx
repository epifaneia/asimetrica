import { GlobalVoiceChrome } from '@/components/global-voice-chrome';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import 'react-native-reanimated';
import { View } from 'react-native';

WebBrowser.maybeCompleteAuthSession();

export default function RootLayout() {
  return (
    <View style={{ flex: 1 }}>
      <Stack>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="settings" options={{ headerShown: false }} />
        <Stack.Screen name="folder/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="document/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="diagnostico" options={{ headerShown: false }} />
        <Stack.Screen name="search" options={{ headerShown: false }} />
      </Stack>
      <GlobalVoiceChrome />
      <StatusBar style="light" />
    </View>
  );
}
