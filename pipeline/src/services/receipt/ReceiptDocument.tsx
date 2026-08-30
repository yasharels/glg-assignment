import React from "react";
import { Page, View, Text, StyleSheet, Document } from "@react-pdf/renderer";

import { Order } from "../../definitions/entities/Order";

const styles = StyleSheet.create({
  page: {
    padding: 30,
    fontSize: 12,
    fontFamily: 'Helvetica',
  },
  header: {
    fontSize: 24,
    marginBottom: 20,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  section: {
    marginBottom: 10,
  },
  orderInfo: {
    marginBottom: 15,
  },
  customerInfo: {
    marginBottom: 15,
  },
  tableHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#000',
    paddingBottom: 5,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: '#ddd',
    paddingVertical: 5,
  },
  itemName: {
    width: '50%',
  },
  itemQuantity: {
    width: '25%',
    textAlign: 'center',
  },
  itemPrice: {
    width: '25%',
    textAlign: 'right',
  },
  total: {
    marginTop: 15,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  totalLabel: {
    fontWeight: 'bold',
    marginRight: 5,
  },
});

export const ReceiptDocument: React.FC<{ order: Order }> = ({ order }) => {
  // Derive the total from the line items rather than trusting order.amount, which is
  // supplied by the API caller and bears no relation to the items generated at intake.
  const totalAmount = order.details?.items.reduce((total, item) => total + item.price * item.quantity, 0) ?? 0;

  return (
    <Document>
      <Page style={styles.page}>
        {/* Header */}
        <Text style={styles.header}>Receipt</Text>

        {/* Order Information */}
        <View style={styles.orderInfo}>
          <Text>Order ID: {order.orderId}</Text>
          <Text>Date: {new Date(order.createdAt).toLocaleDateString()}</Text>
        </View>

        {/* Customer Information */}
        {order.details && (
          <View style={styles.customerInfo}>
            <Text>Customer Information:</Text>
            <Text>{order.details.customer.name}</Text>
            <Text>{order.details.customer.email}</Text>
            <Text>
              {`${order.details.customer.address.street}, ${order.details.customer.address.city}, ${order.details.customer.address.state}, ${order.details.customer.address.country} ${order.details.customer.address.zip}`}
            </Text>
          </View>
        )}

        {/* Items Table Header */}
        <View style={styles.tableHeader}>
          <Text style={styles.itemName}>Item</Text>
          <Text style={styles.itemQuantity}>Quantity</Text>
          <Text style={styles.itemPrice}>Unit Price</Text>
        </View>

        {/* Items */}
        {order.details?.items.map((item, index) => (
          <View style={styles.tableRow} key={index}>
            <Text style={styles.itemName}>{item.name}</Text>
            <Text style={styles.itemQuantity}>{item.quantity}</Text>
            <Text style={styles.itemPrice}>${item.price.toFixed(2)}</Text>
          </View>
        ))}

        {/* Total Amount */}
        <View style={styles.total}>
          <Text style={styles.totalLabel}>Total Amount:</Text>
          <Text>${totalAmount.toFixed(2)}</Text>
        </View>
      </Page>
    </Document>
  );
}

