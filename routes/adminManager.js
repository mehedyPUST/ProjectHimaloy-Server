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
// ==================== ADMIN MANAGER APIS =====================
// ============================================================

router.patch('/api/admin/make-manager/:id', async (req, res) => {
    try {
        await connectDB();
        const { id } = req.params;
        if (!ObjectId.isValid(id)) return res.status(400).json({ success: false, message: 'Invalid ID' });

        const user = await db.userCollection.findOne({ _id: new ObjectId(id) });
        if (isAdminUser(user)) {
            return res.status(400).json({ success: false, message: 'Admin cannot be manager' });
        }

        await db.userCollection.updateMany(
            { isManager: true },
            { $set: { isManager: false, role: 'member', updatedAt: new Date() } }
        );

        await db.userCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { isManager: true, role: 'manager', updatedAt: new Date() } }
        );

        await db.managerCyclesCollection.updateMany(
            { active: true },
            { $set: { active: false, end_date: new Date().toISOString().split('T')[0], updatedAt: new Date() } }
        );

        const lastCycle = await db.managerCyclesCollection.findOne({}, { sort: { cycle_number: -1 } });
        const cycleNumber = (lastCycle?.cycle_number || 0) + 1;
        const startDate = new Date().toISOString().split('T')[0];
        const endDate = new Date();
        endDate.setMonth(endDate.getMonth() + 6);

        await db.managerCyclesCollection.insertOne({
            manager_id: id,
            cycle_number: cycleNumber,
            start_date: startDate,
            end_date: endDate.toISOString().split('T')[0],
            total_collection: 0,
            total_loans_disbursed: 0,
            total_savings_generated: 0,
            active: true,
            created_at: new Date()
        });

        res.json({ success: true, message: `${user?.name || 'Member'} is now the manager` });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed' });
    }
});

router.patch('/api/admin/remove-manager/:id', async (req, res) => {
    try {
        await connectDB();
        const { id } = req.params;
        if (!ObjectId.isValid(id)) return res.status(400).json({ success: false, message: 'Invalid ID' });

        await db.userCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { isManager: false, role: 'member', updatedAt: new Date() } }
        );

        await db.managerCyclesCollection.updateMany(
            { active: true, manager_id: id },
            { $set: { active: false, end_date: new Date().toISOString().split('T')[0], updatedAt: new Date() } }
        );

        const user = await db.userCollection.findOne({ _id: new ObjectId(id) });
        res.json({ success: true, message: `${user?.name || 'Member'} removed from manager role` });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed' });
    }
});


module.exports = router;
