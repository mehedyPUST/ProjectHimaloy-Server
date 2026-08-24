const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const db = require('../config/db');
const { connectDB } = db;
const { getUserById, getNextInstallmentDate } = require('../utils/helpers');

// Directory: short cards for all active members (non-admin)
router.get('/api/members/directory', async (req, res) => {
    try {
        await connectDB();
        const { search } = req.query;
        const query = {
            role: { $ne: 'admin' },
            isBlocked: { $ne: true },
        };
        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } },
                { phone: { $regex: search, $options: 'i' } },
            ];
        }

        const users = await db.userCollection
            .find(query)
            .project({ password: 0, managerPin: 0 })
            .sort({ name: 1 })
            .toArray();

        const cards = await Promise.all(
            users.map(async (u) => {
                const id = u._id.toString();
                const depositAgg = await db.collectionsCollection
                    .aggregate([
                        { $match: { member_id: id, status: 'confirmed' } },
                        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
                    ])
                    .toArray();
                const activeLoan = await db.loansCollection.findOne({
                    member_id: id,
                    status: 'active',
                });
                return {
                    _id: id,
                    name: u.name,
                    email: u.email,
                    phone: u.phone,
                    image: u.image,
                    role: u.role,
                    isManager: !!u.isManager,
                    joinedAt: u.createdAt || u.created_at,
                    totalDeposit: depositAgg[0]?.total || 0,
                    depositCount: depositAgg[0]?.count || 0,
                    savingsBalance: u.savings_balance || 0,
                    hasActiveLoan: !!activeLoan,
                };
            })
        );

        res.json({ success: true, members: cards });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Failed to load directory' });
    }
});

// Public member timeline / summary
router.get('/api/members/:id/timeline', async (req, res) => {
    try {
        await connectDB();
        const { id } = req.params;
        const user = await getUserById(id);
        if (!user || user.role === 'admin') {
            return res.status(404).json({ success: false, message: 'Member not found' });
        }

        const { password, managerPin, ...safe } = user;
        const memberId = user._id.toString();

        const depositAgg = await db.collectionsCollection
            .aggregate([
                { $match: { member_id: memberId, status: 'confirmed' } },
                { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
            ])
            .toArray();

        const activeLoan = await db.loansCollection.findOne({
            member_id: memberId,
            status: 'active',
        });
        if (activeLoan) {
            activeLoan.next_installment_date = await getNextInstallmentDate(activeLoan);
        }

        const completedLoans = await db.loansCollection
            .find({ member_id: memberId, status: { $in: ['completed', 'settled_early'] } })
            .sort({ completed_at: -1 })
            .limit(10)
            .toArray();

        const transactions = await db.transactionHistoryCollection
            .find({ member_id: memberId })
            .sort({ created_at: -1 })
            .limit(40)
            .toArray();

        const deposits = await db.collectionsCollection
            .find({ member_id: memberId })
            .sort({ created_at: -1 })
            .limit(20)
            .toArray();

        res.json({
            success: true,
            member: {
                _id: memberId,
                name: safe.name,
                email: safe.email,
                phone: safe.phone,
                image: safe.image,
                role: safe.role,
                isManager: !!safe.isManager,
                joinedAt: safe.createdAt || safe.created_at,
            },
            summary: {
                totalDeposit: depositAgg[0]?.total || 0,
                depositCount: depositAgg[0]?.count || 0,
                savingsBalance: safe.savings_balance || 0,
                totalSavings: safe.total_savings || 0,
                hasActiveLoan: !!activeLoan,
            },
            activeLoan,
            completedLoans,
            deposits,
            transactions,
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Failed to load timeline' });
    }
});

module.exports = router;
