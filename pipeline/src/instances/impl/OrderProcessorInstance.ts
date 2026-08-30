import path from "path";
import { promises as fs } from "fs";

import { QueueInstance } from "../classes/QueueInstance";
import { OrderMessage } from "../../definitions/messages/OrderMessage";
import { OrdersDatabase } from "../../databases/OrdersDatabase";
import { OrderStatus } from "../../definitions/enums/OrderStatus";
import { ReceiptService } from "../../services/receipt/ReceiptService";
import { SimpleQueueService } from "../../services/sqs/SimpleQueueService";

const { SQS_ORDER_PROCESSING_QUEUE_NAME, RECEIPT_DIRECTORY_PATH, SQS_ORDER_EMAIL_QUEUE_NAME } = process.env;

export class OrderProcessorInstance extends QueueInstance<OrderMessage> {
  constructor() {
    super({ loggerPrefix: "OrderProcessorInstance", queueName: SQS_ORDER_PROCESSING_QUEUE_NAME });
  }

  protected getRequiredMessageFields(): Array<keyof OrderMessage> {
    return ["orderId"];
  }

  /**
   * Render and store a PDF receipt and update the order with a reference in the database.
   * @param message
   * @protected
   */
  protected async process({ orderId }: OrderMessage): Promise<void> {
    if (!RECEIPT_DIRECTORY_PATH) throw new Error("RECEIPT_DIRECTORY_PATH is not defined");

    const order = await OrdersDatabase.getOrderById(orderId);

    if (!order) throw new Error(`Order not found: ${orderId}`);
    if (order.status !== OrderStatus.PROCESSING) {
      this.logger.warn(`Order ${orderId} is not in PROCESSING state`);
      return;
    }

    const buffer = await ReceiptService.render(order);
    const fileName = `${order.orderId}.pdf`;
    const filePath = path.join(RECEIPT_DIRECTORY_PATH, fileName);

    // write from buffer to file
    await fs.writeFile(filePath, buffer);
    this.logger.info(`Receipt saved: ${filePath}`);

    /**
     * Rendering is slow enough that the order can be cancelled while it runs. Claim the
     * receipt conditionally: if the order has left PROCESSING, nothing downstream will ever
     * read this file, so discard it here rather than leaving it orphaned on disk.
     */
    const claimed = await OrdersDatabase.updateIfStatus(order.orderId, OrderStatus.PROCESSING, { receiptFilePath: filePath });
    if (!claimed) {
      await fs.unlink(filePath).catch((error: any) => {
        if (error.code !== "ENOENT") throw error;
      });
      this.logger.warn(`Order ${orderId} left PROCESSING while rendering, receipt discarded`);
      return;
    }

    await SimpleQueueService.sendMessage(SQS_ORDER_EMAIL_QUEUE_NAME, "Email the customer", { orderId });
  }
}
