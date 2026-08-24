const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { connectDB } = db;
const {
    populateMemberNames,
    getManagerEmail,
    getAllMemberEmails,
    getUserById,
    isAdminUser,
    getNextInstallmentDate,
    getAvailableFund,
} = require('../utils/helpers');
const emailService = require('../utils/emailService');

// ============================================================
// ==================== DASHBOARD APIS ========================
// ============================================================

router.get('/api/dashboard/member', async (req, res) => {
    try {
        await connectDB();
        const { memberId } = req.query;
        if (!memberId) return res.status(400).json({ success: false, message: 'memberId required' });

        const depositAgg = await db.collectionsCollection.aggregate([
            { $match: { member_id: memberId, status: 'confirmed' } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]).toArray();
        const totalDeposit = depositAgg[0]?.total || 0;

        const lastDeposit = await db.collectionsCollection.findOne(
            { member_id: memberId, status: 'confirmed' },
            { sort: { created_at: -1 } }
        );

        const currentMonth = new Date().toISOString().slice(0, 7);
        const currentMonthDeposit = await db.collectionsCollection.findOne({ member_id: memberId, month: currentMonth });
        const activeLoan = await db.loansCollection.findOne({ member_id: memberId, status: 'active' });
        if (activeLoan) {
            activeLoan.next_installment_date = await getNextInstallmentDate(activeLoan);
        }
        const recentTransactions = await db.transactionHistoryCollection.find({ member_id: memberId }).sort({ created_at: -1 }).limit(5).toArray();

        res.json({
            success: true,
            dashboard: {
                totalDeposit,
                lastDeposit: lastDeposit ? {
                    amount: lastDeposit.amount,
                    date: lastDeposit.date || new Date(lastDeposit.created_at).toISOString().split('T')[0],
                    month: lastDeposit.month,
                } : null,
                currentMonth: {
                    month: new Date().toLocaleString('default', { month: 'long', year: 'numeric' }),
                    amount: currentMonthDeposit?.amount || 200,
                    status: currentMonthDeposit?.status || 'due',
                    dueDate: '10th',
                },
                activeLoan,
                savings: 0,
                recentTransactions,
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch dashboard' });
    }
});

router.get('/api/dashboard/manager', async (req, res) => {
    try {
        await connectDB();
        const currentMonth = new Date().toISOString().slice(0, 7);

        const totalMembers = await db.userCollection.countDocuments({ isBlocked: false, role: { $ne: 'admin' } });
        const activeLoans = await db.loansCollection.countDocuments({ status: 'active' });
        const pendingConfirmations = await db.collectionsCollection.countDocuments({ status: 'pending', month: currentMonth });
        const pendingLoanRequests = await db.loanRequestsCollection.countDocuments({ status: 'pending' });

        const monthCollection = await db.collectionsCollection.aggregate([
            { $match: { month: currentMonth, status: 'confirmed' } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]).toArray();

        const recentActivities = await db.transactionHistoryCollection.find().sort({ created_at: -1 }).limit(10).toArray();
        const activitiesWithNames = await populateMemberNames(recentActivities);

        res.json({
            success: true,
            dashboard: {
                totalMembers,
                activeLoans,
                pendingConfirmations,
                pendingLoanRequests,
                totalCollectionThisMonth: monthCollection[0]?.total || 0,
                expectedCollection: totalMembers * 200,
                collectionRate: totalMembers > 0 ? Math.round(((monthCollection[0]?.total || 0) / (totalMembers * 200)) * 100) : 0,
                fundBalance: monthCollection[0]?.total || 0,
                dueMembers: 0,
                recentActivities: activitiesWithNames,
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch dashboard' });
    }
});

router.get('/api/dashboard/admin', async (req, res) => {
    try {
        await connectDB();
        const totalMembers = await db.userCollection.countDocuments();
        const activeLoans = await db.loansCollection.countDocuments({ status: 'active' });
        const fundAgg = await db.collectionsCollection.aggregate([
            { $match: { status: 'confirmed' } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]).toArray();
        const recentActivities = await db.transactionHistoryCollection.find().sort({ created_at: -1 }).limit(10).toArray();
        const activitiesWithNames = await populateMemberNames(recentActivities);

        res.json({
            success: true,
            dashboard: {
                totalMembers,
                activeLoans,
                totalFundBalance: fundAgg[0]?.total || 0,
                recentActivities: activitiesWithNames,
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch dashboard' });
    }
});


module.exports = router;
