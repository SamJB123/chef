import type { ToolUIPart, DynamicToolUIPart } from 'ai';
import type { AbsolutePath, RelativePath } from './utils/workDir.js';
import type { Tool } from 'ai';
import type { npmInstallToolParameters } from './tools/npmInstall.js';
import type { editToolParameters } from './tools/edit.js';
import type { viewParameters } from './tools/view.js';
import type { lookupDocsParameters } from './tools/lookupDocs.js';
import type { installComponentParameters } from './tools/installComponent.js';
import type { scaffoldLocalComponentParameters } from './tools/scaffoldLocalComponent.js';
import type { z } from 'zod';
import type { addEnvironmentVariablesParameters } from './tools/addEnvironmentVariables.js';
import type { getConvexDeploymentNameParameters } from './tools/getConvexDeploymentName.js';

export type ConvexProject = {
  token: string;
  deploymentName: string;
  deploymentUrl: string;
  projectSlug: string;
  teamSlug: string;
};

export interface SystemPromptOptions {
  enableBulkEdits: boolean;
  includeTemplate: boolean;
  openaiProxyEnabled: boolean;
  usingOpenAi: boolean;
  usingGoogle: boolean;
  resendProxyEnabled: boolean;
  enableResend: boolean;
  /** Component registry keys the user has enabled for this chat. Empty set = no components available. */
  enabledComponents: ReadonlySet<string>;
  /** When true, the model can author new local components (via scaffoldLocalComponent + authoring guide). Default false (opt-in). */
  enableComponentAuthoring: boolean;
  /** When true, include the neutral organization-tradeoff guidance for multi-module apps. Default true. */
  enableOrganizationGuidance: boolean;
}

export interface BoltArtifactData {
  id: string;
  title: string;
  type?: string | undefined;
}

export type ActionType = 'file' | 'toolUse';

export interface FileAction {
  type: 'file';
  filePath: RelativePath;
  isEdit?: boolean;
  content: string;
}

export interface ToolUseAction {
  type: 'toolUse';
  toolName: string;
  parsedContent: ToolUIPart | DynamicToolUIPart;
  // Serialized content to use for de-duping
  content: string;
}

export type BoltAction = FileAction | ToolUseAction;

export type BoltActionData = BoltAction;

export interface EditorDocument {
  value: string;
  isBinary: boolean;
  filePath: AbsolutePath;
  scroll?: ScrollPosition;
}

export interface ScrollPosition {
  top: number;
  left: number;
}

export interface File {
  type: 'file';
  content: string;
  isBinary: boolean;
}

export interface Folder {
  type: 'folder';
}

export type EmptyArgs = z.ZodObject<Record<string, never>>;

export type ConvexToolSet = {
  deploy: Tool<EmptyArgs, string>;
  npmInstall: Tool<typeof npmInstallToolParameters, string>;
  lookupDocs: Tool<typeof lookupDocsParameters, string>;
  installComponent: Tool<typeof installComponentParameters, string>;
  scaffoldLocalComponent?: Tool<typeof scaffoldLocalComponentParameters, string>;
  addEnvironmentVariables?: Tool<typeof addEnvironmentVariablesParameters, string>;
  view?: Tool<typeof viewParameters, string>;
  edit?: Tool<typeof editToolParameters, string>;
  getConvexDeploymentName: Tool<typeof getConvexDeploymentNameParameters, string>;
};

export type Dirent = File | Folder;

export type FileMap = Record<AbsolutePath, Dirent | undefined>;
