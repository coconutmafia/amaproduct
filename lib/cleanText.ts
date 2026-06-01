// Strip leftover markdown so chat output reads like a real post (no **, ##,
// ---, * bullets). The AI is told not to use markdown, but this is a safety net.
export function cleanMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, '')          // ## headers → plain
    .replace(/\*\*(.+?)\*\*/g, '$1')       // **bold** → bold
    .replace(/(?<!\*)\*(?!\*)(.+?)\*(?!\*)/g, '$1') // *italic* → italic
    .replace(/^\s*[-*•]\s+/gm, '• ')       // -, * bullets → •
    .replace(/^\s*---+\s*$/gm, '')         // --- dividers → removed
    .replace(/`{1,3}([^`]+)`{1,3}/g, '$1') // `code` → plain
    .replace(/\n{3,}/g, '\n\n')            // collapse extra blank lines
    .trim()
}
