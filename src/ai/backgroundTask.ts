import * as TaskManager from 'expo-task-manager';
import * as BackgroundTask from 'expo-background-task';
import { getProfiles } from '../db/database';
import { runAiTradingRound } from './aiTrader';

export const AI_BACKGROUND_TASK_NAME = 'ai-trader-background-round';

/**
 * Defined at module scope (not inside any component) because TaskManager needs this registered
 * every time the JS bundle loads, including a headless background launch with no UI mounted.
 * This file must be imported unconditionally from the app's entry point for that to happen.
 */
TaskManager.defineTask(AI_BACKGROUND_TASK_NAME, async () => {
  try {
    const profiles = await getProfiles();
    const aiManagedProfiles = profiles.filter((p) => p.isAiManaged);
    for (const profile of aiManagedProfiles) {
      try {
        await runAiTradingRound(profile.id);
      } catch {
        // one save's round failing shouldn't stop the others from getting theirs
      }
    }
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (e) {
    console.error('AI background trading task failed:', e);
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function isBackgroundTradingEnabled(): Promise<boolean> {
  return TaskManager.isTaskRegisteredAsync(AI_BACKGROUND_TASK_NAME);
}

/**
 * Registers the background task with Android's WorkManager (via expo-background-task). The OS
 * treats minimumIntervalMinutes as a floor, not a schedule — actual runs can be delayed well
 * beyond it depending on battery state, Doze mode, and whether the app has been force-stopped.
 */
export async function enableBackgroundTrading(minimumIntervalMinutes = 15): Promise<void> {
  await BackgroundTask.registerTaskAsync(AI_BACKGROUND_TASK_NAME, { minimumInterval: minimumIntervalMinutes });
}

export async function disableBackgroundTrading(): Promise<void> {
  await BackgroundTask.unregisterTaskAsync(AI_BACKGROUND_TASK_NAME);
}
