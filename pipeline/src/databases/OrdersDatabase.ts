import {
  AttributeValue,
  ConditionalCheckFailedException,
  GetItemCommand,
  UpdateItemCommand
} from "@aws-sdk/client-dynamodb";

import { unmarshall, marshall } from "@aws-sdk/util-dynamodb";

import { MutableOrderFields, Order } from "../definitions/entities/Order";
import { OrderStatus } from "../definitions/enums/OrderStatus";
import { DynamoService } from "../services/dynamo/DynamoService";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";

interface DynamoUpdateParams {
  UpdateExpression: string;
  ExpressionAttributeValues: {
    [key: string]: AttributeValue;
  };
  ConditionExpression?: string;
  ExpressionAttributeNames?: {
    [key: string]: string;
  };
}

const { DYNAMO_TABLE_ORDERS } = process.env;

export class OrdersDatabase {
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

  private static buildUpdateParams(mutableFields: MutableOrderFields): DynamoUpdateParams {
    const { status } = mutableFields;

    const params: DynamoUpdateParams = {
      UpdateExpression: "set updatedAt = :updatedAt",
      ExpressionAttributeValues: { ":updatedAt": { N: `${Date.now()}` } },
      ExpressionAttributeNames: {}
    };

    const manualFields = ["status"];

    Object.entries(mutableFields).forEach((entry) => {
      const [key, value] = entry;
      if (!manualFields.includes(key) && value !== undefined && value !== null) {
        params.UpdateExpression += `, ${key} = :${key}`;
        params.ExpressionAttributeValues[`:${key}`] = marshall({ [key]: value })[key];
      }
    });

    if (status !== undefined) {
      params.UpdateExpression += ", #status = :status";
      params.ExpressionAttributeValues[":status"] = { S: status };
      params.ExpressionAttributeNames!["#status"] = "status";
    }

    return params;
  }

  private static async sendUpdate(orderId: string, params: DynamoUpdateParams): Promise<void> {
    /* If unused, remove because dynamo won't allow this to be empty */
    if (params.ExpressionAttributeNames && Object.keys(params.ExpressionAttributeNames).length === 0) {
      delete params.ExpressionAttributeNames;
    }

    const command = new UpdateItemCommand({
      TableName: DYNAMO_TABLE_ORDERS!,
      Key: { orderId: { S: orderId } },
      ...params
    });

    const dynamo = DynamoService.getClient();
    await dynamo.send(command);
  }

  public static async update(orderId: string, mutableFields: MutableOrderFields): Promise<void> {
    await this.sendUpdate(orderId, this.buildUpdateParams(mutableFields));
  }

  /**
   * Apply mutable fields, but only while the order is still in expectedStatus.
   *
   * Returns false when the order has already moved on, so a caller that has produced a
   * side effect - a rendered receipt, say - can undo it instead of orphaning it.
   */
  public static async updateIfStatus(
    orderId: string,
    expectedStatus: OrderStatus,
    mutableFields: MutableOrderFields
  ): Promise<boolean> {
    const params = this.buildUpdateParams(mutableFields);

    params.ConditionExpression = "#status = :expectedStatus";
    params.ExpressionAttributeValues[":expectedStatus"] = { S: expectedStatus };
    params.ExpressionAttributeNames!["#status"] = "status";

    try {
      await this.sendUpdate(orderId, params);
      return true;
    }
    catch (error: any) {
      if (error instanceof ConditionalCheckFailedException) return false;
      throw error;
    }
  }
}
