import {
  ConditionalCheckFailedException,
  GetItemCommand,
  PutItemCommand,
  ScanCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { unmarshall, marshall } from "@aws-sdk/util-dynamodb";

import { Order } from "../definitions/entities/Order";
import { OrderStatus } from "../definitions/enums/OrderStatus";
import { DynamoService } from "../services/dynamo/DynamoService";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";

interface GetOrdersParams {
  userId?: string;
  status?: OrderStatus;
  referenceId?: string;
  count: number;
}

const { DYNAMO_TABLE_ORDERS } = process.env;

export class OrdersDatabase {
  public static async createOrder(order: Order): Promise<void> {
    const client = DynamoService.getClient();
    if (!DYNAMO_TABLE_ORDERS) throw new Error("DYNAMO_TABLE_ORDERS is not defined");

    const command = new PutItemCommand({
      TableName: DYNAMO_TABLE_ORDERS,
      Item: marshall(order, { removeUndefinedValues: true }),
    });

    await client.send(command);
  }

  public static async getOrders(params: GetOrdersParams): Promise<Order[]> {
    const client = DynamoService.getClient();
    if (!DYNAMO_TABLE_ORDERS) throw new Error("DYNAMO_TABLE_ORDERS is not defined");

    const { count } = params;

    /* Build filter expression */
    const filterExpression: Array<string> = [];
    const expressionAttributeValues = {};

    const filters = ['userId', 'status', 'referenceId'];
    for (const filter of filters) {
      if (params[filter]) {
        filterExpression.push(`#${filter} = :${filter}`);
        expressionAttributeValues[`:${filter}`] = { S: params[filter] };
      }
    }

    const command = new ScanCommand({
      TableName: DYNAMO_TABLE_ORDERS,
      Limit: count,
      FilterExpression: filterExpression.length > 0 ? filterExpression.join(" AND ") : undefined,
      ExpressionAttributeValues: filterExpression.length > 0 ? expressionAttributeValues : undefined,
      Select: "ALL_ATTRIBUTES"
    });

    const response = await client.send(command);
    if (!response.Items) return [];

    return response.Items.map((item) => unmarshall(item) as Order);
  }

  public static async getOrderById(orderId: string): Promise<Order | null> {
    const client = DynamoService.getClient();
    if (!DYNAMO_TABLE_ORDERS) throw new Error("DYNAMO_TABLE_ORDERS is not defined");

    const command = new GetItemCommand({
      TableName: DYNAMO_TABLE_ORDERS,
      Key: { orderId: { S: orderId } },
    });

    const response = await client.send(command);
    if (!response.Item) return null;
    return unmarshall(response.Item) as Order;
  }

  public static async getOrderByReferenceId(referenceId: string): Promise<Order | null> {
    const client = DynamoService.getClient();
    if (!DYNAMO_TABLE_ORDERS) throw new Error("DYNAMO_TABLE_ORDERS is not defined");

    const command = new QueryCommand({
      TableName: DYNAMO_TABLE_ORDERS,
      IndexName: "referenceIdIndex",
      KeyConditionExpression: "referenceId = :referenceId",
      ExpressionAttributeValues: {
        ":referenceId": referenceId,
      },
      Select: "ALL_ATTRIBUTES",
      Limit: 1,
    });

    const response = await client.send(command);
    if (!response.Items || response.Items.length === 0) return null;
    return response.Items[0] as Order;
  }

  /**
   * Atomically move an order out of PROCESSING and into CANCELLED.
   *
   * The condition is what makes cancellation safe under concurrent requests: callers check
   * the status with a read first, but only the request that wins this write gets the order
   * back. Everyone else gets null and must not enqueue a cancellation email.
   *
   * Returns null when the condition fails, which also covers an order that no longer exists.
   */
  public static async cancelOrder(orderId: string): Promise<Order | null> {
    const client = DynamoService.getClient();
    if (!DYNAMO_TABLE_ORDERS) throw new Error("DYNAMO_TABLE_ORDERS is not defined");

    const now = Date.now();

    const command = new UpdateItemCommand({
      TableName: DYNAMO_TABLE_ORDERS,
      Key: { orderId: { S: orderId } },
      UpdateExpression: "set #status = :cancelled, cancelledAt = :now, updatedAt = :now",
      ConditionExpression: "#status = :processing",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":cancelled": { S: OrderStatus.CANCELLED },
        ":processing": { S: OrderStatus.PROCESSING },
        ":now": { N: `${now}` },
      },
      ReturnValues: "ALL_NEW",
    });

    try {
      const response = await client.send(command);
      if (!response.Attributes) return null;
      return unmarshall(response.Attributes) as Order;
    }
    catch (error: any) {
      if (error instanceof ConditionalCheckFailedException) return null;
      throw error;
    }
  }
}
