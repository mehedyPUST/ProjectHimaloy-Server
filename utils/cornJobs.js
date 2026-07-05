// server/utils/cronJobs.js
const cron = require('node-cron');
const { MongoClient, ObjectId } = require('mongodb');
const emailService = require('./emailService');
require('dotenv').config();

// ============================================================
// Run every 25th of month at 9:00 AM
// ============================================================
cron.schedule('0 9 25 * *', async () => {
    console.log('🔔 CRON: 25th - Sending deposit & installment reminders...');

    const client = new MongoClient(process.env.MONGODB_URI);

    try {
        await client.connect();
        const db = client.db(process.env.MONGODB_DB);

        const today = new Date();
        const currentMonth = today.toISOString().slice(0, 7);
        const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1).toISOString().slice(0, 7);

        const settingsDoc = await db.collection('app_config').findOne({ key: 'settings' });
        const minDeposit = settingsDoc?.value?.deposit?.minAmount || 200;
        const dueDate = settingsDoc?.value?.deposit?.dueDate || 10;

        // ============================================================
        // 1. DEPOSIT REMINDER - Next month's deposit
        // ============================================================
        const members = await db.collection('user').find({ role: 'member', active: true }).toArray();

        for (const member of members) {
            if (member.email) {
                try {
                    await emailService.sendDueDateReminder(member.email, {
                        type: 'deposit',
                        amount: minDeposit,
                        dueDate: `${nextMonth}-${String(dueDate).padStart(2, '0')}`,
                    });
                    console.log(`✅ Deposit reminder sent to ${member.email} for ${nextMonth}`);
                } catch (error) {
                    console.error(`❌ Failed to send to ${member.email}:`, error.message);
                }
            }
        }

        // ============================================================
        // 2. LOAN INSTALLMENT REMINDER - Next month's installment
        // ============================================================
        const activeLoans = await db.collection('loans').find({ status: 'active' }).toArray();

        for (const loan of activeLoans) {
            const member = await db.collection('user').findOne({ _id: new ObjectId(loan.member_id) });

            if (member?.email) {
                const nextInstallmentNo = (loan.paid_installments || 0) + 1;

                // Only remind if installment is still pending
                if (nextInstallmentNo <= loan.total_installments) {
                    try {
                        await emailService.sendDueDateReminder(member.email, {
                            type: 'installment',
                            amount: loan.installment_amount,
                            dueDate: `${nextMonth}-${String(dueDate).padStart(2, '0')}`,
                            loanId: loan._id.toString().slice(-8),
                            installmentNo: nextInstallmentNo,
                            totalInstallments: loan.total_installments,
                        });
                        console.log(`✅ Installment reminder sent to ${member.email} - Loan ${loan._id.toString().slice(-8)}`);
                    } catch (error) {
                        console.error(`❌ Failed to send to ${member.email}:`, error.message);
                    }
                }
            }
        }

        // ============================================================
        // 3. In-app notification for all members
        // ============================================================
        for (const member of members) {
            await db.collection('notifications').insertOne({
                user_id: member._id.toString(),
                type: 'monthly_reminder',
                title: 'Monthly Reminder',
                message: `Reminder: Next month's deposit of ৳${minDeposit} is due by ${dueDate}th.`,
                is_read: false,
                priority: 'medium',
                created_at: new Date()
            });
        }

        console.log(`✅ Reminders sent to ${members.length} members`);

    } catch (error) {
        console.error('❌ CRON Job Error:', error);
    } finally {
        await client.close();
    }
});

// ============================================================
// Run every 1st of month at midnight - Create monthly deposit entries
// ============================================================
cron.schedule('0 0 1 * *', async () => {
    console.log('📅 CRON: Creating monthly deposit entries...');

    const client = new MongoClient(process.env.MONGODB_URI);

    try {
        await client.connect();
        const db = client.db(process.env.MONGODB_DB || 'Project-Himaloy');

        const members = await db.collection('user').find({ role: 'member', active: true }).toArray();
        const currentMonth = new Date().toISOString().slice(0, 7);

        for (const member of members) {
            const existing = await db.collection('monthly_deposits').findOne({
                member_id: member._id.toString(),
                month: currentMonth
            });

            if (!existing) {
                await db.collection('monthly_deposits').insertOne({
                    member_id: member._id.toString(),
                    month: currentMonth,
                    amount: 0,
                    status: 'due',
                    created_at: new Date(),
                    updated_at: new Date()
                });
            }
        }

        console.log(`✅ Created monthly entries for ${members.length} members`);
    } catch (error) {
        console.error('❌ CRON Monthly Entry Error:', error);
    } finally {
        await client.close();
    }
});

// ============================================================
// Run every Sunday at 10 AM - Weekly summary to manager
// ============================================================
cron.schedule('0 10 * * 0', async () => {
    console.log('📊 CRON: Sending weekly summary...');

    const client = new MongoClient(process.env.MONGODB_URI);

    try {
        await client.connect();
        const db = client.db(process.env.MONGODB_DB || 'Project-Himaloy');

        const currentMonth = new Date().toISOString().slice(0, 7);

        const totalMembers = await db.collection('user').countDocuments({ role: 'member', active: true });
        const monthCollection = await db.collection('monthly_deposits').find({ month: currentMonth, status: 'confirmed' }).toArray();
        const totalCollected = monthCollection.reduce((sum, d) => sum + d.amount, 0);
        const pendingCount = await db.collection('monthly_deposits').countDocuments({ month: currentMonth, status: 'pending' });
        const activeLoans = await db.collection('loans').countDocuments({ status: 'active' });

        const cycle = await db.collection('manager_cycles').findOne({ active: true });
        if (cycle) {
            const manager = await db.collection('user').findOne({ _id: new ObjectId(cycle.manager_id) });

            if (manager?.email) {
                try {
                    await emailService.sendWeeklySummary(manager.email, {
                        totalMembers,
                        totalCollected,
                        expectedCollection: totalMembers * 200,
                        pendingCount,
                        activeLoans,
                        month: currentMonth,
                    });
                } catch (error) {
                    console.error('Weekly summary email error:', error.message);
                }
            }
        }

        console.log('✅ Weekly summary sent');
    } catch (error) {
        console.error('❌ CRON Weekly Error:', error);
    } finally {
        await client.close();
    }
});

console.log('⏰ CRON Jobs scheduled:');
console.log('   - 25th 9AM: Deposit & Installment reminders for next month');
console.log('   - 1st of month: Monthly entries creation');
console.log('   - Sunday 10AM: Weekly summary to manager');