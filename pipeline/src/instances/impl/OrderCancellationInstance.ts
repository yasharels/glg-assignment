import { promises as fs } from "fs";

import { QueueInstance } from "../classes/QueueInstance";
import { OrderMessage } from "../../definitions/messages/OrderMessage";
import { OrdersDatabase } from "../../databases/OrdersDatabase";
import { OrderStatus } from "../../definitions/enums/OrderStatus";
import { EmailService } from "../../services/email/EmailService";

const { SQS_ORDER_CANCELLATION_QUEUE_NAME } = process.env;

export class OrderCancellationInstance extends QueueInstance<OrderMessage> {
  constructor() {
    super({ loggerPrefix: "OrderCancellationInstance", queueName: SQS_ORDER_CANCELLATION_QUEUE_NAME });
  }

  protected getRequiredMessageFields(): Array<keyof OrderMessage> {
    return ["orderId"];
  }

  /**
   * Email the customer to confirm the cancellation, then discard any receipt that
   * was rendered before the cancellation landed.
   * @param message
   * @protected
   */
  protected async process({ orderId }: OrderMessage): Promise<void> {
    const order = await OrdersDatabase.getOrderById(orderId);

    if (!order) throw new Error(`Order not found: ${orderId}`);

    /* The API owns the transition to CANCELLED, so anything else here is a stale message */
    if (order.status !== OrderStatus.CANCELLED) {
      this.logger.warn(`Order ${orderId} is not in CANCELLED state`);
      return;
    }

    if (order.details) {
      await EmailService.sendCancellationEmail({ order });
      this.logger.info(`Order ${orderId} cancellation email sent`);
    } else {
      /* Cancelled before intake generated the customer details, so there is nobody to email */
      this.logger.warn(`Order ${orderId} has no details, skipping the cancellation email`);
    }

    /**
     * The processor may have rendered a receipt before the cancellation landed. The emailer
     * will never pick it up now that the order is no longer PROCESSING, so remove it here.
     * A redelivered message may find it already gone, which is not an error.
     */
    if (order.receiptFilePath) {
      await fs.unlink(order.receiptFilePath).catch((error: any) => {
        if (error.code !== "ENOENT") throw error;
        this.logger.debug(`Receipt already removed: ${order.receiptFilePath}`);
      });
      this.logger.info(`Order ${orderId} receipt discarded`);
    }
  }
}
