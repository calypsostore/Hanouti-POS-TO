const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function compareVersions(left: string, right: string): -1 | 0 | 1 | null {
  const leftParts = VERSION_PATTERN.exec(left)?.slice(1);
  const rightParts = VERSION_PATTERN.exec(right)?.slice(1);
  if (!leftParts || !rightParts) return null;

  for (let index = 0; index < leftParts.length; index += 1) {
    const leftPart = leftParts[index];
    const rightPart = rightParts[index];
    if (leftPart.length !== rightPart.length) return leftPart.length < rightPart.length ? -1 : 1;
    if (leftPart !== rightPart) return leftPart < rightPart ? -1 : 1;
  }
  return 0;
}
