import { registerRootComponent } from 'expo';

// Registers the AI background trading task definition. Must run unconditionally at module scope,
// every time the JS bundle loads — including a headless background launch with no UI mounted.
import './src/ai/backgroundTask';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
