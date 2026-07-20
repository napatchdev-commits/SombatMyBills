/* ==========================================================================
   APP CONTROLLER - SOMBAT RENT TENANT PORTAL
   ========================================================================== */

const TenantPortal = {
    state: {
        db: null,
        tenant: null,
        room: null,
        invoice: null,
        selectedMonth: ""
    },

    /**
     * Initializes the Tenant Portal. Sets up listeners and attempts database pull.
     */
    init: async function() {
        this.setupEventListeners();
        
        // Show loading spinner in login button initially while fetching DB
        const loginBtn = document.getElementById('btn-submit-login');
        const origHTML = loginBtn.innerHTML;
        loginBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังดาวน์โหลดฐานข้อมูลออนไลน์...';
        loginBtn.disabled = true;

        await this.loadDatabase();

        loginBtn.innerHTML = origHTML;
        loginBtn.disabled = false;
    },

    /**
     * Attempts to load database state from Cloud (Google Sheets) first,
     * then falls back to LocalStorage, then falls back to embedded seed.
     */
    loadDatabase: async function() {
        // 1. Try Google Sheets Cloud Sync if URL is provided in config.js
        const cloudUrl = window.RENT_APP_CONFIG ? window.RENT_APP_CONFIG.googleSheetUrl : "";
        
        if (cloudUrl) {
            try {
                console.log("Fetching database state from Google Sheets...");
                const response = await fetch(`${cloudUrl}?action=get`);
                if (response.ok) {
                    const data = await response.json();
                    if (data && data.rooms && data.tenants) {
                        this.state.db = data;
                        console.log("Database pulled from Cloud successfully.");
                        this.showToast("เชื่อมต่อข้อมูลออนไลน์สำเร็จ", "success");
                        return;
                    }
                }
            } catch (e) {
                console.warn("Could not pull from Cloud Sheets API, falling back to LocalStorage.", e);
                this.showToast("ไม่สามารถดึงข้อมูลคลาวด์ได้ กำลังใช้ข้อมูลสำรองในเครื่อง", "warning");
            }
        }

        // 2. Fallback to LocalStorage
        const localData = localStorage.getItem('SOMBAT_RENTAL_DB_STATE');
        if (localData) {
            try {
                this.state.db = JSON.parse(localData);
                console.log("Database loaded from LocalStorage.");
                return;
            } catch (e) {
                console.error("Error parsing LocalStorage DB state.", e);
            }
        }

        // 3. Last fallback (show error or look for dummy script)
        console.error("No database state available!");
        this.showToast("ไม่พบฐานข้อมูลระบบหอพัก กรุณาติดต่อผู้ดูแลหอพัก", "danger");
    },

    setupEventListeners: function() {
        const loginForm = document.getElementById('tenant-login-form');
        const logoutBtn = document.getElementById('logout-btn');
        const printBtn = document.getElementById('btn-print-bill');

        // Form Submit Login
        loginForm.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleLogin();
        });

        // Logout
        logoutBtn.addEventListener('click', () => {
            this.handleLogout();
        });

        // Print Invoice / Receipt
        printBtn.addEventListener('click', () => {
            this.triggerPrint();
        });
    },

    /**
     * Validates credentials and parses invoice information.
     */
    handleLogin: function() {
        const rawId = document.getElementById('idcard-input').value.replace(/\s+/g, '');
        
        if (!this.state.db || !this.state.db.tenants) {
            alert("ฐานข้อมูลระบบขัดข้องกรุณารอสักครู่ หรือติดต่อแอดมิน");
            return;
        }

        // Search tenant by ID Card
        const matchedTenant = this.state.db.tenants.find(t => {
            const cleanTCard = t.idCard.replace(/\s+/g, '');
            return cleanTCard === rawId;
        });

        if (!matchedTenant) {
            this.showToast("ไม่พบเลขบัตรประชาชนนี้ในระบบผู้เช่า กรุณาติดต่อผู้ดูแลหอพัก", "danger");
            return;
        }

        // Find room assigned
        const matchedRoom = this.state.db.rooms.find(r => r.occupied && r.currentTenant.trim() === matchedTenant.name.trim());
        
        if (!matchedRoom) {
            this.showToast(`คุณ ${matchedTenant.name} ยังไม่ถูกจัดสรรเข้าห้องพักในขณะนี้`, "warning");
            return;
        }

        // Find active month (the latest month in database)
        const months = Object.keys(this.state.db.monthlyData || {});
        if (months.length === 0) {
            this.showToast("ยังไม่มีการออกบิลค่าเช่าในระบบ", "warning");
            return;
        }
        months.sort((a,b) => b.localeCompare(a));
        const activeMonth = months[0]; // Latest

        // Fetch invoice details for room
        const invoiceDetails = this.state.db.monthlyData[activeMonth][matchedRoom.id];
        if (!invoiceDetails) {
            this.showToast(`ยังไม่มีการกรอกบิลห้อง ${matchedRoom.name} สำหรับรอบ ${this.formatMonthBE(activeMonth)}`, "warning");
            return;
        }

        // Set state
        this.state.tenant = matchedTenant;
        this.state.room = matchedRoom;
        this.state.selectedMonth = activeMonth;
        this.state.invoice = invoiceDetails;

        // Transition views
        document.getElementById('login-view').style.display = 'none';
        document.getElementById('invoice-view').style.display = 'block';
        document.getElementById('logout-btn').style.display = 'inline-flex';

        this.renderInvoice();
        this.showToast(`เข้าสู่ระบบสำเร็จ ห้อง ${matchedRoom.name}`, "success");
    },

    /**
     * Renders invoice details directly in DOM
     */
    renderInvoice: function() {
        const tenant = this.state.tenant;
        const room = this.state.room;
        const invoice = this.state.invoice;
        const settings = this.state.db.settings;

        // User profile info
        document.getElementById('display-tenant-name').textContent = tenant.name;
        document.getElementById('display-room-name').textContent = `ห้อง ${room.name}`;
        document.getElementById('display-tenant-tel').textContent = tenant.tel || 'ไม่ได้บันทึก';
        document.getElementById('display-invoice-month').textContent = `รอบประจำเดือน: ${this.formatMonthBE(this.state.selectedMonth)}`;

        // Calculations for water and electricity
        const waterUsed = invoice.waterCurr - invoice.waterPrev;
        const waterCost = waterUsed > 0 ? waterUsed * settings.waterRate : 0;
        document.getElementById('water-readings').textContent = `มิเตอร์: ${invoice.waterPrev} ➔ ${invoice.waterCurr} | รวม ${waterUsed} หน่วย`;
        document.getElementById('val-water').textContent = `฿${waterCost.toLocaleString(undefined, {minimumFractionDigits: 2})}`;

        const elecUsed = invoice.elecCurr - invoice.elecPrev;
        const elecCost = elecUsed > 0 ? elecUsed * settings.electricityRate : 0;
        document.getElementById('elec-readings').textContent = `มิเตอร์: ${invoice.elecPrev} ➔ ${invoice.elecCurr} | รวม ${elecUsed} หน่วย`;
        document.getElementById('val-elec').textContent = `฿${elecCost.toLocaleString(undefined, {minimumFractionDigits: 2})}`;

        // Base Rent
        document.getElementById('val-rent').textContent = `฿${invoice.rent.toLocaleString(undefined, {minimumFractionDigits: 2})}`;

        // Air fee
        const airCont = document.getElementById('val-air-container');
        if (invoice.airFee > 0) {
            airCont.style.display = 'flex';
            document.getElementById('val-air').textContent = `฿${invoice.airFee.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
        } else {
            airCont.style.display = 'none';
        }

        // Trash fee
        document.getElementById('val-trash').textContent = `฿${invoice.trashFee.toLocaleString(undefined, {minimumFractionDigits: 2})}`;

        // Fines
        const fineCont = document.getElementById('val-fine-container');
        if (invoice.fine > 0) {
            fineCont.style.display = 'flex';
            document.getElementById('val-fine').textContent = `฿${invoice.fine.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
        } else {
            fineCont.style.display = 'none';
        }

        // Totals & Status
        document.getElementById('val-total').textContent = `฿${invoice.total.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
        
        const statusBadge = document.getElementById('display-payment-status');
        const statusWrapper = document.getElementById('payment-status-wrapper');
        const datePaidCont = document.getElementById('val-datepaid-container');

        if (invoice.outstanding === 0 && invoice.total > 0) {
            statusBadge.className = 'badge-paid';
            statusBadge.textContent = 'ชำระเงินเรียบร้อยแล้ว';
            
            datePaidCont.style.display = 'flex';
            document.getElementById('val-datepaid').textContent = this.formatThaiDate(invoice.datePaid);
        } else {
            statusBadge.className = 'badge-unpaid';
            statusBadge.textContent = invoice.paid > 0 ? `ค้างชำระบางส่วน (ยอดคงค้าง: ฿${invoice.outstanding.toLocaleString(undefined, {minimumFractionDigits:2})})` : 'ค้างชำระ';
            datePaidCont.style.display = 'none';
        }
    },

    handleLogout: function() {
        this.state.tenant = null;
        this.state.room = null;
        this.state.invoice = null;

        // Reset forms and view swap
        document.getElementById('tenant-login-form').reset();
        document.getElementById('login-view').style.display = 'block';
        document.getElementById('invoice-view').style.display = 'none';
        document.getElementById('logout-btn').style.display = 'none';
        
        this.showToast("ออกจากระบบเรียบร้อย", "info");
    },

    triggerPrint: function() {
        const tenant = this.state.tenant;
        const room = this.state.room;
        const invoice = this.state.invoice;
        const settings = this.state.db.settings;

        const waterUsed = invoice.waterCurr - invoice.waterPrev;
        const waterCost = waterUsed > 0 ? waterUsed * settings.waterRate : 0;

        const elecUsed = invoice.elecCurr - invoice.elecPrev;
        const elecCost = elecUsed > 0 ? elecUsed * settings.electricityRate : 0;

        const printArea = document.getElementById('print-receipt-area');
        printArea.innerHTML = `
            <div class="invoice-container">
                <div class="invoice-header">
                    <div class="invoice-title">หอพักสมบัติ นนทบุรี</div>
                    <div class="invoice-subtitle">45/10 หมู่ที่ 8 ต.ราษฎร์นิยม อ.ไทรน้อย จ.นนทบุรี 11150 โทร. 080-5991691</div>
                    <div style="font-weight: 700; font-size: 1.15rem; margin-top: 1rem;">
                        ${invoice.outstanding === 0 ? 'ใบเสร็จรับเงิน (Receipt)' : 'ใบแจ้งหนี้ค่าเช่าห้องพัก (Invoice)'}
                    </div>
                </div>
                <div class="invoice-details-grid">
                    <div>ห้องพักหมายเลข: <span>${room.name}</span></div>
                    <div>ประจำรอบเดือน: <span>${this.formatMonthBE(this.state.selectedMonth)}</span></div>
                    <div>ชื่อผู้เช่า: <span>${tenant.name}</span></div>
                    <div>วันที่ออกเอกสาร: <span>${this.formatThaiDate(new Date().toISOString().slice(0,10))}</span></div>
                </div>
                <table class="invoice-table">
                    <thead>
                        <tr>
                            <th>รายการค่าบริการ</th>
                            <th class="amount-col" style="width: 100px;">หน่วย</th>
                            <th class="amount-col" style="width: 120px;">จำนวนเงิน (บาท)</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr><td>ค่าเช่าห้องพัก</td><td class="amount-col">-</td><td class="amount-col">${invoice.rent.toLocaleString(undefined, {minimumFractionDigits: 2})}</td></tr>
                        ${invoice.airFee > 0 ? `<tr><td>ค่าบริการเครื่องปรับอากาศ</td><td class="amount-col">-</td><td class="amount-col">${invoice.airFee.toLocaleString(undefined, {minimumFractionDigits: 2})}</td></tr>` : ''}
                        <tr><td>ค่าน้ำประปา (${invoice.waterPrev} ➔ ${invoice.waterCurr})</td><td class="amount-col">${waterUsed} หน่วย</td><td class="amount-col">${waterCost.toLocaleString(undefined, {minimumFractionDigits: 2})}</td></tr>
                        <tr><td>ค่าไฟฟ้า (${invoice.elecPrev} ➔ ${invoice.elecCurr})</td><td class="amount-col">${elecUsed} หน่วย</td><td class="amount-col">${elecCost.toLocaleString(undefined, {minimumFractionDigits: 2})}</td></tr>
                        <tr><td>ค่าเก็บขยะรายเดือน</td><td class="amount-col">-</td><td class="amount-col">${invoice.trashFee.toLocaleString(undefined, {minimumFractionDigits: 2})}</td></tr>
                        ${invoice.fine > 0 ? `<tr><td>ค่าปรับปรุง/ค่าปรับตกแต่ง</td><td class="amount-col">-</td><td class="amount-col">${invoice.fine.toLocaleString(undefined, {minimumFractionDigits: 2})}</td></tr>` : ''}
                        <tr class="invoice-total-row"><td>ยอดบิลรวมสุทธิ</td><td class="amount-col">-</td><td class="amount-col">฿${invoice.total.toLocaleString(undefined, {minimumFractionDigits: 2})}</td></tr>
                        ${invoice.paid > 0 ? `<tr class="invoice-total-row" style="background:#f0fdf4; color:#15803d;"><td>ชำระเงินแล้ว</td><td class="amount-col">-</td><td class="amount-col">฿${invoice.paid.toLocaleString(undefined, {minimumFractionDigits: 2})}</td></tr>` : ''}
                    </tbody>
                </table>
                <div class="invoice-signature-grid">
                    <div><p style="font-size:0.85rem; color:#64748b;">ผู้จ่ายเงิน (Tenant)</p><div class="signature-line"></div><p style="font-size:0.85rem;">(..............................................)</p></div>
                    <div><p style="font-size:0.85rem; color:#64748b;">ผู้รับเงิน (Receiver)</p><div class="signature-line"></div><p style="font-size:0.85rem;">(..............................................)</p></div>
                </div>
                <div class="invoice-footer"><p>ขอขอบคุณที่ใช้บริการ / จ่ายเงินล่าช้าปรับตามที่กำหนด</p></div>
            </div>
        `;

        setTimeout(() => { window.print(); }, 150);
    },

    formatMonthBE: function(monthKey) {
        const parts = monthKey.split('-');
        if (parts.length !== 2) return monthKey;
        const year = parts[0];
        const monthNum = parseInt(parts[1], 10);
        const thaiMonths = [
            "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
            "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"
        ];
        return `${thaiMonths[monthNum - 1]} ${year}`;
    },

    formatThaiDate: function(dateStr) {
        if (!dateStr) return '-';
        const parts = dateStr.split('-');
        if (parts.length !== 3) return dateStr;
        const y = parseInt(parts[0], 10) + 543;
        const m = parts[1];
        const d = parts[2];
        return `${d}/${m}/${y}`;
    },

    showToast: function(message, type = 'info') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        
        let icon = '<i class="fa-solid fa-circle-info"></i>';
        if (type === 'success') icon = '<i class="fa-solid fa-circle-check"></i>';
        if (type === 'danger') icon = '<i class="fa-solid fa-circle-exclamation"></i>';
        if (type === 'warning') icon = '<i class="fa-solid fa-triangle-exclamation"></i>';

        toast.innerHTML = `${icon} <span>${message}</span>`;
        container.appendChild(toast);

        setTimeout(() => {
            toast.style.animation = 'slideIn 0.3s reverse forwards';
            setTimeout(() => { toast.remove(); }, 300);
        }, 3000);
    }
};

window.addEventListener('DOMContentLoaded', () => { TenantPortal.init(); });
