export type MessageId = string & { __isMessageId: true };

export type PartId = string & { __isPartId: true };

const PART_ID_SEPARATOR = '::part::';

type PartLike = {
  type: string;
  toolCallId?: string;
  [key: string]: unknown;
};

export function makePartId(messageId: string, key: number | string): PartId {
  if (typeof key === 'number') {
    return `${messageId}-${key}` as PartId;
  }
  return `${messageId}${PART_ID_SEPARATOR}${key}` as PartId;
}

export function makePartIdForPart(messageId: string, parts: PartLike[], index: number): PartId {
  return makePartId(messageId, makePartKey(parts, index));
}

export function makeMessageId(id: string): MessageId {
  return id as MessageId;
}

export function parsePartId(partId: PartId): { messageId: MessageId; index: number } {
  const separatorIndex = partId.lastIndexOf(PART_ID_SEPARATOR);
  if (separatorIndex !== -1) {
    const messageId = partId.slice(0, separatorIndex);
    const key = partId.slice(separatorIndex + PART_ID_SEPARATOR.length);
    const legacyIndex = Number(key);
    return { messageId: makeMessageId(messageId), index: Number.isFinite(legacyIndex) ? legacyIndex : -1 };
  }

  const legacySeparatorIndex = partId.lastIndexOf('-');
  const messageId = legacySeparatorIndex === -1 ? partId : partId.slice(0, legacySeparatorIndex);
  const index = legacySeparatorIndex === -1 ? '-1' : partId.slice(legacySeparatorIndex + 1);
  return { messageId: makeMessageId(messageId), index: parseInt(index) };
}

function makePartKey(parts: PartLike[], targetIndex: number): string {
  const target = parts[targetIndex];
  if (!target) {
    return `missing:${targetIndex}`;
  }
  if (target.toolCallId) {
    return `tool:${target.toolCallId}`;
  }

  let stepIndex = 0;
  let ordinalInStep = 0;
  for (let index = 0; index <= targetIndex; index++) {
    const part = parts[index];
    if (part.type === 'step-start') {
      stepIndex++;
      ordinalInStep = 0;
      if (index === targetIndex) {
        return `step:${stepIndex}`;
      }
      continue;
    }
    if (index === targetIndex) {
      return `step:${stepIndex}:${part.type}:${ordinalInStep}`;
    }
    if (!part.toolCallId) {
      ordinalInStep++;
    }
  }
  return `${target.type}:${targetIndex}`;
}
