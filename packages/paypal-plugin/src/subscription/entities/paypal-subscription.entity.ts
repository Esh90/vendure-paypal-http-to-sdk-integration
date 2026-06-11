import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('paypal_subscription')
export class PayPalSubscription {
    @PrimaryGeneratedColumn()
    id!: number;

    /** PayPal-assigned subscription ID (e.g. I-XXXXXXXXX). */
    @Column({ unique: true })
    paypalSubscriptionId!: string;

    /** PayPal plan ID this subscription is billed under. */
    @Column()
    paypalPlanId!: string;

    /** Vendure Customer ID — nullable when created outside a customer context. */
    @Column({ nullable: true, type: 'varchar' })
    vendureCustomerId!: string | null;

    /** APPROVAL_PENDING | APPROVED | ACTIVE | SUSPENDED | CANCELLED | EXPIRED */
    @Column({ default: 'APPROVAL_PENDING' })
    status!: string;

    /** PayPal approval URL the subscriber must visit to authorise recurring charges. */
    @Column({ nullable: true, type: 'varchar' })
    approvalUrl!: string | null;

    /** ISO 8601 start time requested at subscription creation. */
    @Column({ nullable: true, type: 'varchar' })
    startTime!: string | null;

    @CreateDateColumn()
    createdAt!: Date;

    @UpdateDateColumn()
    updatedAt!: Date;
}
