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
// ==================== INSTALLMENT MANAGEMENT =================
// ============================================================

router.get('/api/loans/installments', async (req, res) => {
    try {
        await connectDB();
        const { status, loanId } = req.query;
        let query = {};
        if (status && status !== 'all') query.status = status;
        if (loanId && ObjectId.isValid(loanId)) {
            query.loan_id = loanId;
        } else if (loanId) {
            return res.json({ success: true, installments: [] });
        }

        const installments = await db.loanInstallmentsCollection.find(query).sort({ created_at: -1 }).toArray();
        const populated = await populateMemberNames(installments);
        res.json({ success: true, installments: populated });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch installments' });
    }
});

router.patch('/api/loans/installments/:id/confirm', async (req, res) => {
    try {
        await connectDB();
        const { id } = req.params;
        const { managerId, pin, status: reqStatus, rejectReason } = req.body;

        if (!ObjectId.isValid(id)) return res.status(400).json({ success: false, message: 'Invalid ID' });

        const manager = await getUserById(managerId);
        if (!manager || !manager.isManager) return res.status(403).json({ success: false, message: 'Not authorized' });
        if (!manager.managerPin) return res.status(400).json({ success: false, message: 'Please set your Manager PIN first' });

        const isValidPin = await bcrypt.compare(pin, manager.managerPin);
        if (!isValidPin) return res.status(401).json({ success: false, message: 'Wrong PIN' });

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

        await db.loanInstallmentsCollection.updateOne({ _id: new ObjectId(id) }, { $set: updateData });

        const inst = await db.loanInstallmentsCollection.findOne({ _id: new ObjectId(id) });
        if (!inst) return res.status(404).json({ success: false, message: 'Installment not found' });

        if (newStatus === 'confirmed') {
            const loan = await db.loansCollection.findOne({ _id: new ObjectId(inst.loan_id) });
            if (loan) {
                const excess = Math.max(0, (inst.amount || 0) - (loan.installment_amount || 0));
                const newPaid = (loan.paid_installments || 0) + 1;
                let newDue = (loan.due_amount || loan.amount) - (loan.installment_amount || 0) - excess;
                if (newDue < 0) newDue = 0;

                const totalInstallments = loan.total_installments || 0;
                const earlySettlementMonths = 3;

                const isPrincipalPaid = newDue <= 0;
                const isEarly = isPrincipalPaid && (newPaid <= earlySettlementMonths);
                const isAllInstallmentsPaid = newPaid >= totalInstallments;

                let newLoanStatus = 'active';
                if (isEarly) {
                    newLoanStatus = 'settled_early';
                } else if (isAllInstallmentsPaid) {
                    newLoanStatus = 'completed';
                }

                await db.loansCollection.updateOne(
                    { _id: new ObjectId(inst.loan_id) },
                    {
                        $set: {
                            paid_installments: newPaid,
                            due_amount: newDue,
                            status: newLoanStatus,
                            completed_at: (newLoanStatus === 'completed' || newLoanStatus === 'settled_early') ? new Date() : null,
                            updated_at: new Date()
                        }
                    }
                );

                if (newLoanStatus === 'completed') {
                    await db.userCollection.updateOne(
                        { _id: new ObjectId(loan.member_id) },
                        { $inc: { savings_balance: loan.savings_amount || 0, total_savings: loan.savings_amount || 0 } }
                    );
                }
            }
        }

        const member = await getUserById(inst.member_id);
        if (member?.email) {
            try {
                await emailService.sendInstallmentStatusUpdate(member.email, {
                    status: newStatus,
                    installmentNo: inst.installment_no,
                    amount: inst.amount,
                    loanId: inst.loan_id,
                    date: inst.date || new Date(inst.created_at).toLocaleDateString(),
                    reason: newStatus === 'rejected' ? rejectReason : null,
                });
            } catch (e) {
                console.error('Email error (installment update):', e.message);
            }
        }

        res.json({ success: true, message: `Installment ${newStatus}` });
    } catch (error) {
        console.error('Confirm installment error:', error);
        res.status(500).json({ success: false, message: 'Failed to confirm installment' });
    }
});


module.exports = router;
