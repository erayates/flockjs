function isFunctionNode(node) {
  return (
    node.type === 'FunctionDeclaration' ||
    node.type === 'FunctionExpression' ||
    node.type === 'ArrowFunctionExpression'
  );
}

function isTypeGuardFunction(node) {
  return Boolean(
    node.returnType &&
    node.returnType.type === 'TSTypeAnnotation' &&
    node.returnType.typeAnnotation.type === 'TSTypePredicate',
  );
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow type assertions in type guard functions; narrow with helpers first.',
    },
    schema: [],
  },
  create(context) {
    const sourceCode = context.sourceCode;

    return {
      TSAsExpression(node) {
        const ancestors = sourceCode.getAncestors(node);
        const enclosingTypeGuard = ancestors
          .slice()
          .reverse()
          .find((ancestor) => isFunctionNode(ancestor) && isTypeGuardFunction(ancestor));

        if (!enclosingTypeGuard) {
          return;
        }

        context.report({
          node,
          message:
            'Type guard functions must not use type assertions; narrow unknown values with reusable guards first.',
        });
      },
    };
  },
};
