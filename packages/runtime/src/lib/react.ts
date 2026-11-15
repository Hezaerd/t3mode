// Reading T3 Code's React state. Component names are minified, so lookups match on the
// shape of the data instead. Every reader returns undefined when the shape is not found,
// and callers treat that as "this T3 Code version is not supported".

interface Fiber {
  readonly return: Fiber | null;
  readonly child: Fiber | null;
  readonly sibling: Fiber | null;
  readonly memoizedProps: unknown;
  readonly memoizedState: unknown;
}

interface Hook {
  readonly memoizedState: unknown;
  readonly next: Hook | null;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** The fiber React attached to a DOM node. */
export const fiberOf = (node: Element): Fiber | undefined => {
  const key = Object.keys(node).find((name) => name.startsWith("__reactFiber$"));
  return key ? ((node as unknown as Record<string, Fiber>)[key] ?? undefined) : undefined;
};

/** Props of the closest ancestor component (inclusive) whose props match `test`. */
export const findPropsUp = (
  node: Element,
  test: (props: Record<string, unknown>) => boolean,
  maxDepth = 80,
): Record<string, unknown> | undefined => {
  let fiber: Fiber | null | undefined = fiberOf(node);
  for (let depth = 0; fiber && depth < maxDepth; depth++, fiber = fiber.return) {
    if (isObject(fiber.memoizedProps) && test(fiber.memoizedProps)) return fiber.memoizedProps;
  }
  return undefined;
};

const hooksOf = function* (fiber: Fiber): Generator<unknown> {
  let hook = fiber.memoizedState;
  for (let index = 0; isObject(hook) && "next" in hook && index < 300; index++) {
    yield (hook as unknown as Hook).memoizedState;
    hook = (hook as unknown as Hook).next;
  }
};

/**
 * The first hook state anywhere in the tree under the root of `node` that matches `test`.
 * Walks at most `budget` fibers.
 */
export const findHookState = <T>(
  node: Element,
  test: (value: unknown) => value is T,
  budget = 50_000,
): T | undefined => {
  let root = fiberOf(node);
  while (root?.return) root = root.return;
  const stack: Array<Fiber> = root ? [root] : [];
  for (let visited = 0; stack.length > 0 && visited < budget; visited++) {
    const fiber = stack.pop();
    if (!fiber) break;
    for (const state of hooksOf(fiber)) if (test(state)) return state;
    if (fiber.sibling) stack.push(fiber.sibling);
    if (fiber.child) stack.push(fiber.child);
  }
  return undefined;
};
