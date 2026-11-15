import type { MethodInfo } from '../data/reference';

/** A generated TypeScript usage snippet for the method, from its signature. */
export function usageSnippet(group: string, m: MethodInfo): string {
  const args = m.params.filter(param => param.name !== 'options').map(param => param.name);
  const call = `client.${group}.${m.name}(${args.join(', ')})`;

  if (m.sse) {
    return `for await (const event of ${call}) {\n  // event.event — see the streaming concept for the wire shape\n}`;
  }
  if (m.paginated) {
    return `for await (const item of ${call}) {\n  // item: ${m.returnType}\n}`;
  }
  if (m.returnKind === 'promise' && m.returnType !== 'void') {
    return `const result = await ${call};\n// result: ${m.returnType}`;
  }
  return `await ${call};`;
}

