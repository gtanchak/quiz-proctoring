import { Type, type TSchema } from "@sinclair/typebox";

/** Shared offset/limit query parameters for list endpoints. */
export const PaginationQuery = Type.Object({
  limit: Type.Integer({ minimum: 1, maximum: 100, default: 20 }),
  offset: Type.Integer({ minimum: 0, default: 0 }),
});

/** Wraps an item schema in the standard `{ data, pagination }` list envelope. */
export function paginated<T extends TSchema>(item: T) {
  return Type.Object({
    data: Type.Array(item),
    pagination: Type.Object({
      total: Type.Integer(),
      limit: Type.Integer(),
      offset: Type.Integer(),
    }),
  });
}
