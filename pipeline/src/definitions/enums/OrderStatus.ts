export enum OrderStatus {
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  ERROR = 'error',
  PROCESSING = 'processing',
}

export const getOrderStatus = (status: string): OrderStatus | undefined => {
  Object.values(OrderStatus).forEach((orderStatus) => {
    if (orderStatus === status) return orderStatus;
  });

  return undefined;
}
