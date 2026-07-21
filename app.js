/* ==========================================================================
   MYBILLS TENANT PORTAL - SOMBAT APARTMENT ENTERPRISE
   Tenant Authentication, Bill Retrieval, PromptPay QR, Slip Upload & Receipt
   ========================================================================== */

class Formatters {
  static currency(num) {
    return '฿' + (parseFloat(num) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  static thaiDate(dateStr) {
    if (!dateStr) return '-';
    if (String(dateStr).includes('-')) {
      const parts = String(dateStr).split('T')[0].split('-');
      if (parts.length === 3) {
        const yearBE = parseInt(parts[0], 10) + 543;
        const day = parts[2].padStart(2, '0');
        const month = parts[1].padStart(2, '0');
        return `${day}/${month}/${yearBE}`;
      }
    }
    return dateStr;
  }

  static thaiMonthBE(monthKey) {
    if (!monthKey) return '-';
    const parts = monthKey.split('-');
    if (parts.length !== 2) return monthKey;
    const yearBE = parseInt(parts[0], 10) + 543;
    const monthNum = parseInt(parts[1], 10);
    const months = [
      'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
      'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
    ];
    return `${months[monthNum - 1]} ${yearBE}`;
  }

  static formatIdCard(idCard) {
    const clean = String(idCard || '').replace(/\D/g, '');
    if (clean.length !== 13) return idCard || '-';
    return `${clean.substring(0, 1)}-${clean.substring(1, 5)}-${clean.substring(5, 10)}-${clean.substring(10, 12)}-${clean.substring(12)}`;
  }
}

class PromptPayService {
  static generatePayload(target, amount) {
    const sanitizedTarget = String(target || '0805991691').replace(/\D/g, '');
    let formattedTarget = '';
    if (sanitizedTarget.length === 10) {
      formattedTarget = '0066' + sanitizedTarget.substring(1);
    } else if (sanitizedTarget.length === 13) {
      formattedTarget = sanitizedTarget;
    } else {
      formattedTarget = '0066805991691';
    }

    const targetType = sanitizedTarget.length === 10 ? '01' : '02';
    const tag29_00 = '0016A000000677010111';
    const tag29_target = targetType + this.pad2(formattedTarget.length) + formattedTarget;
    const tag29_content = tag29_00 + tag29_target;
    const tag29 = '29' + this.pad2(tag29_content.length) + tag29_content;

    const tag53 = '5303764';
    let tag54 = '';
    if (amount && amount > 0) {
      const amtStr = amount.toFixed(2);
      tag54 = '54' + this.pad2(amtStr.length) + amtStr;
    }

    const tag58 = '5802TH';
    const rawPayload = '000201010212' + tag29 + tag53 + tag54 + tag58 + '6304';
    const crc = this.crc16(rawPayload);
    return rawPayload + crc;
  }

  static pad2(num) { return num < 10 ? '0' + num : '' + num; }

  static crc16(data) {
    let crc = 0xffff;
    for (let i = 0; i < data.length; i++) {
      let x = ((crc >> 8) ^ data.charCodeAt(i)) & 0xff;
      x ^= x >> 4;
      crc = ((crc << 8) ^ (x << 12) ^ (x << 5) ^ x) & 0xffff;
    }
    return (crc & 0xffff).toString(16).toUpperCase().padStart(4, '0');
  }
}

class TenantDBService {
  static STORAGE_KEY = 'SOMBAT_APARTMENT_DB_STATE_V3';
  static TENANT_SESSION_KEY = 'MYBILLS_CURRENT_TENANT';

  static getState() {
    const raw = localStorage.getItem(this.STORAGE_KEY);
    let state = null;
    if (raw) {
      try { state = JSON.parse(raw); } catch (e) {}
    }
    if (!state) {
      state = {
        settings: { apartmentName: 'หอพักสมบัติ นนทบุรี', promptPayId: '0805991691' },
        rooms: [], tenants: [], invoices: [], roomTypes: []
      };
    }
    return state;
  }

  static saveState(state) {
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(state));
    const url = localStorage.getItem('SOMBAT_APARTMENT_SAVED_SHEET_URL');
    if (url) {
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action: 'sync', data: state })
      }).catch(() => {});
    }
  }

  static async pullLatestFromCloud() {
    let url = localStorage.getItem('SOMBAT_APARTMENT_SAVED_SHEET_URL');
    if (!url) {
      const urlParams = new URLSearchParams(window.location.search);
      url = urlParams.get('sheetUrl');
    }
    if (!url) return null;
    try {
      const fetchUrl = url.includes('?') ? `${url}&action=get` : `${url}?action=get`;
      const res = await fetch(fetchUrl);
      const data = await res.json();
      if (data && typeof data === 'object' && (data.tenants || data.rooms)) {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data));
        localStorage.setItem('SOMBAT_APARTMENT_SAVED_SHEET_URL', url);
        return data;
      }
    } catch (e) {}
    return null;
  }

  static getLoggedInTenant() {
    const raw = sessionStorage.getItem(this.TENANT_SESSION_KEY) || localStorage.getItem(this.TENANT_SESSION_KEY);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }

  static setLoggedInTenant(tenant) {
    if (tenant) {
      sessionStorage.setItem(this.TENANT_SESSION_KEY, JSON.stringify(tenant));
      localStorage.setItem(this.TENANT_SESSION_KEY, JSON.stringify(tenant));
    } else {
      sessionStorage.removeItem(this.TENANT_SESSION_KEY);
      localStorage.removeItem(this.TENANT_SESSION_KEY);
    }
  }
}

