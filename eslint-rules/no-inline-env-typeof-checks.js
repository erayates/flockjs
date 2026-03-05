const GUARDED_GLOBALS = new Set([
  'window',
  'navigator',
  'crypto',
  'BroadcastChannel',
  'RTCPeerConnection',
  'WebSocket',
]);

function isTypeofExpression(node) {
  return node.type === 'UnaryExpression' && node.operator === 'typeof';
}

function isEnvironmentFile(filename) {
  const normalized = filename.replaceAll('\\\\', '/');
  return normalized.endsWith('/internal/env.ts');
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Require environment capability checks to be centralized in env.ts',
    },
    schema: [],
  },
  create(context) {
    if (isEnvironmentFile(context.filename)) {
      return {};
    }

    return {
      UnaryExpression(node) {
        if (!isTypeofExpression(node)) {
          return;
        }

        const argument = node.argument;
        if (argument.type !== 'Identifier') {
          return;
        }

        if (!GUARDED_GLOBALS.has(argument.name)) {
          return;
        }

        context.report({
          node,
          message:
            'Inline environment checks must live in packages/core/src/internal/env.ts and be consumed via env.* helpers.',
        });
      },
    };
  },
};
