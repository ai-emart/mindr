export default {
  docs: [
    'index',
    'quickstart',
    'cli',
    'sdk',
    {
      type: 'category',
      label: 'Integrations',
      items: ['integrations/codex', 'integrations/claude-code', 'integrations/cursor', 'integrations/aider', 'integrations/windsurf', 'integrations/continue-dev', 'integrations/opencode'],
    },
    {
      type: 'category',
      label: 'Concepts',
      items: ['concepts/memory-schema', 'concepts/branch-aware-memory', 'concepts/conventions', 'concepts/decisions', 'concepts/bug-patterns', 'concepts/debt', 'concepts/quality-score', 'concepts/context-health'],
    },
    'architecture',
    'self-hosting',
    'faq',
  ],
}
