import { convertToModelMessages, type UIMessage, type UIMessagePart, type UIDataTypes, type UITools } from 'ai';
import { EXCLUDED_FILE_PATHS } from './constants.js';

type Part = UIMessagePart<UIDataTypes, UITools>;

export async function cleanupAssistantMessages(messages: UIMessage[]) {
  let processedMessages = messages.map((message) => {
    if (message.role == 'assistant') {
      let parts = message.parts?.map((part: Part) => {
        if (part.type === 'text') {
          return { ...part, text: cleanMessage(part.text) };
        }
        return part;
      });
      return { ...message, parts };
    } else {
      return message;
    }
  });
  // Filter out empty messages and messages with empty parts
  processedMessages = processedMessages.filter(
    (message) =>
      message.parts &&
      message.parts.filter((part: Part) => part.type === 'text' || isToolPart(part)).length > 0,
  );
  const modelMessages = await convertToModelMessages(processedMessages);
  return modelMessages.filter((message) => message.content.length > 0);
}

function isToolPart(part: Part): boolean {
  return part.type === 'dynamic-tool' || part.type.startsWith('tool-');
}

function cleanMessage(message: string) {
  message = message.replace(/<div class=\\"__boltThought__\\">.*?<\/div>/s, '');
  message = message.replace(/<think>.*?<\/think>/s, '');
  // We prevent the LLM from modifying a list of files
  for (const excludedPath of EXCLUDED_FILE_PATHS) {
    const escapedPath = excludedPath.replace(/\//g, '\\/');
    message = message.replace(
      new RegExp(`<boltAction type="file" filePath="${escapedPath}"[^>]*>[\\s\\S]*?<\\/boltAction>`, 'g'),
      `You tried to modify \`${excludedPath}\` but this is not allowed. Please modify a different file.`,
    );
  }
  return message;
}
