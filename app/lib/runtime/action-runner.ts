import type { WebContainer } from '@webcontainer/api';
import { path as nodePath } from 'chef-agent/utils/path';
import { atom, map, type MapStore, type WritableAtom } from 'nanostores';
import type { ActionAlert, FileHistory } from '~/types/actions';
import { createScopedLogger } from 'chef-agent/utils/logger';
import { unreachable } from 'chef-agent/utils/unreachable';
import type { ActionCallbackData } from 'chef-agent/message-parser';
import { getToolName } from 'ai';
import type { ConvexToolInvocation } from '~/lib/common/types';
import { viewParameters } from 'chef-agent/tools/view';
import { renderDirectory } from 'chef-agent/utils/renderDirectory';
import { renderFile } from 'chef-agent/utils/renderFile';
import { readPath, workDirRelative } from '~/utils/fileUtils';
import { ContainerBootState, waitForContainerBootState } from '~/lib/stores/containerBootState';
import { npmInstallToolParameters } from 'chef-agent/tools/npmInstall';
import { workbenchStore } from '~/lib/stores/workbench.client';
import { z } from 'zod';
import { editToolParameters } from 'chef-agent/tools/edit';
import { getAbsolutePath } from 'chef-agent/utils/workDir';
import { cleanConvexOutput } from 'chef-agent/utils/shell';
import type { BoltAction } from 'chef-agent/types';
import type { BoltShell } from '~/utils/shell';
import { streamOutput } from '~/utils/process';
import { outputLabels, type OutputLabels } from '~/lib/runtime/deployToolOutputLabels';
import type { ConvexToolName } from '~/lib/common/types';
import { lookupDocsParameters, resolveLookupDoc } from 'chef-agent/tools/lookupDocs';
import { installComponentParameters } from 'chef-agent/tools/installComponent';
import { scaffoldLocalComponentParameters } from 'chef-agent/tools/scaffoldLocalComponent';
import { componentByKey, componentImportIdentifier } from 'chef-agent/prompts/components/registry';
import { addComponentToConfig } from 'chef-agent/utils/convexConfig';
import { enabledComponentsStore } from '~/lib/stores/enabledComponents';
import { addEnvironmentVariablesParameters } from 'chef-agent/tools/addEnvironmentVariables';
import { openDashboardToPath } from '~/lib/stores/dashboardPath';
import { convexProjectStore } from '~/lib/stores/convexProject';

const logger = createScopedLogger('ActionRunner');

export type ActionStatus = 'pending' | 'running' | 'complete' | 'aborted' | 'failed';

type BaseActionState = BoltAction & {
  status: Exclude<ActionStatus, 'failed'>;
  abort: () => void;
  executed: boolean;
  abortSignal: AbortSignal;
};

type FailedActionState = BoltAction &
  Omit<BaseActionState, 'status'> & {
    status: Extract<ActionStatus, 'failed'>;
    error: string;
  };

export type ActionState = (BaseActionState | FailedActionState) & { isEdit?: boolean };

type BaseActionUpdate = Partial<Pick<BaseActionState, 'status' | 'abort' | 'executed' | 'content'>>;

type ActionStateUpdate =
  | BaseActionUpdate
  | (Omit<BaseActionUpdate, 'status'> & { status: 'failed'; error: string })
  | Pick<BaseActionState & { type: 'convex' }, 'output'>;

type ActionsMap = MapStore<Record<string, ActionState>>;

class ActionCommandError extends Error {
  readonly _output: string;
  readonly _header: string;

  constructor(message: string, output: string) {
    // Create a formatted message that includes both the error message and output
    const formattedMessage = `Failed To Execute Shell Command: ${message}\n\nOutput:\n${output}`;
    super(formattedMessage);

    // Set the output separately so it can be accessed programmatically
    this._header = message;
    this._output = output;

    // Maintain proper prototype chain
    Object.setPrototypeOf(this, ActionCommandError.prototype);

    // Set the name of the error for better debugging
    this.name = 'ActionCommandError';
  }

