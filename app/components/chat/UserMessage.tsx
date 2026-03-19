import { Markdown } from './Markdown';

interface UserMessageProps {
  content: string;
}

export function UserMessage({ content }: UserMessageProps) {
  return (
    <div className="overflow-hidden text-sm text-bolt-elements-item-contentActive">
      <Markdown html>{content}</Markdown>
    </div>
  );
}

export function stripMetadata(content: string) {
  const artifactRegex = /<boltArtifact\s+[^>]*>[\s\S]*?<\/boltArtifact>/gm;
  return content.replace(artifactRegex, '');
}
