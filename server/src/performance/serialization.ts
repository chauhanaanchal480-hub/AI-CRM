const DATE_MARKER = '__aiCrmDate';

export function serialize(value: unknown) {
  return JSON.stringify(value, function replaceDate(key, item: unknown) {
    const original = key ? (this as Record<string, unknown>)[key] : value;
    return original instanceof Date ? { [DATE_MARKER]: original.toISOString() } : item;
  });
}

export function deserialize<T>(serialized: string): T {
  return JSON.parse(serialized, (_key, value: unknown) => {
    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      if (Object.keys(record).length === 1 && typeof record[DATE_MARKER] === 'string') {
        return new Date(record[DATE_MARKER]);
      }
    }
    return value;
  }) as T;
}
