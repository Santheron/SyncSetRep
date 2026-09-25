type QueryError = {
  code?: string | null;
  message?: string | null;
};

export function logOwnedDataError(input: {
  table: string;
  operation: 'insert' | 'update' | 'delete' | 'select' | 'rpc';
  userId: string | null;
  error: QueryError;
}): void {
  console.error('[RLS]', {
    user_id: input.userId,
    table: input.table,
    operation: input.operation,
    error_code: input.error.code ?? null,
    error_message: input.error.message ?? null,
  });
}
