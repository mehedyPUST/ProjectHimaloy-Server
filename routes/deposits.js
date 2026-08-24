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
// ==================== DEPOSIT APIS ==========================
// ============================================================

router.post('/api/deposits/pay', async (req, res) => {
    try {
        await connectDB();
        const { memberId, month, year, date, paidThrough, transactionId, amount, note } = req.body;

        if (!memberId || !month || !year || !amount) {
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }

        const member = await getUserById(memberId);
        if (isAdminUser(member)) {
            return res.status(403).json({ success: false, message: 'Admin cannot make deposits' });
        }

        const depositMonth = `${year}-${month}`;

        const deposit = {
            member_id: memberId,
            month: depositMonth,
            date: date || new Date().toISOString().split('T')[0],
            paid_through: paidThrough,
            transaction_id: paidThrough === 'hand-cash' ? '-' : (transactionId || '-'),
            amount: parseInt(amount),
            note: note || '',
            status: 'pending',
            created_at: new Date(),
            updated_at: new Date()
        };

        const result = await db.collectionsCollection.insertOne(deposit);

        await db.transactionHistoryCollection.insertOne({
            type: 'deposit',
            member_id: memberId,
            amount: parseInt(amount),
            month: depositMonth,
            date: date || new Date().toISOString().split('T')[0],
            method: paidThrough,
            txn_id: deposit.transaction_id,
            status: 'pending',
            created_at: new Date()
        });

        const managerEmail = await getManagerEmail();
        if (managerEmail) {
            try {
                await emailService.sendDepositRequestToManager(managerEmail, {
                    memberName: member?.name || 'Member',
                    month: depositMonth,
                    amount: parseInt(amount),
                    method: paidThrough,
                    txnId: deposit.transaction_id,
                    date: new Date(),
                    note: note || '',
                });
            } catch (e) {
                console.error('Email error:', e.message);
            }
        }

        res.status(201).json({
            success: true,
            message: 'Deposit request submitted',
            deposit: { ...deposit, _id: result.insertedId }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to submit deposit' });
    }
});

router.get('/api/deposits/my', async (req, res) => {
    try {
        await connectDB();
        const { memberId } = req.query;
        const deposits = await db.collectionsCollection.find({ member_id: memberId }).sort({ created_at: -1 }).toArray();
        res.json({ success: true, deposits });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch deposits' });
    }
});

router.get('/api/deposits', async (req, res) => {
    try {
        await connectDB();
        const { status, month } = req.query;
        let query = {};
        if (status && status !== 'all') query.status = status;
        if (month) query.month = month;

        const deposits = await db.collectionsCollection.find(query).sort({ created_at: -1 }).toArray();
        const depositsWithMembers = await populateMemberNames(deposits);
        res.json({ success: true, deposits: depositsWithMembers });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch deposits' });
    }
});

router.patch('/api/deposits/:id/confirm', async (req, res) => {
    try {
        await connectDB();
        const { id } = req.params;
        const { managerId, pin, status: reqStatus, rejectReason } = req.body;

        if (!ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid ID' });
        }

        const manager = await db.userCollection.findOne({ _id: new ObjectId(managerId) });
        if (!manager) return res.status(404).json({ success: false, message: 'Manager not found' });
        if (!manager.isManager) return res.status(403).json({ success: false, message: 'Not authorized' });

        if (!manager.managerPin) {
            return res.status(400).json({ success: false, message: 'Please set your Manager PIN first' });
        }

        const isValidPin = await bcrypt.compare(pin, manager.managerPin);
        if (!isValidPin) {
            return res.status(401).json({ success: false, message: 'Wrong PIN' });
        }

        const newStatus = reqStatus || 'confirmed';

        const updateData = {
            status: newStatus,
            confirmed_by: managerId,
            confirmed_at: new Date(),
            updated_at: new Date()
        };

        if (newStatus === 'rejected' && rejectReason) {
            updateData.reject_reason = rejectReason;
        }

        await db.collectionsCollection.updateOne({ _id: new ObjectId(id) }, { $set: updateData });

        // Update transaction history
        const deposit = await db.collectionsCollection.findOne({ _id: new ObjectId(id) });
        if (deposit) {
            await db.transactionHistoryCollection.updateOne(
                {
                    member_id: deposit.member_id,
                    month: deposit.month,
                    type: 'deposit',
                    status: 'pending'
                },
                {
                    $set: {
                        status: newStatus,
                        confirmed_by: managerId,
                        updated_at: new Date()
                    }
                }
            );
        }

        res.json({ success: true, message: `Deposit ${newStatus}` });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to confirm deposit' });
    }
});

router.get('/api/deposits/due', async (req, res) => {
    try {
        await connectDB();
        const currentMonth = new Date().toISOString().slice(0, 7);
        // ✅ শুধু মেম্বার (অ্যাডমিন নয়) এবং যারা ব্লকড নয়
        const members = await db.userCollection.find({
            isBlocked: false,
            role: { $ne: 'admin' }   // ← অ্যাডমিন বাদ
        }).toArray();
        const paidMembers = await db.collectionsCollection.find({ month: currentMonth, status: 'confirmed' }).toArray();
        const paidMemberIds = paidMembers.map(p => p.member_id);
        const dueMembers = members.filter(m => !paidMemberIds.includes(m._id.toString()));

        res.json({
            success: true,
            dueMembers: dueMembers.map(m => ({
                _id: m._id, name: m.name, email: m.email, phone: m.phone, month: currentMonth
            })),
            totalDue: dueMembers.length
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch due members' });
    }
});


module.exports = router;
