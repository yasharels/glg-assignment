export enum OrderStatus {
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  ERROR = 'error',
  PROCESSING = 'processing',
}

export const getOrderStatus = (status: string): OrderStatus | undefined => {
  return Object.values(OrderStatus).find((orderStatus) => orderStatus === status);
}