  // Optional: Add a method to get just the terminal output
  get output() {
    return this._output;
  }
  get header() {
    return this._header;
  }
}

export class ActionRunner {
  #webcontainer: Promise<WebContainer>;
  #currentExecutionPromise: Promise<void> = Promise.resolve();
  #shellTerminal: BoltShell;
  #previousToolCalls: Map<string, { toolName: string; args: any }> = new Map();
  runnerId = atom<string>(`${Date.now()}`);
  actions: ActionsMap = map({});
  onAlert?: (alert: ActionAlert) => void;
  buildOutput?: { path: string; exitCode: number; output: string };
  terminalOutput: WritableAtom<string> = atom('');
  onToolCallComplete: (args: {
    kind: 'success' | 'error';
    result: string;
    toolCallId: string;
    toolName: string;
  }) => void;
  constructor(
    webcontainerPromise: Promise<WebContainer>,
    shellTerminal: BoltShell,
    callbacks: {
      onAlert?: (alert: ActionAlert) => void;
      onToolCallComplete: (args: {
        kind: 'success' | 'error';
        result: string;
        toolCallId: string;
        toolName: string;
      }) => void;
    },
  ) {
    this.#webcontainer = webcontainerPromise;
    this.#shellTerminal = shellTerminal;
    this.onAlert = callbacks.onAlert;
    this.onToolCallComplete = callbacks.onToolCallComplete;
  }

