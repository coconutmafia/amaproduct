import { jsonBlobToText } from './contentToText'

// Strip leftover markdown so chat output reads like a real post (no **, ##,
// ---, * bullets). The AI is told not to use markdown, but this is a safety net.
// Also flattens a stray JSON content blob and removes ```code fences``` so the
// user NEVER sees raw code/JSON, only the finished readable result.
export function cleanMarkdown(text: string): string {
  const noFences = text.replace(/```[\w-]*\n?/g, '') // strip ```code fence``` markers first
  return jsonBlobToText(noFences)         // JSON blob (incl. fenced) → readable text
    .replace(/^#{1,6}\s+/gm, '')          // ## headers → plain
    .replace(/\*\*(.+?)\*\*/g, '$1')       // **bold** → bold
    .replace(/(?<!\*)\*(?!\*)(.+?)\*(?!\*)/g, '$1') // *italic* → italic
    .replace(/^\s*[-*•]\s+/gm, '• ')       // -, * bullets → •
    .replace(/^\s*---+\s*$/gm, '')         // --- dividers → removed
    .replace(/`{1,3}([^`]+)`{1,3}/g, '$1') // `code` → plain
    .replace(/\n{3,}/g, '\n\n')            // collapse extra blank lines
    .trim()
}
