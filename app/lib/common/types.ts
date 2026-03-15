import type { ToolUIPart, DynamicToolUIPart } from 'ai';
import type { ConvexToolSet } from 'chef-agent/types';
import type { ActionStatus } from '~/lib/runtime/action-runner';

// The full SDK type for tool parts in messages (used by action-runner, useMessageParser, etc.)
export type ConvexToolInvocation = ToolUIPart | DynamicToolUIPart;

export type ConvexToolName = keyof ConvexToolSet;

export type ToolStatus = Record<string, ActionStatus>;