  addAction(data: ActionCallbackData) {
    const { actionId } = data;

    const actions = this.actions.get();
    const action = actions[actionId];

    if (action) {
      if (action.content !== data.action.content) {
        this.updateAction(actionId, { ...action, content: data.action.content });
      }
      return;
    }

    const abortController = new AbortController();

    if (data.action.type === 'file') {
      const files = workbenchStore.files.get();
      const absPath = getAbsolutePath(data.action.filePath);
      const existing = !!files[absPath];
      data.action.isEdit = existing;
    }

    this.actions.setKey(actionId, {
      ...data.action,
      status: 'pending',
      executed: false,
      abort: () => {
        abortController.abort();
        this.updateAction(actionId, { status: 'aborted' });
      },
      abortSignal: abortController.signal,
    });

    this.#currentExecutionPromise.then(() => {
      this.updateAction(actionId, { status: 'running' });
    });
  }

  async runAction(data: ActionCallbackData, args: { isStreaming: boolean }) {
    const { actionId } = data;
    const action = this.actions.get()[actionId];

    if (!action) {
      unreachable(`Action ${actionId} not found`);
    }

    if (action.executed) {
      return; // No return value here
    }

    if (args.isStreaming && action.type !== 'file') {
      return; // No return value here
    }

    // Check for duplicate tool calls
    if (action.type === 'toolUse') {
      const parsed = action.parsedContent;
      if (parsed.state === 'input-available') {
        const key = `${getToolName(parsed)}:${JSON.stringify(parsed.input)}`;
        const previousCall = this.#previousToolCalls.get(key);
        if (previousCall) {
          this.onToolCallComplete({
            kind: 'error',
            result: 'Error: This exact action was already executed. Please try a different approach.',
            toolCallId: parsed.toolCallId,
            toolName: getToolName(parsed) as ConvexToolName,
          });
          return;
        }
        this.#previousToolCalls.set(key, { toolName: getToolName(parsed), args: parsed.input });
      }
    }

    this.updateAction(actionId, { ...action, ...data.action, executed: !args.isStreaming });

    this.#currentExecutionPromise = this.#currentExecutionPromise
      .then(() => {
        return this.#executeAction(actionId, args);
      })
      .catch((error) => {
        console.error('Action failed:', error);
      });

    await this.#currentExecutionPromise;

    return;
  }

  async #executeAction(actionId: string, args: { isStreaming: boolean }) {
    const action = this.actions.get()[actionId];

    this.updateAction(actionId, { status: 'running' });

    try {
      switch (action.type) {
        case 'file': {
          await this.#runFileAction(action);
          break;
        }
        case 'toolUse': {
          await this.#runToolUseAction(actionId, action);
          break;
        }
        default: {
          throw new Error(`Unknown action type: ${JSON.stringify(action)}`);
        }
      }

      this.updateAction(actionId, {
        status: args.isStreaming ? 'running' : action.abortSignal.aborted ? 'aborted' : 'complete',
      });
    } catch (error) {
      if (action.abortSignal.aborted) {
        return;
      }

      this.updateAction(actionId, { status: 'failed', error: 'Action failed' });
      logger.error(`[${action.type}]:Action failed\n\n`, error);

      if (!(error instanceof ActionCommandError)) {
        return;
      }

      this.onAlert?.({
        type: 'error',
        title: 'Dev Server Failed',
        description: error.header,
        content: error.output,
      });

      // re-throw the error to be caught in the promise chain
      throw error;
    }
  }

  async #runFileAction(action: ActionState) {
    if (action.type !== 'file') {
      unreachable('Expected file action');
    }

    const webcontainer = await this.#webcontainer;
    const relativePath = nodePath.relative(webcontainer.workdir, action.filePath);

    let folder = nodePath.dirname(relativePath);

    // remove trailing slashes
    folder = folder.replace(/\/+$/g, '');

    if (folder !== '.') {
      try {
        await webcontainer.fs.mkdir(folder, { recursive: true });
        logger.debug('Created folder', folder);
      } catch (error) {
        logger.error('Failed to create folder\n\n', error);
      }
    }

    try {
      await webcontainer.fs.writeFile(relativePath, action.content);
      logger.debug(`File written ${relativePath}`);
    } catch (error) {
      logger.error('Failed to write file\n\n', error);
    }
  }

  updateAction(id: string, newState: ActionStateUpdate) {
    const actions = this.actions.get();

    this.actions.setKey(id, { ...actions[id], ...newState });
  }

  async getFileHistory(filePath: string): Promise<FileHistory | null> {
    try {
      const webcontainer = await this.#webcontainer;
      const historyPath = this.#getHistoryPath(filePath);
      const content = await webcontainer.fs.readFile(historyPath, 'utf-8');

      return JSON.parse(content);
    } catch (error) {
      logger.error('Failed to get file history:', error);
      return null;
    }
  }

  async saveFileHistory(filePath: string, history: FileHistory) {
    // const webcontainer = await this.#webcontainer;
    const historyPath = this.#getHistoryPath(filePath);

    await this.#runFileAction({
      type: 'file',
      filePath: historyPath,
      content: JSON.stringify(history),
      changeSource: 'auto-save',
    } as any);
  }

  #getHistoryPath(filePath: string) {
    return nodePath.join('.history', filePath);
  }

  async #runToolUseAction(_actionId: string, action: ActionState) {
    if (action.type !== 'toolUse') {
      unreachable('Expected tool use action');
    }

    const parsed: ConvexToolInvocation = action.parsedContent;

    if (parsed.state === 'output-available') {
      return;
    }
    if (parsed.state === 'input-streaming') {
      throw new Error('Tool call is still in progress');
    }

    let result: string;
    try {
      switch (getToolName(parsed)) {
        case 'view': {
          const args = viewParameters.parse(parsed.input);
          const container = await this.#webcontainer;
          const relPath = workDirRelative(args.path);
          const file = await readPath(container, relPath);
          if (file.type === 'directory') {
            result = renderDirectory(file.children);
          } else {
            if (args.view_range && args.view_range.length !== 2) {
              throw new Error('When provided, view_range must be an array of two numbers');
            }
            result = renderFile(file.content, args.view_range as [number, number]);
          }
          break;
        }
        case 'edit': {
          const args = editToolParameters.parse(parsed.input);
          const container = await this.#webcontainer;
          const relPath = workDirRelative(args.path);
          const file = await readPath(container, relPath);
          if (file.type !== 'file') {
            throw new Error('Expected a file');
          }
          let content = file.content;
          const matchPos = content.indexOf(args.old);
          if (matchPos === -1) {
            throw new Error(`Old text not found: ${args.old}`);
          }
          const secondMatchPos = content.indexOf(args.old, matchPos + args.old.length);
          if (secondMatchPos !== -1) {
            throw new Error(`Old text found multiple times: ${args.old}`);
          }
          content = content.replace(args.old, args.new);
          await container.fs.writeFile(relPath, content);
          result = `Successfully edited ${args.path}`;
          break;
        }
        case 'npmInstall': {
          try {
            const args = npmInstallToolParameters.parse(parsed.input);
            const container = await this.#webcontainer;
            await waitForContainerBootState(ContainerBootState.READY);
            const npmInstallProc = await container.spawn('npm', ['install', ...args.packages.split(' ')]);
            action.abortSignal.addEventListener('abort', () => {
              npmInstallProc.kill();
            });
            const { output, exitCode } = await streamOutput(npmInstallProc, {
              onOutput: (output) => {
                this.terminalOutput.set(output);
              },
              debounceMs: 50,
            });
            const cleanedOutput = cleanConvexOutput(output);
            if (exitCode !== 0) {
              throw new Error(`Npm install failed with exit code ${exitCode}: ${cleanedOutput}`);
            }
            result = cleanedOutput;
          } catch (error: unknown) {
            if (error instanceof z.ZodError) {
              result = `Error: Invalid npm install arguments.  ${error}`;
            } else if (error instanceof Error) {
              result = `Error: ${error.message}`;
            } else {
              result = `Error: An unknown error occurred during npm install`;
            }
          }
          break;
        }
        case 'lookupDocs': {
          const args = lookupDocsParameters.parse(parsed.input);
          const allowlist = enabledComponentsStore.get();
          const results: string[] = [];
          for (const key of args.docs) {
            const r = resolveLookupDoc(key, allowlist);
            if (!r.ok) {
              throw new Error(r.error);
            }
            results.push(r.content);
          }
          result = results.join('\n\n');
          break;
        }
        case 'installComponent': {
          try {
            const args = installComponentParameters.parse(parsed.input);
            const allowlist = enabledComponentsStore.get();
            const entry = componentByKey.get(args.key);
            if (!entry) {
              throw new Error(
                `Unknown component "${args.key}". Use one of the keys advertised in the installComponent tool description.`,
              );
            }
            if (!allowlist.has(entry.key)) {
              throw new Error(
                `Component "${entry.key}" is not enabled for this chat. Ask the user to enable it via the Components menu in the chat header.`,
              );
            }

            const container = await this.#webcontainer;
            await waitForContainerBootState(ContainerBootState.READY);

            const installProc = await container.spawn('npm', ['install', entry.npmPackage]);
            action.abortSignal.addEventListener('abort', () => installProc.kill());
            const { output: installOutput, exitCode } = await streamOutput(installProc, {
              onOutput: (output) => this.terminalOutput.set(output),
              debounceMs: 50,
            });
            const cleanedInstall = cleanConvexOutput(installOutput);
            if (exitCode !== 0) {
              throw new Error(`npm install failed with exit code ${exitCode}: ${cleanedInstall}`);
            }

            const identifier = componentImportIdentifier(entry.key);
            const importPath = `${entry.npmPackage}/convex.config.js`;
            const configPath = 'convex/convex.config.ts';
            let existing: string | null = null;
            try {
              existing = await container.fs.readFile(configPath, 'utf-8');
            } catch {
              existing = null;
            }
            const updated = addComponentToConfig(existing, identifier, importPath);
            if (existing !== updated) {
              await container.fs.writeFile(configPath, updated);
            }

            result = [
              `Installed ${entry.npmPackage}.`,
              `Updated ${configPath} to register the component as \`${identifier}\`.`,
              'Next: follow the README from lookupDocs to add any per-component glue files and env vars.',
              cleanedInstall ? `\nnpm install output:\n${cleanedInstall}` : '',
            ]
              .filter(Boolean)
              .join('\n');
          } catch (error: unknown) {
            if (error instanceof z.ZodError) {
              result = `Error: Invalid installComponent arguments. ${error}`;
            } else if (error instanceof Error) {
              result = `Error: ${error.message}`;
            } else {
              result = `Error: An unknown error occurred during installComponent`;
            }
          }
          break;
        }
        case 'scaffoldLocalComponent': {
          try {
            const args = scaffoldLocalComponentParameters.parse(parsed.input);
            const container = await this.#webcontainer;
            await waitForContainerBootState(ContainerBootState.READY);

            const componentDir = `convex/components/${args.name}`;
            // Refuse to overwrite an existing component folder.
            let alreadyExists = false;
            try {
              await container.fs.readdir(componentDir);
              alreadyExists = true;
            } catch {
              // ENOENT — directory doesn't exist, proceed.
            }
            if (alreadyExists) {
              throw new Error(
                `${componentDir}/ already exists. Choose a different name, or edit the existing files via the edit tool.`,
              );
            }

            await container.fs.mkdir(componentDir, { recursive: true });

            const configContent = `import { defineComponent } from "convex/server";

const component = defineComponent("${args.name}");

export default component;
`;
            const schemaContent = `import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// This schema is local to the ${args.name} component. Tables defined here
// are isolated from the parent app and from other components.
export default defineSchema({
  // Example:
  // items: defineTable({
  //   name: v.string(),
  // }),
});
`;
            const indexContent = `import { v } from "convex/values";
import { query } from "./_generated/server";

// Public functions on a component need return validators (otherwise the API
// types degrade to \`any\` at the boundary).
export const hello = query({
  args: {},
  returns: v.string(),
  handler: async () => "hello from ${args.name}",
});
`;
            await container.fs.writeFile(`${componentDir}/convex.config.ts`, configContent);
            await container.fs.writeFile(`${componentDir}/schema.ts`, schemaContent);
            await container.fs.writeFile(`${componentDir}/index.ts`, indexContent);

            // Wire into the parent convex/convex.config.ts.
            const parentConfigPath = 'convex/convex.config.ts';
            let existing: string | null = null;
            try {
              existing = await container.fs.readFile(parentConfigPath, 'utf-8');
            } catch {
              existing = null;
            }
            const updated = addComponentToConfig(
              existing,
              args.name,
              `./components/${args.name}/convex.config.js`,
            );
            if (existing !== updated) {
              await container.fs.writeFile(parentConfigPath, updated);
            }

            result = [
              `Scaffolded local component at ${componentDir}/`,
              '  - convex.config.ts (defineComponent)',
              '  - schema.ts (empty schema; add tables here)',
              '  - index.ts (stub `hello` query)',
              `Registered as \`${args.name}\` in ${parentConfigPath}.`,
              '',
              'Next: define the component schema/functions via edit(); call them',
              `from the app via \`components.${args.name}.<fn>\` after \`npx convex dev\` regenerates the API.`,
            ].join('\n');
          } catch (error: unknown) {
            if (error instanceof z.ZodError) {
              result = `Error: Invalid scaffoldLocalComponent arguments. ${error}`;
            } else if (error instanceof Error) {
              result = `Error: ${error.message}`;
            } else {
              result = `Error: An unknown error occurred during scaffoldLocalComponent`;
            }
          }
          break;
        }
        case 'deploy': {
          const container = await this.#webcontainer;
          await waitForContainerBootState(ContainerBootState.READY);

          result = '';

          const commandErroredController = new AbortController();
          const abortSignal = AbortSignal.any([action.abortSignal, commandErroredController.signal]);

          /** Return a promise of output on success, throws an error containing output on failure. */
          const run = async (
            commandAndArgs: string[],
            errorPrefix: OutputLabels,
            onOutput?: (s: string) => void,
          ): Promise<string> => {
            logger.info('starting to run', errorPrefix);
            const t0 = performance.now();
            const proc = await container.spawn(commandAndArgs[0], commandAndArgs.slice(1));
            const abortListener: () => void = () => proc.kill();
            abortSignal.addEventListener('abort', () => {
              logger.info('aborting', commandAndArgs);
              proc.kill();
            });
            const { output, exitCode } = await streamOutput(proc, { onOutput, debounceMs: 50 });

            const cleanedOutput = cleanConvexOutput(output);
            const time = performance.now() - t0;
            logger.debug('finished', errorPrefix, 'in', Math.round(time));
            if (exitCode !== 0) {
              // Kill all other commands
              commandErroredController.abort(`${errorPrefix}`);
              // This command's output will be reported exclusively
              throw new Error(`[${errorPrefix}] Failed with exit code ${exitCode}: ${cleanedOutput}`);
            }
            abortSignal.removeEventListener('abort', abortListener);
            if (cleanedOutput.trim().length === 0) {
              return '';
            }
            return cleanedOutput + '\n\n';
          };

          //         START         deploy tool call
          //          /
          //         /
          //  codegen              `convex typecheck` includes typecheck of convex/ dir
          // + typecheck
          //       |
          //       |
          // app typecheck         `tsc --noEmit --project tsconfig.app.json
          //         \
          //          \
          //         deploy        `deploy` can fail

          const runCodegenAndTypecheck = async (onOutput?: (output: string) => void) => {
            // Convex codegen does a convex directory typecheck, then tsc does a full-project typecheck.
            let output = await run(['convex', 'codegen'], outputLabels.convexTypecheck, onOutput);
            output += await run(
              ['tsc', '--noEmit', '-p', 'tsconfig.app.json'],
              outputLabels.frontendTypecheck,
              onOutput,
            );
            return output;
          };

          const t0 = performance.now();
          result += await runCodegenAndTypecheck((output) => {
            this.terminalOutput.set(output);
          });
          result += await run(['convex', 'dev', '--once', '--typecheck=disable'], outputLabels.convexDeploy);
          const time = performance.now() - t0;
          logger.info('deploy action finished in', time);

          // Start the default preview if it's not already running
          if (!workbenchStore.isDefaultPreviewRunning()) {
            await this.#shellTerminal.startCommand('vite --open');
            result += '\n\nDev server started successfully!';
          }

          break;
        }
        case 'addEnvironmentVariables': {
          const args = addEnvironmentVariablesParameters.parse(parsed.input);
          const envVarNames = args.envVarNames;
          if (envVarNames.length === 0) {
            result = 'Error: No environment variables to add. Please provide a list of environment variable names.';
            break;
          }
          let path = `settings/environment-variables?var=${envVarNames[0]}`;
          for (const envVarName of envVarNames.slice(1)) {
            path += `&var=${envVarName}`;
          }
          openDashboardToPath(path);
          result = `Opened dashboard to add environment variables: ${envVarNames.join(', ')}\nPlease add the values in the dashboard.`;
          break;
        }
        case 'getConvexDeploymentName': {
          const convexProject = convexProjectStore.get();
          if (!convexProject) {
            result = 'Error: No Convex project is currently connected. Please connect a Convex project first.';
          } else {
            result = convexProject.deploymentName;
            console.log('getConvexDeploymentName tool called, returning:', result);
          }
          break;
        }
        default: {
          throw new Error(`Unknown tool: ${getToolName(parsed)}`);
        }
      }
      this.onToolCallComplete({
        kind: 'success',
        result,
        toolCallId: action.parsedContent.toolCallId,
        toolName: getToolName(parsed),
      });
    } catch (e: any) {
      console.error('Error on tool call', e);
      let message = e.toString();
      if (!message.startsWith('Error:')) {
        message = 'Error: ' + message;
      }
      this.onToolCallComplete({
        kind: 'error',
        result: message,
        toolCallId: action.parsedContent.toolCallId,
        toolName: getToolName(parsed) as ConvexToolName,
      });
      throw e;
    }
  }
}
