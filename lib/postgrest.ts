export function isMissingColumnError(
  error: { code?: string | null; message?: string | null },
  column: string,
): boolean {
  const message = error.message?.toLowerCase() ?? '';
  const name = column.toLowerCase();
  return (
    (error.code === 'PGRST204' || error.code === '42703') && message.includes(name)
  );
}
