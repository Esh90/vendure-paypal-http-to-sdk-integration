import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('paypal_billing_plan')
export class PayPalBillingPlan {
    @PrimaryGeneratedColumn()
    id!: number;

    /** PayPal-assigned plan ID (e.g. P-XXXXXXXXX). */
    @Column({ unique: true })
    paypalPlanId!: string;

    @Column()
    name!: string;

    @Column({ nullable: true, type: 'varchar' })
    description!: string | null;

    /** CREATED | INACTIVE | ACTIVE */
    @Column({ default: 'CREATED' })
    status!: string;

    /** PayPal product ID the plan is linked to (created in the PayPal dashboard). */
    @Column()
    paypalProductId!: string;

    /** DAY | WEEK | MONTH | YEAR */
    @Column()
    intervalUnit!: string;

    @Column()
    intervalCount!: number;

    /** Decimal string price per billing cycle (e.g. "9.99"). */
    @Column()
    price!: string;

    @Column()
    currencyCode!: string;

    @CreateDateColumn()
    createdAt!: Date;

    @UpdateDateColumn()
    updatedAt!: Date;
}
