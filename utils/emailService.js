const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_APP_PASSWORD,
    },
});

transporter.verify((error, success) => {
    if (error) {
        console.error('❌ Email service error:', error);
    } else {
        console.log('✅ Email service ready');
    }
});

// ============================================================
// ==================== EMAIL TEMPLATES ========================
// ============================================================

const getBaseTemplate = (content) => `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: Arial, sans-serif; background: #f5f5f5; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 20px auto; background: white; border-radius: 12px; overflow: hidden; }
        .header { background: linear-gradient(135deg, #2563eb, #1d4ed8); color: white; padding: 25px; text-align: center; }
        .header h1 { margin: 0; font-size: 22px; }
        .header p { margin: 5px 0 0; opacity: 0.9; font-size: 14px; }
        .body { padding: 25px; }
        .footer { background: #f9fafb; padding: 15px; text-align: center; font-size: 12px; color: #6b7280; border-top: 1px solid #e5e7eb; }
        .btn { display: inline-block; padding: 12px 24px; background: #2563eb; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; margin-top: 15px; }
        .info-box { background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 15px; margin: 15px 0; }
        .info-box strong { color: #1e40af; }
        .warning-box { background: #fef3c7; border: 1px solid #fcd34d; border-radius: 8px; padding: 15px; margin: 15px 0; }
        .success-box { background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 15px; margin: 15px 0; }
        .error-box { background: #fef2f2; border: 1px solid #fca5a5; border-radius: 8px; padding: 15px; margin: 15px 0; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🏔️ ProjectHimaloy</h1>
            <p>Cooperative Fund Management</p>
        </div>
        <div class="body">
            ${content}
        </div>
        <div class="footer">
            <p>© ${new Date().getFullYear()} ProjectHimaloy. All rights reserved.</p>
            <p>This is an automated email. Please do not reply.</p>
        </div>
    </div>
</body>
</html>
`;

// ============================================================
// ==================== EMAIL FUNCTIONS ========================
// ============================================================

/**
 * 1. Loan Request → Manager
 */
async function sendLoanRequestToManager(managerEmail, loanData) {
    const content = `
        <h2 style="color: #1e40af;">📬 New Loan Request</h2>
        <p>A member has submitted a new loan request.</p>
        
        <div class="info-box">
            <p><strong>Member:</strong> ${loanData.memberName}</p>
            <p><strong>Loan Amount:</strong> ৳${loanData.amount.toLocaleString()}</p>
            <p><strong>Tenure:</strong> ${loanData.tenure} months</p>
            <p><strong>Reason:</strong> ${loanData.reason}</p>
            <p><strong>Date:</strong> ${new Date(loanData.date).toLocaleDateString()}</p>
        </div>

        <p>Please review and start the voting process.</p>
        <a href="${process.env.FRONTEND_URL}/dashboard/manager/loans" class="btn">Review Request →</a>
    `;

    await sendEmail({
        to: managerEmail,
        subject: `🔔 New Loan Request - ${loanData.memberName} (৳${loanData.amount.toLocaleString()})`,
        html: getBaseTemplate(content),
    });
}

/**
 * 2. Loan Approved → Member
 */
async function sendLoanApprovedToMember(memberEmail, loanData) {
    const content = `
        <h2 style="color: #16a34a;">✅ Loan Approved!</h2>
        <p>Congratulations! Your loan request has been approved.</p>
        
        <div class="success-box">
            <p><strong>Loan ID:</strong> ${loanData.loanId}</p>
            <p><strong>Amount:</strong> ৳${loanData.amount.toLocaleString()}</p>
            <p><strong>Tenure:</strong> ${loanData.tenure} months</p>
            <p><strong>Total Installments:</strong> ${loanData.totalInstallments}</p>
            <p><strong>Per Installment:</strong> ৳${loanData.installmentAmount.toLocaleString()}</p>
            <p><strong>Savings After Completion:</strong> ৳${loanData.savingsAmount.toLocaleString()}</p>
        </div>

        <p>The manager will disburse the loan amount soon.</p>
        <a href="${process.env.FRONTEND_URL}/dashboard/member/loans" class="btn">View My Loans →</a>
    `;

    await sendEmail({
        to: memberEmail,
        subject: `✅ Loan Approved - ${loanData.loanId} (৳${loanData.amount.toLocaleString()})`,
        html: getBaseTemplate(content),
    });
}

/**
 * 3. Loan Rejected → Member
 */
