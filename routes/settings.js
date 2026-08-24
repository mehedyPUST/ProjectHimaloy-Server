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
// ==================== APP CONFIG =============================
// ============================================================

router.get('/api/admin/settings', async (req, res) => {
    try {
        await connectDB();
        const config = await db.appConfigCollection.findOne({ key: 'settings' });
        res.json({ success: true, settings: config?.value || {} });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch settings' });
    }
});

router.put('/api/admin/settings', async (req, res) => {
    try {
        await connectDB();
        const { settings } = req.body;
        await db.appConfigCollection.updateOne(
            { key: 'settings' },
            { $set: { value: settings, updated_at: new Date() } },
            { upsert: true }
        );
        res.json({ success: true, message: 'Settings saved' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to save settings' });
    }
});


module.exports = router;
