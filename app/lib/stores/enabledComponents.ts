import { atom } from 'nanostores';

/**
 * The set of component registry keys the user has enabled for the current
 * chat. Read by action-runner.ts when executing the `lookupDocs` and
 * `installComponent` tools. Written by the UI dialog after the user toggles
 * components on/off (which also persists to the chat row in Convex).
 *
 * Default is an empty set (opt-in model — new chats see no components until
 * the user enables them).
 */
export const enabledComponentsStore = atom<ReadonlySet<string>>(new Set());

export function setEnabledComponents(keys: Iterable<string>): void {
  enabledComponentsStore.set(new Set(keys));
}

/**
 * Whether the model is allowed to author new local Convex components for the
 * current chat. Independent from `enabledComponentsStore` — see the chat
 * schema for the full rationale. Default false (opt-in).
 */
export const componentAuthoringEnabledStore = atom<boolean>(false);

export function setComponentAuthoringEnabled(enabled: boolean): void {
  componentAuthoringEnabledStore.set(enabled);
}
