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
// ==================== AVAILABLE FUND API =====================
// ============================================================
router.get('/api/fund/available', async (req, res) => {
    try {
        await connectDB();
        const available = await getAvailableFund();
        res.json({ success: true, availableFund: available });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch available fund' });
    }
});


module.exports = router;