async function sendLoanRejectedToMember(memberEmail, loanData) {
    const content = `
        <h2 style="color: #dc2626;">❌ Loan Request Rejected</h2>
        <p>We regret to inform you that your loan request has been rejected.</p>
        
        <div class="error-box">
            <p><strong>Loan ID:</strong> ${loanData.loanId}</p>
            <p><strong>Amount:</strong> ৳${loanData.amount.toLocaleString()}</p>
            <p><strong>Reason:</strong> ${loanData.reason || 'No specific reason provided'}</p>
        </div>

        <p>If you have any questions, please contact the manager.</p>
        <a href="${process.env.FRONTEND_URL}/dashboard/member/loans" class="btn">View My Loans →</a>
    `;

    await sendEmail({
        to: memberEmail,
        subject: `❌ Loan Rejected - ${loanData.loanId} (৳${loanData.amount.toLocaleString()})`,
        html: getBaseTemplate(content),
    });
}

/**
 * 4. Meeting Called → All Members
 */
async function sendMeetingNotification(members, meetingData) {
    const content = `
        <h2 style="color: #d97706;">📅 Meeting Called</h2>
        <p>A meeting has been scheduled by the manager.</p>
        
        <div class="warning-box">
            <p><strong>Title:</strong> ${meetingData.title}</p>
            <p><strong>Date:</strong> ${new Date(meetingData.date).toLocaleDateString()}</p>
            <p><strong>Time:</strong> ${meetingData.time}</p>
            <p><strong>Location:</strong> ${meetingData.location}</p>
            <p><strong>Agenda:</strong> ${meetingData.agenda}</p>
            ${meetingData.loanRequestId ? `<p><strong>Related Loan:</strong> ${meetingData.loanRequestId}</p>` : ''}
        </div>

        <p>Please make sure to attend. Your presence is important.</p>
    `;

    for (const member of members) {
        await sendEmail({
            to: member.email,
            subject: `📅 Meeting: ${meetingData.title} - ${new Date(meetingData.date).toLocaleDateString()}`,
            html: getBaseTemplate(content),
        });
    }
}

/**
 * 5. Reminder Before Due Date
 */
