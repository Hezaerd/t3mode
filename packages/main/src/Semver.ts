// Semantic version order, as electron-updater compares versions. T3 Code's nightlies are
// prereleases such as `0.1.10-nightly.20261114.4669`, so prerelease fields count.

interface Version {
  readonly core: readonly [number, number, number];
  readonly pre: ReadonlyArray<string>;
}

const PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export const parseVersion = (text: string): Version | undefined => {
  const match = PATTERN.exec(text.trim());
  if (!match) return undefined;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4] ? match[4].split(".") : [],
  };
};

const NUMERIC = /^\d+$/;

const compareIdentifiers = (a: string, b: string): number => {
  const aNumeric = NUMERIC.test(a);
  const bNumeric = NUMERIC.test(b);
  if (aNumeric && bNumeric) return Math.sign(Number(a) - Number(b));
  if (aNumeric) return -1;
  if (bNumeric) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
};

/** Negative when `a` is older than `b`, zero when equal, positive when newer. Unparsable sorts first. */
export const compareVersions = (a: string, b: string): number => {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return left ? 1 : right ? -1 : 0;
  for (let index = 0; index < 3; index++) {
    const diff = left.core[index]! - right.core[index]!;
    if (diff !== 0) return Math.sign(diff);
  }
  // A release sorts after its prereleases.
  if (left.pre.length === 0 || right.pre.length === 0) {
    return left.pre.length === right.pre.length ? 0 : left.pre.length === 0 ? 1 : -1;
  }
  for (let index = 0; index < Math.max(left.pre.length, right.pre.length); index++) {
    const l = left.pre[index];
    const r = right.pre[index];
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    const diff = compareIdentifiers(l, r);
    if (diff !== 0) return diff;
  }
  return 0;
};
