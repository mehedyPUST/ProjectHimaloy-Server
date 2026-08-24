const { ObjectId } = require('mongodb');
const db = require('../config/db');

async function populateMemberNames(items, memberIdField = 'member_id') {
    const memberIds = items.map(item => item[memberIdField]).filter(Boolean);
    if (memberIds.length === 0) return items;

    const members = await db.userCollection.find({
        _id: {
            $in: memberIds.map(id => {
                try { return new ObjectId(id); } catch { return id; }
            })
        }
    }).toArray();

    const memberMap = {};
    members.forEach(m => {
        memberMap[m._id.toString()] = m;
    });

    return items.map(item => ({
        ...item,
        member_name: memberMap[item[memberIdField]]?.name || 'Unknown',
        member_email: memberMap[item[memberIdField]]?.email || '',
        member_phone: memberMap[item[memberIdField]]?.phone || '',
    }));
}

async function getManagerEmail() {
    const manager = await db.userCollection.findOne({ isManager: true });
    return manager?.email || null;
}

async function getAllMemberEmails() {
    const members = await db.userCollection.find({ isBlocked: false }).toArray();
    return members.filter(m => m.email).map(m => ({ email: m.email, name: m.name }));
}

async function getUserById(userId) {
    try {
        return await db.userCollection.findOne({ _id: new ObjectId(userId) });
    } catch {
        return null;
    }
}

function isAdminUser(user) {
    return user?.role === 'admin';
}

async function getNextInstallmentDate(loan) {
    if (!loan || loan.status !== 'active') return null;
    const dueDay = 10;
    const startDate = new Date(loan.start_month + '-01');
    const nextMonth = new Date(startDate);
    nextMonth.setMonth(startDate.getMonth() + (loan.paid_installments || 0));
    const lastDayOfMonth = new Date(nextMonth.getFullYear(), nextMonth.getMonth() + 1, 0).getDate();
    const dueDate = new Date(nextMonth.getFullYear(), nextMonth.getMonth(), Math.min(dueDay, lastDayOfMonth));
    return dueDate.toISOString().split('T')[0];
}

async function getAvailableFund() {
    const depositAgg = await db.collectionsCollection.aggregate([
        { $match: { status: 'confirmed' } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
    ]).toArray();
    const totalDeposits = depositAgg[0]?.total || 0;

    const loanAgg = await db.loansCollection.aggregate([
        { $match: { status: 'active' } },
        { $group: { _id: null, total: { $sum: '$due_amount' } } }
    ]).toArray();
    const totalActiveLoans = loanAgg[0]?.total || 0;

    const withdrawalAgg = await db.savingsWithdrawalsCollection.aggregate([
        { $match: { status: 'confirmed' } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
    ]).toArray();
    const totalWithdrawals = withdrawalAgg[0]?.total || 0;

    return totalDeposits - totalActiveLoans - totalWithdrawals;
}

module.exports = {
    populateMemberNames,
    getManagerEmail,
    getAllMemberEmails,
    getUserById,
    isAdminUser,
    getNextInstallmentDate,
    getAvailableFund,
};