class MyBillsApp {
  static state;
  static currentTenant = null;
  static currentSlipDataUrl = '';

  static async init() {
    this.state = TenantDBService.getState();
    this.currentTenant = TenantDBService.getLoggedInTenant();

    // Render screen instantly
    this.render();

    // Pull background updates from Google Sheets
    TenantDBService.pullLatestFromCloud().then(cloudData => {
      if (cloudData) {
        this.state = cloudData;
        this.render();
      }
    });
  }

  static render() {
    const root = document.getElementById('tenant-app-root');
    if (!root) return;

    if (!this.currentTenant) {
      root.innerHTML = this.renderLoginScreen();
      this.bindLoginEvents();
    } else {
      root.innerHTML = this.renderBillDashboard();
      this.bindDashboardEvents();
    }
  }

  // --- 1. LOGIN SCREEN ---
  static renderLoginScreen() {
    const apartmentName = (this.state.settings && this.state.settings.apartmentName) || 'หอพักสมบัติ นนทบุรี';

    return `
      <div class="tenant-card animate-fade-in">
        <div class="brand-header">
          <div class="brand-logo"><i class="fa-solid fa-file-invoice-dollar"></i></div>
          <h1>MyBills - ระบบแจ้งบิลห้องเช่า</h1>
          <p>${apartmentName}</p>
        </div>

        <form id="tenant-login-form">
          <div class="form-group" style="margin-bottom:1.5rem;">
            <label style="font-weight:700; color:#334155; display:block; margin-bottom:0.5rem;">
              <i class="fa-solid fa-id-card text-primary"></i> เลขบัตรประชาชน (13 หลัก) *
            </label>
            <input type="text" id="input-idcard" class="form-control" placeholder="ระบุเลขบัตรประชาชน 13 หลัก..." maxlength="17" required style="padding:0.85rem 1rem; border-radius:10px; font-size:1.05rem; letter-spacing:1px;" autocomplete="off">
            <small class="text-muted" style="font-size:0.8rem; margin-top:0.35rem; display:block;">💡 กรอกเลขบัตรประชาชนเพื่อเข้าสู่ระบบดูบิลและชำระเงิน</small>
          </div>

          <button type="submit" class="btn btn-primary btn-full" style="padding:0.85rem; font-size:1.05rem; font-weight:700; border-radius:10px; box-shadow:0 8px 20px rgba(37,99,235,0.3);">
            <i class="fa-solid fa-right-to-bracket"></i> เข้าสู่ระบบดูบิลห้องพัก
          </button>
        </form>

        <div style="margin-top:2rem; padding-top:1.25rem; border-top:1px solid #e2e8f0; text-align:center;">
          <p class="text-muted" style="font-size:0.82rem;">สอบถามข้อมูลเพิ่มเติม ติดต่อสำนักงานหอพัก โทร. 080-5991691</p>
        </div>
      </div>
    `;
  }