async function sendDueDateReminder(memberEmail, reminderData) {
    const isDeposit = reminderData.type === 'deposit';

    const content = `
        <h2 style="color: ${isDeposit ? '#7c3aed' : '#2563eb'};">⏰ ${isDeposit ? 'Deposit' : 'Installment'} Reminder</h2>
        <p>This is a reminder that your ${isDeposit ? 'monthly deposit' : 'loan installment'} is due soon.</p>
        
        <div class="info-box">
            <p><strong>Type:</strong> ${isDeposit ? 'Monthly Deposit' : 'Loan Installment'}</p>
            <p><strong>Amount:</strong> ৳${reminderData.amount.toLocaleString()}</p>
            <p><strong>Due Date:</strong> ${new Date(reminderData.dueDate).toLocaleDateString()}</p>
            ${reminderData.loanId ? `<p><strong>Loan ID:</strong> ${reminderData.loanId}</p>` : ''}
            ${reminderData.installmentNo ? `<p><strong>Installment:</strong> #${reminderData.installmentNo} of ${reminderData.totalInstallments}</p>` : ''}
        </div>

        <div class="warning-box">
            <p>⚠️ Please make the payment before the due date to avoid being marked as overdue.</p>
        </div>

        <a href="${process.env.FRONTEND_URL}/dashboard/member/${isDeposit ? 'collections' : 'loans'}" class="btn">Make Payment →</a>
    `;

    await sendEmail({
        to: memberEmail,
        subject: `⏰ ${isDeposit ? 'Deposit' : 'Installment'} Due: ৳${reminderData.amount.toLocaleString()} - Due ${new Date(reminderData.dueDate).toLocaleDateString()}`,
        html: getBaseTemplate(content),
    });
}

/**
 * 6. Deposit Confirmed → Member
 */
async function sendDepositConfirmed(memberEmail, depositData) {
    const content = `
        <h2 style="color: #16a34a;">✅ Deposit Confirmed</h2>
        <p>Your deposit has been confirmed by the manager.</p>
        
        <div class="success-box">
            <p><strong>Month:</strong> ${depositData.month}</p>
            <p><strong>Amount:</strong> ৳${depositData.amount.toLocaleString()}</p>
            <p><strong>Date:</strong> ${new Date(depositData.date).toLocaleDateString()}</p>
            <p><strong>Method:</strong> ${depositData.method}</p>
        </div>

        <p>Thank you for your contribution!</p>
        <a href="${process.env.FRONTEND_URL}/dashboard/member/history" class="btn">View History →</a>
    `;

    await sendEmail({
        to: memberEmail,
        subject: `✅ Deposit Confirmed - ${depositData.month} (৳${depositData.amount.toLocaleString()})`,
        html: getBaseTemplate(content),
    });
}

/**
 * 7. Deposit Request Submitted → Manager
 */
async function sendDepositRequestToManager(managerEmail, depositData) {
    const content = `
        <h2 style="color: #7c3aed;">📬 New Deposit Request</h2>
        <p>A member has submitted a deposit request.</p>
        
        <div class="info-box">
            <p><strong>Member:</strong> ${depositData.memberName}</p>
            <p><strong>Month:</strong> ${depositData.month}</p>
            <p><strong>Amount:</strong> ৳${depositData.amount.toLocaleString()}</p>
            <p><strong>Method:</strong> ${depositData.method}</p>
            <p><strong>Date:</strong> ${new Date(depositData.date).toLocaleDateString()}</p>
            ${depositData.txnId && depositData.txnId !== '-' ? `<p><strong>Transaction ID:</strong> ${depositData.txnId}</p>` : ''}
            ${depositData.note ? `<p><strong>Note:</strong> ${depositData.note}</p>` : ''}
        </div>

        <p>Please verify and confirm the deposit.</p>
        <a href="${process.env.FRONTEND_URL}/dashboard/manager/collections" class="btn">Review Deposit →</a>
    `;

    await sendEmail({
        to: managerEmail,
        subject: `💰 New Deposit - ${depositData.memberName} (৳${depositData.amount.toLocaleString()})`,
        html: getBaseTemplate(content),
    });
}

/**
 * 8. Voting Started → All Members
 */
async function sendVotingStarted(members, votingData) {
    const content = `
        <h2 style="color: #2563eb;">🗳️ Voting Started</h2>
        <p>A new loan voting has been started by the manager.</p>
        
        <div class="info-box">
            <p><strong>Loan Request:</strong> ${votingData.loanRequestId || 'N/A'}</p>
            <p><strong>Amount:</strong> ৳${votingData.amount?.toLocaleString() || 'N/A'}</p>
            <p><strong>Tenure:</strong> ${votingData.tenure || 'N/A'} months</p>
            <p><strong>Reason:</strong> ${votingData.reason || 'N/A'}</p>
        </div>

        <p>Please cast your vote (Approve/Deny) at your earliest convenience.</p>
        <a href="${process.env.FRONTEND_URL}/dashboard/member/votings" class="btn">Go to Voting →</a>
    `;

    for (const member of members) {
        await sendEmail({
            to: member.email,
            subject: `🗳️ Voting Started - Loan Request (৳${votingData.amount?.toLocaleString() || 'N/A'})`,
            html: getBaseTemplate(content),
        });
    }
}

/**
 * 9. Installment Status Update → Member
 */
async function sendInstallmentStatusUpdate(memberEmail, installmentData) {
    const isConfirmed = installmentData.status === 'confirmed';
    const content = `
        <h2 style="color: ${isConfirmed ? '#16a34a' : '#dc2626'};">
            ${isConfirmed ? '✅ Installment Confirmed' : '❌ Installment Rejected'}
        </h2>
        <p>Your loan installment has been ${installmentData.status} by the manager.</p>
        
        <div class="${isConfirmed ? 'success-box' : 'error-box'}">
            <p><strong>Installment No:</strong> ${installmentData.installmentNo}</p>
            <p><strong>Amount:</strong> ৳${installmentData.amount?.toLocaleString() || 'N/A'}</p>
            <p><strong>Date:</strong> ${installmentData.date}</p>
            <p><strong>Loan ID:</strong> ${installmentData.loanId?.slice(-8) || 'N/A'}</p>
            ${!isConfirmed && installmentData.reason ? `<p><strong>Rejection Reason:</strong> ${installmentData.reason}</p>` : ''}
        </div>

        <a href="${process.env.FRONTEND_URL}/dashboard/member/loans" class="btn">View My Loans →</a>
    `;

    await sendEmail({
        to: memberEmail,
        subject: `${isConfirmed ? '✅' : '❌'} Installment ${installmentData.status} - #${installmentData.installmentNo} (৳${installmentData.amount?.toLocaleString() || ''})`,
        html: getBaseTemplate(content),
    });
}

// ============================================================
// ==================== CORE SEND FUNCTION =====================
// ============================================================

async function sendEmail({ to, subject, html }) {
    try {
        const info = await transporter.sendMail({
            from: `"ProjectHimaloy" <${process.env.EMAIL_USER}>`,
            to,
            subject,
            html,
        });
        console.log(`✅ Email sent to ${to}: ${info.messageId}`);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        console.error(`❌ Email failed to ${to}:`, error.message);
        return { success: false, error: error.message };
    }
}

// ============================================================
// ==================== EXPORT =================================
// ============================================================

module.exports = {
    sendLoanRequestToManager,
    sendLoanApprovedToMember,
    sendLoanRejectedToMember,
    sendMeetingNotification,
    sendDueDateReminder,
    sendDepositConfirmed,
    sendDepositRequestToManager,
    sendVotingStarted,
    sendInstallmentStatusUpdate,
};