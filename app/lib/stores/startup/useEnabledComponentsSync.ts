import { useEffect } from 'react';
import { useQuery } from 'convex/react';
import { api } from '@convex/_generated/api';
import { useConvexSessionIdOrNullOrLoading } from '~/lib/stores/sessionId';
import {
  setComponentAuthoringEnabled,
  setEnabledComponents,
} from '~/lib/stores/enabledComponents';

/**
 * Mirrors the current chat's component-configuration fields into the
 * nanostores so action-runner and the Components dialog see live values.
 * Resets to opt-in defaults when no chat is loaded.
 */
export function useEnabledComponentsSync(chatId: string | undefined) {
  const sessionId = useConvexSessionIdOrNullOrLoading();
  const chat = useQuery(
    api.messages.get,
    chatId && sessionId ? { id: chatId, sessionId } : 'skip',
  );
  useEffect(() => {
    if (chat === undefined) return; // still loading
    setEnabledComponents(chat?.enabledComponents ?? []);
    setComponentAuthoringEnabled(chat?.componentAuthoringEnabled ?? false);
  }, [chat]);
}
