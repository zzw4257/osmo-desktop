import { STORE_LIBRARY, idbGet, idbPut } from "../store/idb";

const ONBOARDED_KEY = "onboarded";

export async function hasSeenOnboarding(): Promise<boolean> {
  return (await idbGet<boolean>(STORE_LIBRARY, ONBOARDED_KEY)) === true;
}

export async function markOnboardingSeen(): Promise<void> {
  await idbPut(STORE_LIBRARY, ONBOARDED_KEY, true);
}
