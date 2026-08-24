const { ObjectId } = require('mongodb');
const db = require('../config/db');

function toObjectId(id) {
    if (!id) return null;
    if (id instanceof ObjectId) return id;
    try {
        if (ObjectId.isValid(id) && String(new ObjectId(id)) === String(id)) {
            return new ObjectId(id);
        }
    } catch (_) {}
    return null;
}

async function populateMemberNames(items, memberIdField = 'member_id') {
    const memberIds = items.map((item) => item[memberIdField]).filter(Boolean);
    if (memberIds.length === 0) return items;

    const objectIds = [];
    const rawIds = [];
    for (const id of memberIds) {
        const oid = toObjectId(id);
        if (oid) objectIds.push(oid);
        rawIds.push(String(id));
    }

    const or = [];
    if (objectIds.length) or.push({ _id: { $in: objectIds } });
    if (rawIds.length) or.push({ _id: { $in: rawIds } });

    const members = or.length
        ? await db.userCollection.find({ $or: or }).toArray()
        : [];

    const memberMap = {};
    members.forEach((m) => {
        memberMap[m._id.toString()] = m;
    });

    return items.map((item) => {
        const key = String(item[memberIdField] || '');
        const m = memberMap[key];
        return {
            ...item,
            member_name: m?.name || 'Unknown',
            member_email: m?.email || '',
            member_phone: m?.phone || '',
        };
    });
}

async function getManagerEmail() {
    const manager = await db.userCollection.findOne({ isManager: true });
    return manager?.email || null;
}

async function getAllMemberEmails() {
    const members = await db.userCollection.find({ isBlocked: { $ne: true } }).toArray();
    return members.filter((m) => m.email).map((m) => ({ email: m.email, name: m.name }));
}

async function getUserById(userId) {
    if (!userId) return null;
    try {
        const oid = toObjectId(userId);
        if (oid) {
            const byOid = await db.userCollection.findOne({ _id: oid });
            if (byOid) return byOid;
        }
        return await db.userCollection.findOne({ _id: String(userId) });
    } catch {
        try {
            return await db.userCollection.findOne({ _id: String(userId) });
        } catch {
            return null;
        }
    }
}

function isAdminUser(user) {
    return user?.role === 'admin';
}

async function getNextInstallmentDate(loan) {
    if (!loan || loan.status !== 'active') return null;
    const dueDay = 10;
    const startDate = new Date(loan.start_month + '-01');
    if (Number.isNaN(startDate.getTime())) return null;
    const nextMonth = new Date(startDate);
    nextMonth.setMonth(startDate.getMonth() + (loan.paid_installments || 0));
    const lastDayOfMonth = new Date(nextMonth.getFullYear(), nextMonth.getMonth() + 1, 0).getDate();
    const dueDate = new Date(
        nextMonth.getFullYear(),
        nextMonth.getMonth(),
        Math.min(dueDay, lastDayOfMonth)
    );
    return dueDate.toISOString().split('T')[0];
}

async function getAvailableFund() {
    const depositAgg = await db.collectionsCollection
        .aggregate([
            { $match: { status: 'confirmed' } },
            { $group: { _id: null, total: { $sum: '$amount' } } },
        ])
        .toArray();
    const totalDeposits = depositAgg[0]?.total || 0;

    const loanAgg = await db.loansCollection
        .aggregate([
            { $match: { status: 'active' } },
            { $group: { _id: null, total: { $sum: '$due_amount' } } },
        ])
        .toArray();
    const totalActiveLoans = loanAgg[0]?.total || 0;

    let totalWithdrawals = 0;
    if (db.savingsWithdrawalsCollection) {
        const withdrawalAgg = await db.savingsWithdrawalsCollection
            .aggregate([
                { $match: { status: 'confirmed' } },
                { $group: { _id: null, total: { $sum: '$amount' } } },
            ])
            .toArray();
        totalWithdrawals = withdrawalAgg[0]?.total || 0;
    }

    return totalDeposits - totalActiveLoans - totalWithdrawals;
}

module.exports = {
    toObjectId,
    populateMemberNames,
    getManagerEmail,
    getAllMemberEmails,
    getUserById,
    isAdminUser,
    getNextInstallmentDate,
    getAvailableFund,
};
