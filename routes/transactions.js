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
// ==================== TRANSACTIONS ===========================
// ============================================================

router.get('/api/transactions/my', async (req, res) => {
    try {
        await connectDB();
        const { memberId } = req.query;
        const transactions = await db.transactionHistoryCollection.find({ member_id: memberId }).sort({ created_at: -1 }).toArray();
        res.json({ success: true, transactions });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch transactions' });
    }
});

router.get('/api/transactions', async (req, res) => {
    try {
        await connectDB();
        const { type } = req.query;
        let query = {};
        if (type && type !== 'all') query.type = type;
        const transactions = await db.transactionHistoryCollection.find(query).sort({ created_at: -1 }).toArray();
        const transactionsWithNames = await populateMemberNames(transactions);
        res.json({ success: true, transactions: transactionsWithNames });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch transactions' });
    }
});


module.exports = router;
