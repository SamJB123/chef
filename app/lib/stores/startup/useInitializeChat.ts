import { selectedTeamSlugStore, waitForSelectedTeamSlug } from '~/lib/stores/convexTeams';

import { useConvex } from 'convex/react';
import { getConvexAuthToken, waitForConvexSessionId } from '~/lib/stores/sessionId';
import { useCallback } from 'react';
import { api } from '@convex/_generated/api';
import { useChefAuth } from '~/components/chat/ChefAuthWrapper';
import { ContainerBootState, waitForBootStepCompleted } from '~/lib/stores/containerBootState';
import { toast } from 'sonner';
import { waitForConvexProjectConnection } from '~/lib/stores/convexProject';
import { useAuth } from '@workos-inc/authkit-react';
import { componentAuthoringEnabledStore, enabledComponentsStore } from '~/lib/stores/enabledComponents';

const CREATE_PROJECT_TIMEOUT = 15000;

export function useHomepageInitializeChat(chatId: string, setChatInitialized: (chatInitialized: boolean) => void) {
  const convex = useConvex();
  const { signIn } = useAuth();
  const chefAuthState = useChefAuth();
  const isFullyLoggedIn = chefAuthState.kind === 'fullyLoggedIn';
  return useCallback(async () => {
    if (!isFullyLoggedIn) {
      signIn();
      return false;
    }
    const sessionId = await waitForConvexSessionId('useInitializeChat');
    const selectedTeamSlug = selectedTeamSlugStore.get();
    if (selectedTeamSlug === null) {
      // If the user hasn't selected a team, don't initialize the chat.
      return false;
    }

    const workosAccessToken = getConvexAuthToken(convex);
    if (!workosAccessToken) {
      console.error('No WorkOS access token');
      toast.error('Unexpected error creating chat');
      return false;
    }
    const teamSlug = await waitForSelectedTeamSlug('useInitializeChat');

    const projectInitParams = {
      teamSlug,
      workosAccessToken,
    };

    // Initialize the chat and start project creation. Pass any component
    // selections the user made before sending their first message so they're
    // persisted to the chat row atomically with creation (avoids a race with
    // useEnabledComponentsSync overwriting the store).
    const pendingComponents = Array.from(enabledComponentsStore.get());
    const pendingAuthoring = componentAuthoringEnabledStore.get();
    await convex.mutation(api.messages.initializeChat, {
      id: chatId,
      sessionId,
      projectInitParams,
      enabledComponents: pendingComponents.length > 0 ? pendingComponents : undefined,
      componentAuthoringEnabled: pendingAuthoring ? true : undefined,
    });

    try {
      // Wait for the Convex project to be successfully created before allowing chat to start
      await Promise.race([
        waitForConvexProjectConnection(),
        new Promise((_, reject) => {
          setTimeout(() => {
            reject(new Error('Connection timeout'));
          }, CREATE_PROJECT_TIMEOUT);
        }),
      ]);
      setChatInitialized(true);
    } catch (error) {
      console.error('Failed to create Convex project:', error);
      if (error instanceof Error && error.message === 'Connection timeout') {
        toast.error('Connection timed out. Please try again.');
      } else {
        toast.error('Failed to create Convex project. Please try again.');
      }
      return false;
    }

    // Wait for the WebContainer to have its snapshot loaded before sending a message.
    await waitForBootStepCompleted(ContainerBootState.LOADING_SNAPSHOT);
    return true;
  }, [convex, chatId, isFullyLoggedIn, setChatInitialized, signIn]);
}

export function useExistingInitializeChat(chatId: string) {
  const convex = useConvex();
  return useCallback(async () => {
    const sessionId = await waitForConvexSessionId('useInitializeChat');
    const teamSlug = await waitForSelectedTeamSlug('useInitializeChat');
    const workosAccessToken = getConvexAuthToken(convex);
    if (!workosAccessToken) {
      console.error('No WorkOS access token');
      toast.error('Unexpected error creating chat');
      return false;
    }
    const projectInitParams = {
      teamSlug,
      workosAccessToken,
    };
    await convex.mutation(api.messages.initializeChat, {
      id: chatId,
      sessionId,
      projectInitParams,
    });

    // We don't need to wait for container boot here since we don't mount
    // the UI until it's fully ready.
    return true;
  }, [convex, chatId]);
}
