const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const db = require('../config/db');
const { connectDB } = db;
const {
    getUserById,
    isAdminUser,
    getAvailableFund,
    getManagerEmail,
} = require('../utils/helpers');
const emailService = require('../utils/emailService');

async function getMinRetainAmount() {
    const config = await db.appConfigCollection.findOne({ key: 'settings' });
    return config?.value?.savings?.minRetainAmount ?? 500;
}

// Member savings summary
router.get('/api/savings/my', async (req, res) => {
    try {
        await connectDB();
        const { memberId } = req.query;
        if (!memberId) return res.status(400).json({ success: false, message: 'memberId required' });

        const user = await getUserById(memberId);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        const savingsBalance = user.savings_balance || 0;
        const totalSavings = user.total_savings || 0;
        const minRetain = await getMinRetainAmount();
        const availableFund = await getAvailableFund();
        const withdrawable = Math.max(0, savingsBalance - minRetain);
        const maxWithdrawNow = Math.min(withdrawable, Math.max(0, availableFund));

        const history = await db.savingsWithdrawalsCollection
            .find({ member_id: memberId })
            .sort({ created_at: -1 })
            .limit(50)
            .toArray();

        res.json({
            success: true,
            savings: {
                balance: savingsBalance,
                totalEarned: totalSavings,
                minRetainAmount: minRetain,
                withdrawable,
                availableFund,
                maxWithdrawNow,
            },
            history,
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Failed to fetch savings' });
    }
});

// Request / execute withdrawal (instant when fund allows)
router.post('/api/savings/withdraw', async (req, res) => {
    try {
        await connectDB();
        const { memberId, amount, note, method } = req.body;
        if (!memberId || !amount) {
            return res.status(400).json({ success: false, message: 'memberId and amount required' });
        }

        const amt = parseInt(amount, 10);
        if (!amt || amt <= 0) {
            return res.status(400).json({ success: false, message: 'Invalid amount' });
        }

        const user = await getUserById(memberId);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });
        if (isAdminUser(user)) {
            return res.status(403).json({ success: false, message: 'Admin cannot withdraw savings' });
        }
        if (user.isBlocked) {
            return res.status(403).json({ success: false, message: 'Account is blocked' });
        }

        const savingsBalance = user.savings_balance || 0;
        const minRetain = await getMinRetainAmount();
        const withdrawable = Math.max(0, savingsBalance - minRetain);
        const availableFund = await getAvailableFund();
        const maxWithdrawNow = Math.min(withdrawable, Math.max(0, availableFund));

        if (amt > withdrawable) {
            return res.status(400).json({
                success: false,
                message: `You can only withdraw ৳${withdrawable.toLocaleString()} (must keep ৳${minRetain.toLocaleString()} minimum)`,
            });
        }
        if (amt > availableFund) {
            return res.status(400).json({
                success: false,
                message: `Insufficient fund liquidity. Available in fund: ৳${availableFund.toLocaleString()}`,
            });
        }

        // Deduct savings
        await db.userCollection.updateOne(
            { _id: new ObjectId(memberId) },
            {
                $inc: { savings_balance: -amt },
                $set: { updatedAt: new Date() },
            }
        );

        const withdrawal = {
            member_id: memberId,
            amount: amt,
            method: method || 'hand-cash',
            note: note || '',
            status: 'confirmed',
            balance_before: savingsBalance,
            balance_after: savingsBalance - amt,
            min_retain_at_time: minRetain,
            available_fund_at_time: availableFund,
            created_at: new Date(),
            updated_at: new Date(),
        };

        const result = await db.savingsWithdrawalsCollection.insertOne(withdrawal);

        await db.transactionHistoryCollection.insertOne({
            type: 'savings_withdrawal',
            member_id: memberId,
            amount: amt,
            status: 'confirmed',
            note: note || '',
            created_at: new Date(),
        });

        // Notify manager
        try {
            const managerEmail = await getManagerEmail();
            if (managerEmail && emailService.sendGenericNotification) {
                await emailService.sendGenericNotification?.(managerEmail, {
                    subject: 'Savings withdrawal',
                    message: `${user.name} withdrew ৳${amt.toLocaleString()} from savings.`,
                });
            }
        } catch (_) {}

        res.json({
            success: true,
            message: 'Withdrawal successful',
            withdrawal: { ...withdrawal, _id: result.insertedId },
            newBalance: savingsBalance - amt,
            maxWithdrawNow: Math.min(
                Math.max(0, savingsBalance - amt - minRetain),
                Math.max(0, availableFund - amt)
            ),
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Failed to process withdrawal' });
    }
});

// Admin/manager: list all withdrawals
router.get('/api/savings/withdrawals', async (req, res) => {
    try {
        await connectDB();
        const { memberId, limit = 50 } = req.query;
        const query = memberId ? { member_id: memberId } : {};
        const list = await db.savingsWithdrawalsCollection
            .find(query)
            .sort({ created_at: -1 })
            .limit(parseInt(limit, 10))
            .toArray();

        const { populateMemberNames } = require('../utils/helpers');
        const withNames = await populateMemberNames(list);
        res.json({ success: true, withdrawals: withNames });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch withdrawals' });
    }
});

module.exports = router;
