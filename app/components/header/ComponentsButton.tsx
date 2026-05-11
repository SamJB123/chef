import { useCallback, useMemo, useState } from 'react';
import { useStore } from '@nanostores/react';
import * as Popover from '@radix-ui/react-popover';
import { LayersIcon } from '@radix-ui/react-icons';
import { useMutation } from 'convex/react';
import { api } from '@convex/_generated/api';
import { Button } from '@ui/Button';
import { Checkbox } from '@ui/Checkbox';
import { toast } from 'sonner';
import { useChatId } from '~/lib/stores/chatId';
import { useConvexSessionIdOrNullOrLoading } from '~/lib/stores/sessionId';
import {
  componentAuthoringEnabledStore,
  enabledComponentsStore,
  setComponentAuthoringEnabled,
  setEnabledComponents,
} from '~/lib/stores/enabledComponents';
import {
  componentRegistry,
  type ComponentEntry,
} from 'chef-agent/prompts/components/registry';

type Grouped = { tag: string; entries: ComponentEntry[] };

function groupRegistryByTag(): Grouped[] {
  const groups = new Map<string, ComponentEntry[]>();
  for (const entry of componentRegistry) {
    const tag = entry.tags[0] ?? 'other';
    if (!groups.has(tag)) groups.set(tag, []);
    groups.get(tag)!.push(entry);
  }
  return Array.from(groups.entries())
    .map(([tag, entries]) => ({
      tag,
      entries: entries.sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.tag.localeCompare(b.tag));
}

const TAG_LABEL: Record<string, string> = {
  ai: 'AI & RAG',
  async: 'Background work',
  auth: 'Authentication',
  collaboration: 'Collaboration',
  data: 'Data',
  editor: 'Editors',
  email: 'Email',
  hosting: 'Hosting',
  integration: 'Integrations',
  performance: 'Performance',
  realtime: 'Realtime',
  reliability: 'Reliability',
  security: 'Rate limiting & security',
  storage: 'Storage',
  streaming: 'Streaming',
  other: 'Other',
};

function isChatNotFound(e: unknown): boolean {
  const message = e instanceof Error ? e.message : String(e);
  return message.toLowerCase().includes('not found');
}

export function ComponentsButton() {
  const [isOpen, setIsOpen] = useState(false);
  const enabled = useStore(enabledComponentsStore);
  const authoring = useStore(componentAuthoringEnabledStore);
  const chatId = useChatId();
  const sessionId = useConvexSessionIdOrNullOrLoading();
  const persistEnabled = useMutation(api.messages.setEnabledComponents);
  const persistAuthoring = useMutation(api.messages.setComponentAuthoringEnabled);

  const grouped = useMemo(() => groupRegistryByTag(), []);
  const enabledCount = enabled.size;

  const toggleComponent = useCallback(
    async (key: string, next: boolean) => {
      const updated = new Set(enabled);
      if (next) updated.add(key);
      else updated.delete(key);
      // Optimistic store update — the nanostore is the authoritative
      // client-side source. The mutation is best-effort persistence; for
      // fresh chats with no row yet, initializeChat will pick up the value.
      setEnabledComponents(updated);
      if (!sessionId) return;
      try {
        await persistEnabled({
          id: chatId,
          sessionId,
          enabledComponents: Array.from(updated),
        });
      } catch (e) {
        if (isChatNotFound(e)) return;
        setEnabledComponents(enabled);
        toast.error('Failed to save component settings. Please try again.');
        console.error(e);
      }
    },
    [chatId, enabled, persistEnabled, sessionId],
  );

  const toggleAuthoring = useCallback(
    async (next: boolean) => {
      setComponentAuthoringEnabled(next);
      if (!sessionId) return;
      try {
        await persistAuthoring({
          id: chatId,
          sessionId,
          enabled: next,
        });
      } catch (e) {
        if (isChatNotFound(e)) return;
        setComponentAuthoringEnabled(authoring);
        toast.error('Failed to save authoring setting. Please try again.');
        console.error(e);
      }
    },
    [authoring, chatId, persistAuthoring, sessionId],
  );

  const tipParts: string[] = [];
  if (enabledCount > 0) tipParts.push(`${enabledCount} component${enabledCount === 1 ? '' : 's'} enabled`);
  if (authoring) tipParts.push('authoring on');
  const tip = tipParts.length > 0 ? `Convex components (${tipParts.join(', ')})` : 'Convex components';

  return (
    <Popover.Root open={isOpen} onOpenChange={setIsOpen}>
      <Popover.Trigger asChild>
        <Button variant="neutral" inline focused={isOpen} tip={tip}>
          <div className="text-lg">
            <LayersIcon className="size-4" />
          </div>
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="z-50 w-[460px] animate-fadeInFromLoading rounded-md border bg-bolt-elements-background-depth-1 shadow-lg"
          sideOffset={5}
          align="end"
        >
          <div className="border-b p-4">
            <h2 className="text-sm font-semibold text-content-primary">Convex Components</h2>
            <p className="mt-1 text-xs text-content-secondary">
              Two independent settings. Off-the-shelf components are the published packages from{' '}
              <code className="font-mono">@convex-dev/*</code>; authoring lets Chef create your own local
              components for module-level isolation. Both default to off.
            </p>
          </div>

          {/* Authoring toggle */}
          <section className="border-b p-3">
            <label className="flex cursor-pointer items-start gap-2 rounded p-2 hover:bg-bolt-elements-background-depth-2">
              <Checkbox
                id="component-authoring"
                checked={authoring}
                onChange={(e) => {
                  const target = e.target as HTMLInputElement;
                  void toggleAuthoring(target.checked);
                }}
              />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-content-primary">
                  Allow authoring new local components
                </div>
                <p className="mt-0.5 text-xs text-content-secondary">
                  Lets Chef scaffold custom components under{' '}
                  <code className="font-mono">convex/components/&lt;name&gt;/</code> with their own schema and
                  sub-transactions. Useful for organizing larger apps as isolated modules.
                </p>
              </div>
            </label>
          </section>

          {/* Off-the-shelf components */}
          <div className="border-b p-3">
            <h3 className="px-2 text-sm font-medium text-content-primary">Use off-the-shelf components</h3>
            <p className="mt-0.5 px-2 text-xs text-content-secondary">
              Tick a published component to make Chef install and use it via{' '}
              <code className="font-mono">installComponent</code>.
            </p>
          </div>
          <div className="max-h-[55vh] overflow-auto p-2">
            {grouped.map(({ tag, entries }) => (
              <section key={tag} className="mb-3 last:mb-0">
                <h3 className="px-2 pb-1 text-xs font-medium uppercase tracking-wide text-content-secondary">
                  {TAG_LABEL[tag] ?? tag}
                </h3>
                <ul className="space-y-0.5">
                  {entries.map((entry) => {
                    const checked = enabled.has(entry.key);
                    return (
                      <li key={entry.key}>
                        <label className="flex cursor-pointer items-start gap-2 rounded p-2 hover:bg-bolt-elements-background-depth-2">
                          <Checkbox
                            id={`component-${entry.key}`}
                            checked={checked}
                            onChange={(e) => {
                              const target = e.target as HTMLInputElement;
                              void toggleComponent(entry.key, target.checked);
                            }}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline gap-2">
                              <span className="text-sm font-medium text-content-primary">{entry.name}</span>
                              <span className="truncate font-mono text-xs text-content-secondary">
                                {entry.npmPackage}
                              </span>
                              {entry.curated ? (
                                <span className="rounded bg-bolt-elements-background-depth-3 px-1 text-[10px] uppercase text-content-secondary">
                                  curated
                                </span>
                              ) : null}
                            </div>
                            <p className="mt-0.5 text-xs text-content-secondary">{entry.description}</p>
                            {entry.homepage ? (
                              <a
                                href={entry.homepage}
                                target="_blank"
                                rel="noreferrer noopener"
                                className="text-xs text-blue-500 hover:text-blue-600"
                                onClick={(e) => e.stopPropagation()}
                              >
                                README on GitHub →
                              </a>
                            ) : null}
                          </div>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
          <Popover.Arrow className="fill-border-transparent" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
