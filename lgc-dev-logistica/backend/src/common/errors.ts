/** Códigos de erro de negócio (PLANNING_LOGISTICA.md 13.4); `message` sempre em português. */
export type ErrorCode =
  | 'INSUFFICIENT_STOCK'
  | 'LOT_BLOCKED'
  | 'SERIAL_DUPLICATE'
  | 'INVALID_LOCATION'
  | 'REQUEST_VERSION_CONFLICT'
  | 'AXIS_REFERENCE_INVALID'
  | 'INSPECTION_REQUIRED'
  | 'APPROVAL_REQUIRED'
  | 'UNIT_CONVERSION_ERROR';

export const problem = (message: string, code: ErrorCode) => ({ message, code });