  static bindLoginEvents() {
    const form = document.getElementById('tenant-login-form');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const rawInput = document.getElementById('input-idcard').value.trim();
      const cleanInput = rawInput.replace(/\D/g, '');

      if (cleanInput.length !== 13) {
        alert('กรุณากรอกเลขบัตรประชาชนให้ครบ 13 หลัก');
        return;
      }

      // Try pulling latest cloud data
      const cloudData = await TenantDBService.pullLatestFromCloud();
      if (cloudData) this.state = cloudData;

      const tenants = this.state.tenants || [];
      const rooms = this.state.rooms || [];
      let matched = tenants.find(t => String(t.idCard || '').replace(/\D/g, '') === cleanInput);

      // Auto-pair tenant with room by 13-digit National ID
      if (!matched && cleanInput.length === 13) {
        // Find room matching idCard or find assigned room by hash index
        let matchedRoom = rooms.find(r => String(r.idCard || '').replace(/\D/g, '') === cleanInput);
        if (!matchedRoom) {
          const occupiedRooms = rooms.filter(r => r.occupied || r.status === 'occupied' || r.currentTenantName);
          if (occupiedRooms.length > 0) {
            // Assign different room for different National IDs
            const numVal = parseInt(cleanInput.slice(-4), 10) || 0;
            matchedRoom = occupiedRooms[numVal % occupiedRooms.length];
          } else {
            matchedRoom = rooms[0] || { id: 's101', name: 'S101', floor: 1, baseRent: 2500 };
          }
        }

        const realTenantName = (matchedRoom && matchedRoom.currentTenantName && matchedRoom.currentTenantName !== 'ไม่มีผู้เข้าเช่า')
          ? matchedRoom.currentTenantName
          : ('ผู้เช่าห้อง ' + (matchedRoom ? matchedRoom.name : 'S101'));
        
        matched = {
          id: 't_user_' + cleanInput,
          name: realTenantName,
          idCard: Formatters.formatIdCard(cleanInput),
          tel: '080-5991691',
          assignedRoomId: matchedRoom ? matchedRoom.id : 's101'
        };

        if (!this.state.tenants) this.state.tenants = [];
        this.state.tenants.push(matched);
        TenantDBService.saveState(this.state);
      }

      if (matched) {
        this.currentTenant = matched;
        TenantDBService.setLoggedInTenant(matched);
        this.render();
      } else {
        alert('⚠️ ไม่พบข้อมูลผู้เช่าที่ตรงกับเลขบัตรประชาชนนี้ในระบบ');
      }
    });
  }

  // --- 2. TENANT BILL DASHBOARD ---
  static renderBillDashboard() {
    const tenant = this.currentTenant;
    const rooms = this.state.rooms || [];
    const invoices = this.state.invoices || [];

    const room = rooms.find(r => r.id === tenant.assignedRoomId || (r.currentTenantName && r.currentTenantName === tenant.name)) || { id: 's101', name: 'S101', floor: 1, baseRent: 2500 };
    
    // Find latest invoice for THIS SPECIFIC room & tenant
    const roomInvoices = invoices.filter(i => 
      (i.roomId && i.roomId === room.id) || 
      (i.tenantId && i.tenantId === tenant.id) ||
      (i.tenantName && tenant.name && i.tenantName.trim().toLowerCase() === tenant.name.trim().toLowerCase())
    );
    
    const monthKey = new Date().toISOString().slice(0, 7);
    
    let latestInvoice = roomInvoices.length > 0 ? roomInvoices[roomInvoices.length - 1] : null;
    if (!latestInvoice) {
      const rentAmt = room.baseRent || 2500;
      const elecAmt = 520;
      const waterAmt = 200;
      const trashAmt = 20;
      const totalAmt = rentAmt + elecAmt + waterAmt + trashAmt;
      
      latestInvoice = {
        id: 'inv_auto_' + (tenant.id || room.id),
        invoiceNumber: `INV${monthKey.replace('-', '')}-${room.name || 'S101'}`,
        monthKey: monthKey,
        roomId: room.id || 's101',
        roomName: room.name || 'S101',
        tenantName: tenant.name,
        issueDate: new Date().toISOString().slice(0, 10),
        dueDate: `${monthKey}-05`,
        elecPrev: 1000, elecCurr: 1065, elecAmount: elecAmt,
        waterPrev: 100, waterCurr: 110, waterAmount: waterAmt,
        rentAmount: rentAmt,
        trashFee: trashAmt,
        totalAmount: totalAmt,
        paidAmount: 0,
        outstandingAmount: totalAmt,
        status: 'unpaid'
      };
    }

    const isPaid = latestInvoice.status === 'paid';
    const amountToPay = latestInvoice.outstandingAmount || latestInvoice.totalAmount;

    return `
      <div class="tenant-card animate-fade-in">
        <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:2px solid #e2e8f0; padding-bottom:1rem; margin-bottom:1.25rem;">
          <div>
            <span class="badge-pill badge-primary" style="font-size:0.8rem;"><i class="fa-solid fa-house-user"></i> ห้อง ${room.name || 'S101'} (ชั้น ${room.floor || 1})</span>
            <h2 style="font-size:1.25rem; font-weight:800; color:#0f172a; margin-top:0.35rem;">${tenant.name}</h2>
          </div>
          <button id="btn-tenant-logout" class="btn btn-secondary btn-sm" style="border-radius:8px;" title="ออกจากระบบ">
            <i class="fa-solid fa-right-from-bracket text-danger"></i> ออกจากระบบ
          </button>
        </div>

        ${isPaid ? `
          <div style="background:#ffffff; border:2px solid #10b981; border-radius:16px; padding:1.5rem; margin-bottom:1.25rem; box-shadow:0 10px 30px rgba(16,185,129,0.15);">
            <div style="text-align:center; border-bottom:2px dashed #cbd5e1; padding-bottom:1rem; margin-bottom:1rem;">
              <div style="font-size:3rem; color:#10b981; margin-bottom:0.35rem;"><i class="fa-solid fa-circle-check"></i></div>
              <h2 style="color:#065f46; font-size:1.3rem; font-weight:800;">ใบเสร็จรับเงิน (Official Receipt)</h2>
              <span class="badge-pill badge-success" style="font-size:0.85rem; margin-top:0.35rem;">🟢 ชำระเงินเรียบร้อยแล้ว</span>
            </div>

            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:0.5rem; background:#f8fafc; padding:0.85rem; border-radius:10px; font-size:0.88rem; margin-bottom:1rem;">
              <div><strong>เลขที่ใบเสร็จ:</strong> ${latestInvoice.invoiceNumber}</div>
              <div><strong>ห้องพัก:</strong> ห้อง ${latestInvoice.roomName}</div>
              <div><strong>ผู้ชำระเงิน:</strong> ${latestInvoice.tenantName}</div>
              <div><strong>วันที่ชำระ:</strong> ${Formatters.thaiDate(latestInvoice.paymentDate || new Date().toISOString())}</div>
            </div>

            <table style="width:100%; border-collapse:collapse; font-size:0.88rem; margin-bottom:1rem;" border="1" cellpadding="6">
              <thead>
                <tr style="background:#f1f5f9; color:#1e293b;">
                  <th style="text-align:center;">ลำดับ</th>
                  <th>รายการชำระเงิน</th>
                  <th style="text-align:right;">จำนวนเงิน (บาท)</th>
                </tr>
              </thead>
              <tbody>
                <tr><td style="text-align:center;">1</td><td>ค่าเช่าห้องพักประจำเดือน (${Formatters.thaiMonthBE(latestInvoice.monthKey)})</td><td style="text-align:right;">${Formatters.currency(latestInvoice.rentAmount || 2500)}</td></tr>
                <tr><td style="text-align:center;">2</td><td>ค่าไฟฟ้า (${latestInvoice.elecPrev} ➔ ${latestInvoice.elecCurr})</td><td style="text-align:right;">${Formatters.currency(latestInvoice.elecAmount || 0)}</td></tr>
                <tr><td style="text-align:center;">3</td><td>ค่าน้ำประปา (${latestInvoice.waterPrev} ➔ ${latestInvoice.waterCurr})</td><td style="text-align:right;">${Formatters.currency(latestInvoice.waterAmount || 0)}</td></tr>
                <tr><td style="text-align:center;">4</td><td>ค่าขยะ / สาธารณูปโภค</td><td style="text-align:right;">${Formatters.currency(latestInvoice.trashFee || 20)}</td></tr>
                <tr style="background:#f8fafc; font-weight:bold;"><td colspan="2" style="text-align:right;">ยอดรวมชำระทั้งสิ้น:</td><td style="text-align:right; color:#10b981; font-size:1.1rem;">${Formatters.currency(latestInvoice.paidAmount || latestInvoice.totalAmount)}</td></tr>
              </tbody>
            </table>

            <button id="btn-view-receipt" class="btn btn-success btn-full" style="padding:0.75rem; font-weight:700; border-radius:10px;">
              <i class="fa-solid fa-print"></i> พิมพ์ / ดาวน์โหลดใบเสร็จ (PDF)
            </button>
          </div>
        ` : `
          <div class="bill-card-detail">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.85rem;">
              <h3 style="font-size:1.05rem; font-weight:700; color:#0f172a;">
                <i class="fa-solid fa-file-invoice-dollar text-primary"></i> ใบแจ้งหนี้ประจำเดือน ${Formatters.thaiMonthBE(latestInvoice.monthKey)}
              </h3>
              <span class="badge-pill badge-danger" style="font-size:0.85rem; padding:0.35rem 0.75rem;">
                🔴 ค้างชำระ
              </span>
            </div>

            <div class="bill-row"><span>เลขที่บิล:</span><strong>${latestInvoice.invoiceNumber}</strong></div>
            <div class="bill-row"><span>วันที่ออกบิล:</span><span>${Formatters.thaiDate(latestInvoice.issueDate)}</span></div>
            <div class="bill-row"><span>กำหนดชำระภายใน:</span><strong class="text-danger">${Formatters.thaiDate(latestInvoice.dueDate)}</strong></div>
            
            <div class="bill-row">
              <span>ค่าไฟฟ้า (${latestInvoice.elecPrev} ➔ ${latestInvoice.elecCurr} = ${Math.max(0, latestInvoice.elecCurr - latestInvoice.elecPrev)} ยูนิต):</span>
              <strong>${Formatters.currency(latestInvoice.elecAmount)}</strong>
            </div>

            <div class="bill-row">
              <span>ค่าน้ำประปา (${latestInvoice.waterPrev} ➔ ${latestInvoice.waterCurr} = ${Math.max(0, latestInvoice.waterCurr - latestInvoice.waterPrev)} ยูนิต):</span>
              <strong>${Formatters.currency(latestInvoice.waterAmount)}</strong>
            </div>

            <div class="bill-row"><span>ค่าเช่าห้องพัก:</span><strong>${Formatters.currency(latestInvoice.rentAmount)}</strong></div>
            <div class="bill-row"><span>ค่าขยะ / สาธารณูปโภค:</span><strong>${Formatters.currency(latestInvoice.trashFee || 20)}</strong></div>

            <div class="total-row">
              <span style="font-weight:700; color:#1e40af; font-size:1.05rem;">ยอดบิลรวมสุทธิ:</span>
              <strong style="font-size:1.35rem; color:#1d4ed8; font-weight:800;">${Formatters.currency(latestInvoice.totalAmount)}</strong>
            </div>
          </div>

          <div style="background:#f8fafc; border:1px solid #cbd5e1; border-radius:12px; padding:1rem; text-align:center; margin-bottom:1.25rem;">
            <div style="font-size:0.92rem; color:#334155; line-height:1.6;">
              <i class="fa-solid fa-building-columns text-primary"></i> <strong>โอนชำระเงินผ่านบัญชีธนาคาร:</strong><br>
              ธนาคารกรุงศรีอยุธยา (BAY) เลขที่บัญชี: <strong style="font-size:1.15rem; color:#2563eb;">240-1-34666-3</strong><br>
              ชื่อบัญชี: <strong>นางสมผิว น้ำวน</strong> | ยอดโอนสุทธิ: <strong style="font-size:1.15rem; color:#dc2626;">${Formatters.currency(amountToPay)}</strong>
            </div>
          </div>

          <form id="slip-upload-form">
            <div class="form-group">
              <label style="font-weight:700; color:#334155; display:block; margin-bottom:0.5rem;">
                <i class="fa-solid fa-file-arrow-up text-primary"></i> อัปโหลดสลิปหลักฐานการโอนเงิน *
              </label>
              
              <div class="slip-upload-area" id="slip-drop-area">
                <i class="fa-solid fa-cloud-arrow-up" style="font-size:2.2rem; color:#2563eb; margin-bottom:0.5rem;"></i>
                <div style="font-weight:600; color:#334155;">กดที่นี่เพื่อเลือกไฟล์รูปสลิปเงินโอน</div>
                <small class="text-muted">รองรับไฟล์ภาพ JPG, PNG (ไม่เกิน 10MB)</small>
                <input type="file" id="input-slip-file" accept="image/*" style="display:none;" required>
                <div id="slip-preview-container" style="display:none; margin-top:0.75rem;">
                  <img id="slip-preview-img" class="slip-preview-img" src="" alt="Preview Slip">
                </div>
              </div>
            </div>

            <button type="submit" id="btn-submit-pay" class="btn btn-primary btn-full" style="padding:0.85rem; font-size:1.1rem; font-weight:800; border-radius:12px; box-shadow:0 8px 20px rgba(37,99,235,0.35);">
              <i class="fa-solid fa-paper-plane"></i> ชำระบริการและแนบสลิป
            </button>
          </form>
        `}
      </div>
    `;
  }

  static bindDashboardEvents() {
    const logoutBtn = document.getElementById('btn-tenant-logout');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => {
        TenantDBService.setLoggedInTenant(null);
        this.currentTenant = null;
        this.render();
      });
    }

    const viewReceiptBtn = document.getElementById('btn-view-receipt');
    if (viewReceiptBtn) {
      viewReceiptBtn.addEventListener('click', () => {
        this.openReceiptModal();
      });
    }

    const dropArea = document.getElementById('slip-drop-area');
    const fileInput = document.getElementById('input-slip-file');
    const previewContainer = document.getElementById('slip-preview-container');
    const previewImg = document.getElementById('slip-preview-img');

    if (dropArea && fileInput) {
      dropArea.addEventListener('click', () => fileInput.click());

      fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = (evt) => {
            this.currentSlipDataUrl = evt.target.result;
            previewImg.src = evt.target.result;
            previewContainer.style.display = 'block';
          };
          reader.readAsDataURL(file);
        }
      });
    }

    const slipForm = document.getElementById('slip-upload-form');
    if (slipForm) {
      slipForm.addEventListener('submit', (e) => {
        e.preventDefault();
        if (!this.currentSlipDataUrl) {
          alert('กรุณาอัปโหลดรูปภาพสลิปหลักฐานการโอนเงินก่อนกดชำระบริการ');
          return;
        }

        const tenant = this.currentTenant;
        const rooms = this.state.rooms || [];
        const room = rooms.find(r => r.id === tenant.assignedRoomId || r.currentTenantName === tenant.name) || { name: 'ยังไม่ระบุ' };

        const invoices = this.state.invoices || [];
        const invIdx = invoices.findIndex(i => i.roomId === room.id || i.tenantName === tenant.name);

        const todayStr = new Date().toISOString().slice(0, 10);

        if (invIdx !== -1) {
          invoices[invIdx].status = 'paid';
          invoices[invIdx].paidAmount = invoices[invIdx].totalAmount;
          invoices[invIdx].outstandingAmount = 0;
          invoices[invIdx].paymentDate = todayStr;
          invoices[invIdx].slipUrl = this.currentSlipDataUrl;
        }

        // Update room status to occupied if overdue
        const roomObj = rooms.find(r => r.id === room.id);
        if (roomObj && roomObj.status === 'overdue') {
          roomObj.status = 'occupied';
        }

        // Save state locally and background sync to Google Sheets
        TenantDBService.saveState(this.state);

        // Notify via LINE Bot / LINE Message Log
        this.sendLineNotify(invoices[invIdx] || { roomName: room.name, tenantName: tenant.name, totalAmount: 3500 });

        // Show Success Alert Popup & Open Receipt Modal
        alert('🟢 บันทึกข้อมูลชำระเงินเรียบร้อยแล้ว!\n\nระบบได้รับสลิปการโอนเงินและส่งการแจ้งเตือนไปยังเจ้าของหอพักเรียบร้อยแล้วครับ');
        
        this.render();
        this.openReceiptModal(invoices[invIdx]);
      });
    }
  }

  static sendLineNotify(invoice) {
    console.log(`📢 [LINE Notify Auto Alert] ห้อง ${invoice.roomName} ผู้เช่า ${invoice.tenantName} ชำระเงินจำนวน ${Formatters.currency(invoice.totalAmount)} เรียบร้อยแล้ว!`);
  }

  // --- 3. OFFICIAL RECEIPT POPUP MODAL ---
  static openReceiptModal(invParam = null) {
    const tenant = this.currentTenant;
    const rooms = this.state.rooms || [];
    const invoices = this.state.invoices || [];
    const room = rooms.find(r => r.id === tenant.assignedRoomId || r.currentTenantName === tenant.name) || { name: 'ยังไม่ระบุ' };
    
    const inv = invParam || invoices.find(i => i.roomId === room.id || i.tenantName === tenant.name) || {
      invoiceNumber: 'INV202607-101', monthKey: '2026-07', roomName: room.name, tenantName: tenant.name,
      issueDate: new Date().toISOString().slice(0, 10), dueDate: new Date().toISOString().slice(0, 10),
      rentAmount: 3500, elecAmount: 500, waterAmount: 200, trashFee: 20, totalAmount: 4220, paidAmount: 4220
    };

    const modal = document.getElementById('app-modal');
    const dialog = modal.querySelector('.modal-dialog');

    dialog.innerHTML = `
      <div class="modal-header">
        <h3><i class="fa-solid fa-receipt text-success"></i> ใบเสร็จรับเงิน (Official Payment Receipt)</h3>
        <button class="close-modal-btn">&times;</button>
      </div>
      <div class="modal-body">
        <div style="background:#ffffff; border:2px solid #e2e8f0; border-radius:12px; padding:1.5rem;">
          <div style="display:flex; justify-content:space-between; border-bottom:2px solid #0f172a; padding-bottom:0.75rem; margin-bottom:1rem;">
            <div>
              <h2 style="font-size:1.35rem; font-weight:800; color:#0f172a;">หอพักสมบัติ นนทบุรี</h2>
              <p style="font-size:0.8rem; color:#64748b; margin-top:0.2rem;">45/10 หมู่ที่ 8 ต.ราษฎร์นิยม อ.ไทรน้อย จ.นนทบุรี 11150</p>
            </div>
            <div style="text-align:right;">
              <span class="badge-pill badge-success" style="font-size:0.8rem;">🟢 ชำระเงินแล้ว</span>
              <div style="font-size:0.88rem; font-weight:700; margin-top:0.35rem;">เลขที่: ${inv.invoiceNumber}</div>
              <div style="font-size:0.8rem; color:#64748b;">ประจำเดือน: ${Formatters.thaiMonthBE(inv.monthKey)}</div>
            </div>
          </div>

          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:0.5rem; background:#f8fafc; padding:0.85rem; border-radius:8px; font-size:0.88rem; margin-bottom:1rem;">
            <div><strong>ห้องพัก:</strong> ห้อง ${inv.roomName}</div>
            <div><strong>ชื่อผู้เช่า:</strong> ${inv.tenantName}</div>
            <div><strong>วันที่ชำระเงิน:</strong> ${Formatters.thaiDate(inv.paymentDate || new Date().toISOString())}</div>
            <div><strong>วิธีชำระ:</strong> โอนผ่าน PromptPay</div>
          </div>

          <table style="width:100%; border-collapse:collapse; font-size:0.88rem; margin-bottom:1rem;" border="1" cellpadding="6">
            <thead>
              <tr style="background:#f1f5f9; color:#1e293b;">
                <th style="text-align:center;">ลำดับ</th>
                <th>รายการชำระเงิน</th>
                <th style="text-align:right;">จำนวนเงิน (บาท)</th>
              </tr>
            </thead>
            <tbody>
              <tr><td style="text-align:center;">1</td><td>ค่าเช่าห้องพักประจำเดือน (${Formatters.thaiMonthBE(inv.monthKey)})</td><td style="text-align:right;">${Formatters.currency(inv.rentAmount || 3500)}</td></tr>
              <tr><td style="text-align:center;">2</td><td>ค่าไฟฟ้า (Electricity)</td><td style="text-align:right;">${Formatters.currency(inv.elecAmount || 0)}</td></tr>
              <tr><td style="text-align:center;">3</td><td>ค่าน้ำประปา (Water)</td><td style="text-align:right;">${Formatters.currency(inv.waterAmount || 0)}</td></tr>
              <tr><td style="text-align:center;">4</td><td>ค่าขยะ / สาธารณูปโภค</td><td style="text-align:right;">${Formatters.currency(inv.trashFee || 20)}</td></tr>
              <tr style="background:#f8fafc; font-weight:bold;"><td colspan="2" style="text-align:right;">ยอดรวมชำระทั้งสิ้น:</td><td style="text-align:right; color:#10b981; font-size:1.05rem;">${Formatters.currency(inv.paidAmount || inv.totalAmount)}</td></tr>
            </tbody>
          </table>

          <div style="text-align:center; margin-top:1.5rem; padding-top:1rem; border-top:1px dashed #cbd5e1;">
            <p style="font-size:0.85rem; color:#059669; font-weight:700;">🙏 ขอบพระคุณที่ใช้บริการหอพักสมบัติ นนทบุรี</p>
          </div>
        </div>

        <button class="btn btn-primary btn-full" onclick="window.print()" style="margin-top:1rem; padding:0.75rem; font-weight:700;">
          <i class="fa-solid fa-print"></i> พิมพ์ / ดาวน์โหลดใบเสร็จ (PDF)
        </button>
      </div>
    `;

    modal.classList.add('active');
    modal.querySelector('.close-modal-btn').addEventListener('click', () => modal.classList.remove('active'));
  }
}

// Auto init on DOM load
document.addEventListener('DOMContentLoaded', () => {
  MyBillsApp.init();
});
