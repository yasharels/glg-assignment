import nodemailer from 'nodemailer';
import { Order } from "../../definitions/entities/Order";

interface EmailParameters {
  order: Order;
  receipt: Buffer;
}

interface CancellationEmailParameters {
  order: Order;
}

const { SMTP_HOST, SMTP_PORT } = process.env;

const FROM_ADDRESS = '"Your Company" <no-reply@yourcompany.com>';

export class EmailService {
  private static getTransporter() {
    return nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT),
      secure: false,
    });
  }

  private static getBody(order: Order): string {
    return `Dear ${order.details?.customer.name},
      Thank you for your purchase! Please find your receipt attached.
      
      Best regards,
      Your Company`;
  }

  private static getCancellationBody(order: Order): string {
    return `Dear ${order.details?.customer.name},
      Your order has been cancelled. If you did not request this cancellation, please contact our support team.

      Best regards,
      Your Company`;
  }

  public static async sendEmail({ order, receipt }: EmailParameters): Promise<void> {
    const transporter = this.getTransporter();

    const mailOptions = {
      from: FROM_ADDRESS,
      to: order.details?.customer.email,
      subject: `Receipt for Order ${order.orderId}`,
      text: this.getBody(order),
      attachments: [
        {
          filename: `receipt_${order.orderId}.pdf`,
          content: receipt,
          contentType: 'application/pdf',
        },
      ],
    };

    await transporter.sendMail(mailOptions);
  }

  public static async sendCancellationEmail({ order }: CancellationEmailParameters): Promise<void> {
    const transporter = this.getTransporter();

    const mailOptions = {
      from: FROM_ADDRESS,
      to: order.details?.customer.email,
      subject: `Cancellation of Order ${order.orderId}`,
      text: this.getCancellationBody(order),
    };

    await transporter.sendMail(mailOptions);
  }
}
