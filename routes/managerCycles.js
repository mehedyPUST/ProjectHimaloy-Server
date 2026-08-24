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
// ==================== MANAGER CYCLES =========================
// ============================================================

router.get('/api/manager-cycles/current', async (req, res) => {
    try {
        await connectDB();
        const cycle = await db.managerCyclesCollection.findOne({ active: true });
        if (cycle) {
            const manager = await db.userCollection.findOne({ _id: new ObjectId(cycle.manager_id) });
            cycle.manager_name = manager?.name || 'Unknown';
        }
        res.json({ success: true, cycle });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch cycle' });
    }
});

router.get('/api/manager-cycles', async (req, res) => {
    try {
        await connectDB();
        const cycles = await db.managerCyclesCollection.find().sort({ created_at: -1 }).toArray();
        for (let cycle of cycles) {
            try {
                const manager = await db.userCollection.findOne({ _id: new ObjectId(cycle.manager_id) });
                cycle.manager_name = manager?.name || 'Unknown';
            } catch { }
        }
        res.json({ success: true, cycles });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch cycles' });
    }
});


module.exports = router;
